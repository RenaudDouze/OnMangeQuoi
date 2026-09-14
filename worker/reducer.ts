// Pure state-mutation logic for a shared meal list, extracted out of the
// Durable Object class (mealRoom.ts) so it can be unit-tested without any
// Workers runtime (storage, WebSockets, ctx...).

import type { ListState, ClientMessage, Meal } from "../shared/types";
import {
  MAX_TITLE_LENGTH,
  MAX_LIST_NAME_LENGTH,
  MAX_SOURCE_LENGTH,
  MAX_COMMENT_LENGTH,
  MAX_MEALS_TOTAL,
  MAX_IMAGES_PER_MEAL,
  MEAL_STATUSES,
  MEAL_NOTES,
  PREP_TIMES,
} from "../shared/types";

// Même forme que l'id généré côté client (crypto.randomUUID(), voir
// src/lib/id.ts) et que le motif déjà utilisé pour l'id d'un repas dans la
// route image (worker/index.ts) : un id de repas n'a normalement jamais
// besoin d'autre chose. N'importe qui ayant le code peut envoyer un message
// "addMeal" forgé (pas d'authentification) — sans cette validation, un id
// arbitraire se serait retrouvé stocké tel quel, puis réinjecté sans
// échappement dans un attribut HTML côté client (voir data-id dans
// src/views/list.ts), ouvrant une XSS stockée touchant tous les appareils
// connectés à la liste.
const MEAL_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

export function nextOrder(list: { order: number }[]): number {
  return list.length === 0 ? 0 : Math.max(...list.map((x) => x.order)) + 1;
}

/** Inverse de nextOrder : un ordre plus petit que tous les autres, pour
 * qu'un nouveau repas apparaisse en tête de liste plutôt qu'à la fin. */
export function prevOrder(list: { order: number }[]): number {
  return list.length === 0 ? 0 : Math.min(...list.map((x) => x.order)) - 1;
}

function findMeal(state: ListState, id: string): Meal | undefined {
  return state.meals.find((m) => m.id === id) ?? state.archive.find((m) => m.id === id);
}

/** Migre en douceur une ListState chargée depuis le stockage d'une liste
 * créée avant l'ajout des photos multiples : à l'époque, un repas portait
 * `hasImage: boolean` + `imageVersion: number` (une seule photo, écrasée à
 * chaque remplacement) au lieu de `images: string[]`. Appelée par
 * mealRoom.ts juste après le chargement, avant toute autre opération —
 * cette app étant déjà déployée avec de vraies listes, une lecture qui
 * suppose `images` déjà présent planterait sinon sur toute liste plus
 * ancienne que ce changement.
 *
 * L'ancienne image unique vivait sur R2 à la clé `meals/<code>/<mealId>`
 * (voir worker/index.ts) : plutôt que de la copier vers une nouvelle clé,
 * on réutilise l'id du repas lui-même comme id de cette image migrée —
 * `mealImageKey` (worker/index.ts) sait reconnaître ce cas particulier et
 * retrouver l'objet à son ancien emplacement, sans déplacement de données.
 *
 * Idempotente (un repas dont `images` est déjà un tableau n'est pas
 * retouché) : sans coût à rappeler à chaque chargement d'une liste déjà
 * migrée, la grande majorité une fois ce changement déployé. Retourne
 * `true` si quelque chose a été migré, pour éviter une écriture de
 * stockage inutile côté appelant. */
export function migrateMealImages(state: ListState): boolean {
  let migrated = false;
  const migrateOne = (meal: Meal): void => {
    const legacy = meal as unknown as { images?: unknown; hasImage?: boolean; imageVersion?: number };
    if (Array.isArray(legacy.images)) return;
    meal.images = legacy.hasImage ? [meal.id] : [];
    delete legacy.hasImage;
    delete legacy.imageVersion;
    migrated = true;
  };
  state.meals.forEach(migrateOne);
  state.archive.forEach(migrateOne);
  return migrated;
}

/** Mutates `state` in place to apply one client message.
 * `internal` must only be true when the message is replayed by mealRoom.ts's
 * own "/apply" route (see worker/index.ts), never for a message coming
 * straight off the public WebSocket — see "setMealImage" below. */
export function applyMessage(state: ListState, msg: ClientMessage, now: number = Date.now(), internal: boolean = false): void {
  switch (msg.type) {
    // Stryker disable next-line StringLiteral: mutant équivalent — "sync" ne
    // fait rien, et un type inconnu ne correspondant à aucun autre "case" ne
    // fait rien non plus (switch sans "default") : les deux versions sont un
    // no-op strictement identique, impossible à distinguer par le comportement.
    case "sync":
      return;

    case "renameList": {
      const name = msg.name.trim().slice(0, MAX_LIST_NAME_LENGTH);
      if (name) state.name = name;
      return;
    }

    case "addMeal": {
      if (!MEAL_ID_RE.test(msg.id)) return;
      const title = msg.title.trim().slice(0, MAX_TITLE_LENGTH);
      if (!title) return;
      // N'importe qui ayant le code peut écrire sans authentification : cette
      // borne évite qu'un client (buggé ou malveillant) ne fasse grossir la
      // liste indéfiniment.
      if (state.meals.length + state.archive.length >= MAX_MEALS_TOTAL) return;
      const meal: Meal = {
        id: msg.id,
        title,
        status: "idee",
        note: null,
        source: "",
        comment: "",
        order: prevOrder(state.meals),
        createdAt: now,
        updatedAt: now,
        doneAt: null,
        images: [],
        prepTime: null,
        plannedDate: null,
      };
      state.meals.push(meal);
      return;
    }

    case "updateMeal": {
      const meal = findMeal(state, msg.id);
      if (!meal) return;
      if (msg.title !== undefined) {
        const title = msg.title.trim().slice(0, MAX_TITLE_LENGTH);
        if (title) meal.title = title;
      }
      if (msg.source !== undefined) meal.source = msg.source.slice(0, MAX_SOURCE_LENGTH);
      if (msg.comment !== undefined) meal.comment = msg.comment.slice(0, MAX_COMMENT_LENGTH);
      meal.updatedAt = now;
      return;
    }

    case "setMealStatus": {
      // Comme pour l'id (voir MEAL_ID_RE ci-dessus) : le type ClientMessage
      // ne garantit rien à l'exécution sur un message reçu par websocket,
      // seulement à la compilation côté client. Sans ce contrôle, un statut
      // arbitraire aurait fini dans l'attribut data-status non échappé
      // d'une carte (src/views/list.ts) — même classe de XSS stockée.
      if (!(MEAL_STATUSES as string[]).includes(msg.status)) return;
      const idx = state.meals.findIndex((m) => m.id === msg.id);
      if (idx === -1) return;
      const meal = state.meals[idx];
      meal.status = msg.status;
      meal.updatedAt = now;
      if (msg.status === "fait") {
        // Disparaît de la liste active, part dans l'archive (voir
        // "restoreMeal" pour le remettre en liste plus tard). La date peut
        // être choisie dans la modale (repas noté après coup) ; par défaut,
        // maintenant.
        meal.doneAt = msg.doneAt ?? now;
        state.meals.splice(idx, 1);
        state.archive.unshift(meal);
      }
      return;
    }

    case "setMealNote": {
      // Voir le commentaire dans "setMealStatus" : même risque, même parade.
      if (msg.note !== null && !(MEAL_NOTES as string[]).includes(msg.note)) return;
      const meal = findMeal(state, msg.id);
      if (!meal) return;
      meal.note = msg.note;
      meal.updatedAt = now;
      return;
    }

    case "setMealPrepTime": {
      // Voir le commentaire dans "setMealStatus" : même risque, même parade.
      if (msg.prepTime !== null && !(PREP_TIMES as string[]).includes(msg.prepTime)) return;
      const meal = findMeal(state, msg.id);
      if (!meal) return;
      meal.prepTime = msg.prepTime;
      meal.updatedAt = now;
      return;
    }

    case "setMealPlannedDate": {
      const meal = findMeal(state, msg.id);
      if (!meal) return;
      meal.plannedDate = msg.plannedDate;
      meal.updatedAt = now;
      return;
    }

    // Émis par le worker (pas directement par un client) une fois l'upload
    // effectivement passé en R2 — voir worker/index.ts, qui génère lui-même
    // un imageId frais avant d'appeler cette route interne.
    //
    // Rejeté si le message arrive directement du WebSocket public (internal
    // à false) : sans ce contrôle, n'importe qui ayant le code pourrait
    // déclarer une photo présente sans jamais avoir rien envoyé à R2 — la
    // carte afficherait alors une image cassée pour tout le monde.
    case "addMealImage": {
      if (!internal) return;
      const meal = findMeal(state, msg.id);
      if (!meal) return;
      // Même borne que MAX_MEALS_TOTAL (voir "addMeal") et pour la même
      // raison : sans authentification, rien d'autre n'empêche un client
      // d'accumuler des photos indéfiniment sur un seul repas.
      if (meal.images.length >= MAX_IMAGES_PER_MEAL) return;
      meal.images.push(msg.imageId);
      meal.updatedAt = now;
      return;
    }

    // Même parade que "addMealImage" : rejoué uniquement via /apply, après
    // que le worker a effectivement supprimé l'objet R2 correspondant.
    case "removeMealImage": {
      if (!internal) return;
      const meal = findMeal(state, msg.id);
      if (!meal) return;
      meal.images = meal.images.filter((imageId) => imageId !== msg.imageId);
      meal.updatedAt = now;
      return;
    }

    case "deleteMeal": {
      state.meals = state.meals.filter((m) => m.id !== msg.id);
      return;
    }

    case "deleteArchivedMeal": {
      state.archive = state.archive.filter((m) => m.id !== msg.id);
      return;
    }

    case "restoreMeal": {
      const idx = state.archive.findIndex((m) => m.id === msg.id);
      if (idx === -1) return;
      const [meal] = state.archive.splice(idx, 1);
      meal.status = "idee";
      meal.doneAt = null;
      meal.updatedAt = now;
      meal.order = nextOrder(state.meals);
      state.meals.push(meal);
      return;
    }

    case "reorderMeals": {
      const order = new Map(msg.orderedIds.map((id, idx) => [id, idx]));
      for (const meal of state.meals) {
        const idx = order.get(meal.id);
        if (idx !== undefined) meal.order = idx;
      }
      return;
    }
  }
}

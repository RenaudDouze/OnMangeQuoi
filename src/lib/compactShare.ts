// Lien/QR de partage figé (instantané de la liste, sans code ni
// synchronisation en direct — voir src/views/list.ts) : encode/décode
// purement côté client, sans aucun appel réseau. Distinct de
// src/lib/importExport.ts (export/import JSON), mais alimente le même
// message "importState" une fois décodé plutôt que de dupliquer la
// validation — voir worker/reducer.ts, qui revalide de toute façon tout
// champ venant d'un import, quelle que soit son origine (fichier ou lien).
import * as LZString from "lz-string";
import type { Meal, MealNote, MealStatus, PrepTime } from "../../shared/types";
import { MEAL_STATUSES, MEAL_NOTES, PREP_TIMES, MAX_TITLE_LENGTH, MAX_SOURCE_LENGTH, MAX_COMMENT_LENGTH, MAX_LIST_NAME_LENGTH } from "../../shared/types";
import type { ImportPayload } from "./importExport";

/** Clés courtes, champs par défaut omis : réduit la taille du JSON avant
 * compression, donc du lien/QR final. Pas d'id ni d'ordre : worker/reducer.ts
 * en régénère de toute façon à l'import (voir sanitizeImportedMeal), et pas
 * de photos (Meal.images) : ce sont des ids R2 propres à la liste d'origine,
 * sans aucun sens une fois copiés dans une autre liste (voir
 * worker/index.ts) — inutile de les transporter dans un lien censé rester
 * compact. */
interface CompactMeal {
  t: string;
  s: MealStatus;
  n?: MealNote;
  o?: string;
  c?: string;
  cr: number;
  u: number;
  d?: number;
  p?: PrepTime;
  pd?: number;
}

interface CompactSnapshot {
  n: string;
  m: CompactMeal[];
  a: CompactMeal[];
}

function toCompact(meal: Meal): CompactMeal {
  return {
    t: meal.title,
    s: meal.status,
    ...(meal.note ? { n: meal.note } : {}),
    ...(meal.source ? { o: meal.source } : {}),
    ...(meal.comment ? { c: meal.comment } : {}),
    cr: meal.createdAt,
    u: meal.updatedAt,
    ...(meal.doneAt ? { d: meal.doneAt } : {}),
    ...(meal.prepTime ? { p: meal.prepTime } : {}),
    ...(meal.plannedDate ? { pd: meal.plannedDate } : {}),
  };
}

/** Ne reconstruit qu'une forme plausible de Meal (id/order absents,
 * régénérés à l'import) : la revalidation stricte (statut/note/temps de
 * préparation autorisés, longueurs maximales…) reste de toute façon faite
 * par worker/reducer.ts, jamais dupliquée ici — voir son commentaire sur
 * "importState". */
function fromCompact(raw: Partial<CompactMeal>): Meal {
  return {
    id: "",
    title: typeof raw.t === "string" ? raw.t.slice(0, MAX_TITLE_LENGTH) : "",
    status: typeof raw.s === "string" && (MEAL_STATUSES as string[]).includes(raw.s) ? raw.s : "idee",
    note: typeof raw.n === "string" && (MEAL_NOTES as string[]).includes(raw.n) ? raw.n : null,
    source: typeof raw.o === "string" ? raw.o.slice(0, MAX_SOURCE_LENGTH) : "",
    comment: typeof raw.c === "string" ? raw.c.slice(0, MAX_COMMENT_LENGTH) : "",
    order: 0,
    createdAt: typeof raw.cr === "number" ? raw.cr : Date.now(),
    updatedAt: typeof raw.u === "number" ? raw.u : Date.now(),
    doneAt: typeof raw.d === "number" ? raw.d : null,
    images: [],
    prepTime: typeof raw.p === "string" && (PREP_TIMES as string[]).includes(raw.p) ? raw.p : null,
    plannedDate: typeof raw.pd === "number" ? raw.pd : null,
  };
}

/** Compressé (lz-string) plutôt qu'un simple base64 : un JSON de repas répète
 * beaucoup les mêmes clés/valeurs (statut, temps de préparation…), ce qui
 * compresse bien et réduit nettement la taille du lien/QR partagé. */
export function encodeSnapshotToParam(payload: ImportPayload): string {
  const compact: CompactSnapshot = {
    n: payload.name,
    m: payload.meals.map(toCompact),
    a: payload.archive.map(toCompact),
  };
  return LZString.compressToEncodedURIComponent(JSON.stringify(compact));
}

/** `null` si le paramètre est manquant, invalide, ou ne correspond pas à
 * l'instantané attendu (lien corrompu, tronqué en le copiant/collant…). */
export function decodeSnapshotFromParam(param: string): ImportPayload | null {
  if (!param) return null;
  try {
    const json = LZString.decompressFromEncodedURIComponent(param);
    if (!json) return null;
    const compact = JSON.parse(json) as Partial<CompactSnapshot>;
    if (!Array.isArray(compact.m) || !Array.isArray(compact.a)) return null;
    return {
      name: typeof compact.n === "string" ? compact.n.slice(0, MAX_LIST_NAME_LENGTH) : "",
      meals: compact.m.map(fromCompact),
      archive: compact.a.map(fromCompact),
    };
  } catch {
    return null;
  }
}

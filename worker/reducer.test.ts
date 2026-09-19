import { describe, it, expect } from "vitest";
import { applyMessage, nextOrder, prevOrder, migrateMealImages } from "./reducer";
import type { ListState, Meal } from "../shared/types";
import {
  MAX_TITLE_LENGTH,
  MAX_LIST_NAME_LENGTH,
  MAX_SOURCE_LENGTH,
  MAX_COMMENT_LENGTH,
  MAX_MEALS_TOTAL,
  MAX_IMAGES_PER_MEAL,
} from "../shared/types";

function makeState(overrides: Partial<ListState> = {}): ListState {
  return {
    code: "ABCDEF",
    name: "On mange quoi ?",
    meals: [],
    archive: [],
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  };
}

const NOW = 1_700_000_000_000;

function makeMeal(overrides: Partial<Meal> = {}): Meal {
  return {
    id: "m",
    title: "Repas",
    status: "idee",
    note: null,
    source: "",
    comment: "",
    order: 0,
    createdAt: NOW,
    updatedAt: NOW,
    doneAt: null,
    images: [],
    prepTime: null,
    plannedDate: null,
    ...overrides,
  };
}

describe("nextOrder", () => {
  it("vaut 0 pour une liste vide", () => {
    expect(nextOrder([])).toBe(0);
  });
  it("vaut max(order) + 1 sinon", () => {
    expect(nextOrder([{ order: 0 }, { order: 5 }, { order: 2 }])).toBe(6);
  });
});

describe("prevOrder", () => {
  it("vaut 0 pour une liste vide", () => {
    expect(prevOrder([])).toBe(0);
  });
  it("vaut min(order) - 1 sinon", () => {
    expect(prevOrder([{ order: 0 }, { order: 5 }, { order: 2 }])).toBe(-1);
  });
});

describe("applyMessage: sync", () => {
  it("ne fait rien", () => {
    const state = makeState();
    applyMessage(state, { type: "sync" }, NOW);
    expect(state).toEqual(makeState());
  });
});

describe("applyMessage: renameList", () => {
  it("renomme la liste", () => {
    const state = makeState();
    applyMessage(state, { type: "renameList", name: "Nos repas" }, NOW);
    expect(state.name).toBe("Nos repas");
  });

  it("ignore un nom vide", () => {
    const state = makeState();
    applyMessage(state, { type: "renameList", name: "   " }, NOW);
    expect(state.name).toBe("On mange quoi ?");
  });

  it("tronque un nom trop long (personne n'est authentifié pour écrire dans une liste)", () => {
    const state = makeState();
    applyMessage(state, { type: "renameList", name: "x".repeat(MAX_LIST_NAME_LENGTH + 50) }, NOW);
    expect(state.name).toBe("x".repeat(MAX_LIST_NAME_LENGTH));
  });
});

describe("applyMessage: addMeal", () => {
  it("ajoute un repas avec le statut initial idée", () => {
    const state = makeState();
    applyMessage(state, { type: "addMeal", id: "m1", title: "Tartiflette" }, NOW);
    expect(state.meals).toEqual([
      {
        id: "m1",
        title: "Tartiflette",
        status: "idee",
        note: null,
        source: "",
        comment: "",
        order: 0,
        createdAt: NOW,
        updatedAt: NOW,
        doneAt: null,
        images: [],
        prepTime: null,
        plannedDate: null,
      },
    ]);
  });

  it("ignore un titre vide", () => {
    const state = makeState();
    applyMessage(state, { type: "addMeal", id: "m1", title: "   " }, NOW);
    expect(state.meals).toEqual([]);
  });

  it("décrémente order pour chaque ajout, pour que le plus récent arrive en tête", () => {
    const state = makeState();
    applyMessage(state, { type: "addMeal", id: "m1", title: "A" }, NOW);
    applyMessage(state, { type: "addMeal", id: "m2", title: "B" }, NOW);
    expect(state.meals.map((m) => m.order)).toEqual([0, -1]);
  });

  it("tronque un titre trop long", () => {
    const state = makeState();
    applyMessage(state, { type: "addMeal", id: "m1", title: "x".repeat(MAX_TITLE_LENGTH + 50) }, NOW);
    expect(state.meals[0].title).toBe("x".repeat(MAX_TITLE_LENGTH));
  });

  it("ignore un id mal formé (personne n'est authentifié pour écrire dans une liste)", () => {
    const state = makeState();
    applyMessage(state, { type: "addMeal", id: 'x" onload="alert(1)', title: "A" }, NOW);
    expect(state.meals).toEqual([]);
  });

  it("ignore l'ajout au-delà de MAX_MEALS_TOTAL repas (actifs + archivés)", () => {
    const state = makeState({
      meals: Array.from({ length: MAX_MEALS_TOTAL }, (_, i) => makeMeal({ id: `existing-${i}`, order: i })),
    });
    applyMessage(state, { type: "addMeal", id: "trop", title: "Un de trop" }, NOW);
    expect(state.meals).toHaveLength(MAX_MEALS_TOTAL);
    expect(state.meals.some((m) => m.id === "trop")).toBe(false);
  });

  it("compte actifs ET archivés ensemble pour MAX_MEALS_TOTAL, pas seulement les actifs", () => {
    const state = makeState({
      meals: Array.from({ length: MAX_MEALS_TOTAL - 1 }, (_, i) => makeMeal({ id: `existing-${i}`, order: i })),
      archive: [makeMeal({ id: "archived-1", status: "fait" })],
    });
    applyMessage(state, { type: "addMeal", id: "trop", title: "Un de trop" }, NOW);
    expect(state.meals).toHaveLength(MAX_MEALS_TOTAL - 1);
    expect(state.meals.some((m) => m.id === "trop")).toBe(false);
  });

  it("ignore un id dont seule la fin ressemble à un id valide (l'ancre ^ du motif compte)", () => {
    const state = makeState();
    applyMessage(state, { type: "addMeal", id: "../etc/passwd", title: "A" }, NOW);
    expect(state.meals).toEqual([]);
  });
});

describe("applyMessage: updateMeal", () => {
  it("met à jour titre, source et commentaire d'un repas actif", () => {
    const state = makeState();
    applyMessage(state, { type: "addMeal", id: "m1", title: "Tartiflette" }, NOW);
    applyMessage(
      state,
      {
        type: "updateMeal",
        id: "m1",
        title: "Tartiflette maison",
        source: "https://example.com/recette",
        comment: "Ça a l'air simple, un peu trop crémeux au final",
      },
      NOW + 1,
    );
    const meal = state.meals[0];
    expect(meal.title).toBe("Tartiflette maison");
    expect(meal.source).toBe("https://example.com/recette");
    expect(meal.comment).toBe("Ça a l'air simple, un peu trop crémeux au final");
    expect(meal.updatedAt).toBe(NOW + 1);
  });

  it("ignore un titre vide mais garde les autres champs modifiables vides", () => {
    const state = makeState();
    applyMessage(state, { type: "addMeal", id: "m1", title: "Tartiflette" }, NOW);
    applyMessage(state, { type: "updateMeal", id: "m1", title: "   ", source: "" }, NOW + 1);
    expect(state.meals[0].title).toBe("Tartiflette");
    expect(state.meals[0].source).toBe("");
  });

  it("peut modifier un repas archivé", () => {
    const state = makeState({
      archive: [
        {
          id: "m1",
          title: "Tartiflette",
          status: "fait",
          note: null,
          source: "",
          comment: "",
          order: 0,
          createdAt: NOW,
          updatedAt: NOW,
          doneAt: NOW,
          images: [],
          prepTime: null,
          plannedDate: null,
        },
      ],
    });
    applyMessage(state, { type: "updateMeal", id: "m1", comment: "Excellent" }, NOW + 1);
    expect(state.archive[0].comment).toBe("Excellent");
  });

  it("ignore un id inconnu", () => {
    const state = makeState();
    applyMessage(state, { type: "updateMeal", id: "ghost", title: "X" }, NOW);
    expect(state.meals).toEqual([]);
  });

  it("modifie le bon repas actif quand plusieurs existent", () => {
    const state = makeState();
    applyMessage(state, { type: "addMeal", id: "m1", title: "A" }, NOW);
    applyMessage(state, { type: "addMeal", id: "m2", title: "B" }, NOW);
    applyMessage(state, { type: "updateMeal", id: "m2", title: "B modifié" }, NOW + 1);
    expect(state.meals.find((m) => m.id === "m1")!.title).toBe("A");
    expect(state.meals.find((m) => m.id === "m2")!.title).toBe("B modifié");
  });

  it("modifie le bon repas archivé quand plusieurs existent", () => {
    const state = makeState({
      archive: [makeMeal({ id: "m1", title: "A", status: "fait" }), makeMeal({ id: "m2", title: "B", status: "fait" })],
    });
    applyMessage(state, { type: "updateMeal", id: "m2", comment: "Excellent" }, NOW + 1);
    expect(state.archive.find((m) => m.id === "m1")!.comment).toBe("");
    expect(state.archive.find((m) => m.id === "m2")!.comment).toBe("Excellent");
  });

  it("tronque titre, source et commentaire trop longs", () => {
    const state = makeState();
    applyMessage(state, { type: "addMeal", id: "m1", title: "Tartiflette" }, NOW);
    applyMessage(
      state,
      {
        type: "updateMeal",
        id: "m1",
        title: "x".repeat(MAX_TITLE_LENGTH + 10),
        source: "y".repeat(MAX_SOURCE_LENGTH + 10),
        comment: "z".repeat(MAX_COMMENT_LENGTH + 10),
      },
      NOW + 1,
    );
    const meal = state.meals[0];
    expect(meal.title).toBe("x".repeat(MAX_TITLE_LENGTH));
    expect(meal.source).toBe("y".repeat(MAX_SOURCE_LENGTH));
    expect(meal.comment).toBe("z".repeat(MAX_COMMENT_LENGTH));
  });
});

describe("applyMessage: setMealStatus", () => {
  it("change le statut d'un repas actif", () => {
    const state = makeState();
    applyMessage(state, { type: "addMeal", id: "m1", title: "Tartiflette" }, NOW);
    applyMessage(state, { type: "setMealStatus", id: "m1", status: "validee" }, NOW + 1);
    expect(state.meals[0].status).toBe("validee");
    expect(state.meals[0].updatedAt).toBe(NOW + 1);
  });

  it("passer à 'fait' déplace le repas de meals vers archive", () => {
    const state = makeState();
    applyMessage(state, { type: "addMeal", id: "m1", title: "Tartiflette" }, NOW);
    applyMessage(state, { type: "setMealStatus", id: "m1", status: "fait" }, NOW + 1);
    expect(state.meals).toEqual([]);
    expect(state.archive).toHaveLength(1);
    expect(state.archive[0]).toMatchObject({ id: "m1", status: "fait", doneAt: NOW + 1 });
  });

  it("un repas fraîchement archivé arrive en tête d'archive", () => {
    const state = makeState();
    applyMessage(state, { type: "addMeal", id: "m1", title: "A" }, NOW);
    applyMessage(state, { type: "addMeal", id: "m2", title: "B" }, NOW);
    applyMessage(state, { type: "setMealStatus", id: "m1", status: "fait" }, NOW + 1);
    applyMessage(state, { type: "setMealStatus", id: "m2", status: "fait" }, NOW + 2);
    expect(state.archive.map((m) => m.id)).toEqual(["m2", "m1"]);
  });

  it("ignore un id inconnu ou déjà archivé", () => {
    const state = makeState();
    applyMessage(state, { type: "setMealStatus", id: "ghost", status: "fait" }, NOW);
    expect(state.meals).toEqual([]);
    expect(state.archive).toEqual([]);
  });

  it("ignore un statut hors de l'enum (personne n'est authentifié pour écrire dans une liste)", () => {
    const state = makeState();
    applyMessage(state, { type: "addMeal", id: "m1", title: "Tartiflette" }, NOW);
    // @ts-expect-error message forgé volontairement invalide, pour tester la défense côté serveur
    applyMessage(state, { type: "setMealStatus", id: "m1", status: 'x" onmouseover="alert(1)' }, NOW + 1);
    expect(state.meals[0].status).toBe("idee");
  });

  it("change le statut du bon repas actif quand plusieurs existent", () => {
    const state = makeState();
    applyMessage(state, { type: "addMeal", id: "m1", title: "A" }, NOW);
    applyMessage(state, { type: "addMeal", id: "m2", title: "B" }, NOW);
    applyMessage(state, { type: "setMealStatus", id: "m2", status: "validee" }, NOW + 1);
    expect(state.meals.find((m) => m.id === "m1")!.status).toBe("idee");
    expect(state.meals.find((m) => m.id === "m2")!.status).toBe("validee");
  });

  it("un doneAt explicite (repas noté après coup) est utilisé à la place de 'now'", () => {
    const state = makeState();
    const chosenDate = NOW - 1000 * 60 * 60 * 24 * 3; // il y a 3 jours
    applyMessage(state, { type: "addMeal", id: "m1", title: "Tartiflette" }, NOW);
    applyMessage(state, { type: "setMealStatus", id: "m1", status: "fait", doneAt: chosenDate }, NOW + 1);
    expect(state.archive[0].doneAt).toBe(chosenDate);
    expect(state.archive[0].updatedAt).toBe(NOW + 1);
  });
});

describe("applyMessage: setMealNote", () => {
  it("pose une note sur un repas actif", () => {
    const state = makeState();
    applyMessage(state, { type: "addMeal", id: "m1", title: "Tartiflette" }, NOW);
    applyMessage(state, { type: "setMealNote", id: "m1", note: "de_temps_en_temps" }, NOW + 1);
    expect(state.meals[0].note).toBe("de_temps_en_temps");
  });

  it("pose une note sur un repas archivé", () => {
    const state = makeState();
    applyMessage(state, { type: "addMeal", id: "m1", title: "Tartiflette" }, NOW);
    applyMessage(state, { type: "setMealStatus", id: "m1", status: "fait" }, NOW + 1);
    applyMessage(state, { type: "setMealNote", id: "m1", note: "plus_jamais" }, NOW + 2);
    expect(state.archive[0].note).toBe("plus_jamais");
  });

  it("peut effacer une note (null)", () => {
    const state = makeState();
    applyMessage(state, { type: "addMeal", id: "m1", title: "Tartiflette" }, NOW);
    applyMessage(state, { type: "setMealNote", id: "m1", note: "mouais" }, NOW + 1);
    applyMessage(state, { type: "setMealNote", id: "m1", note: null }, NOW + 2);
    expect(state.meals[0].note).toBeNull();
  });

  it("ignore un id inconnu", () => {
    const state = makeState();
    applyMessage(state, { type: "setMealNote", id: "ghost", note: "mouais" }, NOW);
    expect(state.meals).toEqual([]);
  });

  it("ignore une note hors de l'enum (personne n'est authentifié pour écrire dans une liste)", () => {
    const state = makeState();
    applyMessage(state, { type: "addMeal", id: "m1", title: "Tartiflette" }, NOW);
    // @ts-expect-error message forgé volontairement invalide, pour tester la défense côté serveur
    applyMessage(state, { type: "setMealNote", id: "m1", note: 'x" onmouseover="alert(1)' }, NOW + 1);
    expect(state.meals[0].note).toBeNull();
  });
});

describe("applyMessage: setMealPrepTime", () => {
  it("pose un temps de préparation sur un repas actif", () => {
    const state = makeState();
    applyMessage(state, { type: "addMeal", id: "m1", title: "Tartiflette" }, NOW);
    applyMessage(state, { type: "setMealPrepTime", id: "m1", prepTime: "long" }, NOW + 1);
    expect(state.meals[0].prepTime).toBe("long");
    expect(state.meals[0].updatedAt).toBe(NOW + 1);
  });

  it("pose un temps de préparation sur un repas archivé", () => {
    const state = makeState();
    applyMessage(state, { type: "addMeal", id: "m1", title: "Tartiflette" }, NOW);
    applyMessage(state, { type: "setMealStatus", id: "m1", status: "fait" }, NOW + 1);
    applyMessage(state, { type: "setMealPrepTime", id: "m1", prepTime: "rapide" }, NOW + 2);
    expect(state.archive[0].prepTime).toBe("rapide");
  });

  it("peut effacer un temps de préparation (null)", () => {
    const state = makeState();
    applyMessage(state, { type: "addMeal", id: "m1", title: "Tartiflette" }, NOW);
    applyMessage(state, { type: "setMealPrepTime", id: "m1", prepTime: "normal" }, NOW + 1);
    applyMessage(state, { type: "setMealPrepTime", id: "m1", prepTime: null }, NOW + 2);
    expect(state.meals[0].prepTime).toBeNull();
  });

  it("ignore un id inconnu", () => {
    const state = makeState();
    applyMessage(state, { type: "setMealPrepTime", id: "ghost", prepTime: "rapide" }, NOW);
    expect(state.meals).toEqual([]);
  });

  it("ignore un temps de préparation hors de l'enum (personne n'est authentifié pour écrire dans une liste)", () => {
    const state = makeState();
    applyMessage(state, { type: "addMeal", id: "m1", title: "Tartiflette" }, NOW);
    // @ts-expect-error message forgé volontairement invalide, pour tester la défense côté serveur
    applyMessage(state, { type: "setMealPrepTime", id: "m1", prepTime: 'x" onmouseover="alert(1)' }, NOW + 1);
    expect(state.meals[0].prepTime).toBeNull();
  });
});

describe("applyMessage: setMealPlannedDate", () => {
  it("planifie un repas actif à une date", () => {
    const state = makeState();
    applyMessage(state, { type: "addMeal", id: "m1", title: "Tartiflette" }, NOW);
    applyMessage(state, { type: "setMealPlannedDate", id: "m1", plannedDate: NOW + 86_400_000 }, NOW + 1);
    expect(state.meals[0].plannedDate).toBe(NOW + 86_400_000);
    expect(state.meals[0].updatedAt).toBe(NOW + 1);
  });

  it("peut effacer une date planifiée (null)", () => {
    const state = makeState();
    applyMessage(state, { type: "addMeal", id: "m1", title: "Tartiflette" }, NOW);
    applyMessage(state, { type: "setMealPlannedDate", id: "m1", plannedDate: NOW }, NOW + 1);
    applyMessage(state, { type: "setMealPlannedDate", id: "m1", plannedDate: null }, NOW + 2);
    expect(state.meals[0].plannedDate).toBeNull();
  });

  it("ignore un id inconnu", () => {
    const state = makeState();
    applyMessage(state, { type: "setMealPlannedDate", id: "ghost", plannedDate: NOW }, NOW);
    expect(state.meals).toEqual([]);
  });

  it("planifie le bon repas actif quand plusieurs existent", () => {
    const state = makeState();
    applyMessage(state, { type: "addMeal", id: "m1", title: "A" }, NOW);
    applyMessage(state, { type: "addMeal", id: "m2", title: "B" }, NOW);
    applyMessage(state, { type: "setMealPlannedDate", id: "m2", plannedDate: NOW }, NOW + 1);
    expect(state.meals.find((m) => m.id === "m1")!.plannedDate).toBeNull();
    expect(state.meals.find((m) => m.id === "m2")!.plannedDate).toBe(NOW);
  });
});

describe("applyMessage: addMealImage", () => {
  it("ajoute une photo à un repas actif", () => {
    const state = makeState();
    applyMessage(state, { type: "addMeal", id: "m1", title: "Tartiflette" }, NOW);
    applyMessage(state, { type: "addMealImage", id: "m1", imageId: "img1" }, NOW + 1, true);
    expect(state.meals[0].images).toEqual(["img1"]);
    expect(state.meals[0].updatedAt).toBe(NOW + 1);
  });

  it("accumule plusieurs photos, dans l'ordre d'ajout", () => {
    const state = makeState();
    applyMessage(state, { type: "addMeal", id: "m1", title: "Tartiflette" }, NOW);
    applyMessage(state, { type: "addMealImage", id: "m1", imageId: "img1" }, NOW + 1, true);
    applyMessage(state, { type: "addMealImage", id: "m1", imageId: "img2" }, NOW + 2, true);
    expect(state.meals[0].images).toEqual(["img1", "img2"]);
  });

  it("peut ajouter une photo à un repas archivé", () => {
    const state = makeState();
    applyMessage(state, { type: "addMeal", id: "m1", title: "Tartiflette" }, NOW);
    applyMessage(state, { type: "setMealStatus", id: "m1", status: "fait" }, NOW + 1);
    applyMessage(state, { type: "addMealImage", id: "m1", imageId: "img1" }, NOW + 2, true);
    expect(state.archive[0].images).toEqual(["img1"]);
  });

  it("ignore un id inconnu", () => {
    const state = makeState();
    applyMessage(state, { type: "addMealImage", id: "ghost", imageId: "img1" }, NOW, true);
    expect(state.meals).toEqual([]);
    expect(state.archive).toEqual([]);
  });

  it("ignore un message reçu directement (pas rejoué via la route interne /apply)", () => {
    const state = makeState();
    applyMessage(state, { type: "addMeal", id: "m1", title: "Tartiflette" }, NOW);
    applyMessage(state, { type: "addMealImage", id: "m1", imageId: "img1" }, NOW + 1);
    expect(state.meals[0].images).toEqual([]);
  });

  it("ignore l'ajout au-delà de MAX_IMAGES_PER_MEAL photos", () => {
    const state = makeState({
      meals: [makeMeal({ id: "m1", images: Array.from({ length: MAX_IMAGES_PER_MEAL }, (_, i) => `img${i}`) })],
    });
    applyMessage(state, { type: "addMealImage", id: "m1", imageId: "trop" }, NOW, true);
    expect(state.meals[0].images).toHaveLength(MAX_IMAGES_PER_MEAL);
    expect(state.meals[0].images).not.toContain("trop");
  });
});

describe("applyMessage: removeMealImage", () => {
  it("retire une photo d'un repas actif", () => {
    const state = makeState({ meals: [makeMeal({ id: "m1", images: ["img1", "img2"] })] });
    applyMessage(state, { type: "removeMealImage", id: "m1", imageId: "img1" }, NOW + 1, true);
    expect(state.meals[0].images).toEqual(["img2"]);
    expect(state.meals[0].updatedAt).toBe(NOW + 1);
  });

  it("ignore un id de repas inconnu", () => {
    const state = makeState();
    applyMessage(state, { type: "removeMealImage", id: "ghost", imageId: "img1" }, NOW, true);
    expect(state.meals).toEqual([]);
  });

  it("ignore un message reçu directement (pas rejoué via la route interne /apply)", () => {
    const state = makeState({ meals: [makeMeal({ id: "m1", images: ["img1"] })] });
    applyMessage(state, { type: "removeMealImage", id: "m1", imageId: "img1" }, NOW + 1);
    expect(state.meals[0].images).toEqual(["img1"]);
  });
});

/** Simule un repas tel que persisté par une liste créée avant l'ajout des
 * photos multiples : `images` n'existe pas, `hasImage`/`imageVersion` à la
 * place (voir migrateMealImages dans reducer.ts). Le cast est nécessaire et
 * volontaire — c'est exactement le genre de valeur "d'avant" que la
 * migration doit savoir gérer sans planter. */
function legacyMeal(overrides: Partial<Meal> & { hasImage: boolean; imageVersion?: number } = { hasImage: false }): Meal {
  const meal = makeMeal(overrides) as unknown as Record<string, unknown>;
  delete meal.images;
  meal.hasImage = overrides.hasImage;
  meal.imageVersion = overrides.imageVersion ?? 0;
  return meal as unknown as Meal;
}

describe("migrateMealImages", () => {
  it("convertit hasImage=true en un tableau images contenant l'id du repas", () => {
    const state = makeState({ meals: [legacyMeal({ id: "m1", hasImage: true, imageVersion: 3 })] });
    const migrated = migrateMealImages(state);
    expect(migrated).toBe(true);
    expect(state.meals[0].images).toEqual(["m1"]);
    expect(state.meals[0]).not.toHaveProperty("hasImage");
    expect(state.meals[0]).not.toHaveProperty("imageVersion");
  });

  it("convertit hasImage=false en tableau vide", () => {
    const state = makeState({ meals: [legacyMeal({ id: "m1", hasImage: false })] });
    migrateMealImages(state);
    expect(state.meals[0].images).toEqual([]);
  });

  it("migre aussi les repas archivés", () => {
    const state = makeState({ archive: [legacyMeal({ id: "m1", status: "fait", hasImage: true })] });
    migrateMealImages(state);
    expect(state.archive[0].images).toEqual(["m1"]);
  });

  it("ne retouche pas un repas déjà migré (idempotent), et signale l'absence de migration", () => {
    const state = makeState({ meals: [makeMeal({ id: "m1", images: ["img1"] })] });
    const migrated = migrateMealImages(state);
    expect(migrated).toBe(false);
    expect(state.meals[0].images).toEqual(["img1"]);
  });
});

describe("applyMessage: deleteMeal", () => {
  it("supprime un repas actif", () => {
    const state = makeState();
    applyMessage(state, { type: "addMeal", id: "m1", title: "A" }, NOW);
    applyMessage(state, { type: "deleteMeal", id: "m1" }, NOW);
    expect(state.meals).toEqual([]);
  });

  it("ne supprime que le repas actif ciblé quand plusieurs existent", () => {
    const state = makeState();
    applyMessage(state, { type: "addMeal", id: "m1", title: "A" }, NOW);
    applyMessage(state, { type: "addMeal", id: "m2", title: "B" }, NOW);
    applyMessage(state, { type: "deleteMeal", id: "m1" }, NOW);
    expect(state.meals.map((m) => m.id)).toEqual(["m2"]);
  });
});

describe("applyMessage: deleteArchivedMeal", () => {
  it("supprime définitivement un repas archivé, sans le faire réapparaître en liste active", () => {
    const state = makeState();
    applyMessage(state, { type: "addMeal", id: "m1", title: "A" }, NOW);
    applyMessage(state, { type: "setMealStatus", id: "m1", status: "fait" }, NOW);
    applyMessage(state, { type: "deleteArchivedMeal", id: "m1" }, NOW);
    expect(state.archive).toEqual([]);
    expect(state.meals).toEqual([]);
  });

  it("ne supprime que le repas archivé ciblé quand plusieurs existent", () => {
    const state = makeState({ archive: [makeMeal({ id: "m1", status: "fait" }), makeMeal({ id: "m2", status: "fait" })] });
    applyMessage(state, { type: "deleteArchivedMeal", id: "m1" }, NOW);
    expect(state.archive.map((m) => m.id)).toEqual(["m2"]);
  });
});

describe("applyMessage: restoreMeal", () => {
  it("remet un repas archivé dans la liste active, statut réinitialisé à idée", () => {
    const state = makeState();
    applyMessage(state, { type: "addMeal", id: "m1", title: "Tartiflette" }, NOW);
    applyMessage(state, { type: "setMealNote", id: "m1", note: "de_temps_en_temps" }, NOW);
    applyMessage(state, { type: "setMealStatus", id: "m1", status: "fait" }, NOW + 1);
    applyMessage(state, { type: "restoreMeal", id: "m1" }, NOW + 2);
    expect(state.archive).toEqual([]);
    expect(state.meals).toHaveLength(1);
    const meal = state.meals[0];
    expect(meal.status).toBe("idee");
    expect(meal.doneAt).toBeNull();
    expect(meal.note).toBe("de_temps_en_temps");
    expect(meal.updatedAt).toBe(NOW + 2);
  });

  it("place le repas restauré après les repas actifs existants", () => {
    const state = makeState();
    applyMessage(state, { type: "addMeal", id: "m1", title: "A" }, NOW);
    applyMessage(state, { type: "setMealStatus", id: "m1", status: "fait" }, NOW);
    applyMessage(state, { type: "addMeal", id: "m2", title: "B" }, NOW);
    applyMessage(state, { type: "restoreMeal", id: "m1" }, NOW);
    expect(state.meals.map((m) => m.id)).toEqual(["m2", "m1"]);
  });

  it("ignore un id inconnu", () => {
    const state = makeState();
    applyMessage(state, { type: "restoreMeal", id: "ghost" }, NOW);
    expect(state.meals).toEqual([]);
  });

  it("restaure le bon repas archivé quand plusieurs existent", () => {
    const state = makeState({ archive: [makeMeal({ id: "m1", status: "fait" }), makeMeal({ id: "m2", status: "fait" })] });
    applyMessage(state, { type: "restoreMeal", id: "m2" }, NOW);
    expect(state.archive.map((m) => m.id)).toEqual(["m1"]);
    expect(state.meals.map((m) => m.id)).toEqual(["m2"]);
  });
});

describe("applyMessage: importState", () => {
  describe("mode replace", () => {
    it("remplace entièrement meals/archive et le nom", () => {
      const state = makeState({ meals: [makeMeal({ id: "old", title: "Ancien" })] });
      applyMessage(
        state,
        {
          type: "importState",
          mode: "replace",
          data: {
            name: "Liste importée",
            meals: [makeMeal({ id: "n1", title: "Nouveau" })],
            archive: [makeMeal({ id: "n2", title: "Archivé", status: "fait" })],
          },
        },
        NOW,
      );
      expect(state.name).toBe("Liste importée");
      expect(state.meals.map((m) => m.id)).toEqual(["n1"]);
      expect(state.archive.map((m) => m.id)).toEqual(["n2"]);
    });

    it("garde le nom actuel si le nom importé est fait uniquement d'espaces", () => {
      const state = makeState({ name: "Nom actuel" });
      applyMessage(
        state,
        { type: "importState", mode: "replace", data: { name: "   ", meals: [], archive: [] } },
        NOW,
      );
      expect(state.name).toBe("Nom actuel");
    });

    it("garde le nom actuel si le nom importé est une chaîne vide", () => {
      const state = makeState({ name: "Nom actuel" });
      applyMessage(state, { type: "importState", mode: "replace", data: { name: "", meals: [], archive: [] } }, NOW);
      expect(state.name).toBe("Nom actuel");
    });

    it("ne plante pas si le nom importé est absent (message malformé)", () => {
      const state = makeState({ name: "Nom actuel" });
      const data = { name: undefined, meals: [], archive: [] } as unknown as { name: string; meals: Meal[]; archive: Meal[] };
      expect(() => applyMessage(state, { type: "importState", mode: "replace", data }, NOW)).not.toThrow();
      expect(state.name).toBe("Nom actuel");
    });

    it("écarte un repas archivé dont le titre est vide une fois nettoyé", () => {
      const state = makeState();
      applyMessage(
        state,
        { type: "importState", mode: "replace", data: { name: "L", meals: [], archive: [makeMeal({ title: "   " })] } },
        NOW,
      );
      expect(state.archive).toEqual([]);
    });

    it("regénère un id invalide plutôt que de le recopier", () => {
      const state = makeState();
      applyMessage(
        state,
        { type: "importState", mode: "replace", data: { name: "L", meals: [makeMeal({ id: "id invalide !" })], archive: [] } },
        NOW,
      );
      expect(state.meals[0].id).not.toBe("id invalide !");
      expect(state.meals[0].id).toMatch(/^[A-Za-z0-9_-]{1,64}$/);
    });

    it("regénère un id qui n'est pas une chaîne, même s'il ressemblerait à un id valide une fois converti en texte", () => {
      const state = makeState();
      const raw = { ...makeMeal(), id: 123456 } as unknown as Meal;
      applyMessage(state, { type: "importState", mode: "replace", data: { name: "L", meals: [raw], archive: [] } }, NOW);
      expect(typeof state.meals[0].id).toBe("string");
      expect(state.meals[0].id).not.toBe(123456);
    });

    it("garde un id déjà valide", () => {
      const state = makeState();
      applyMessage(
        state,
        { type: "importState", mode: "replace", data: { name: "L", meals: [makeMeal({ id: "valid-id_1" })], archive: [] } },
        NOW,
      );
      expect(state.meals[0].id).toBe("valid-id_1");
    });

    it("écarte un repas dont le titre est vide une fois nettoyé", () => {
      const state = makeState();
      applyMessage(
        state,
        { type: "importState", mode: "replace", data: { name: "L", meals: [makeMeal({ title: "   " })], archive: [] } },
        NOW,
      );
      expect(state.meals).toEqual([]);
    });

    it("écarte un repas dont le titre n'est pas une chaîne", () => {
      const state = makeState();
      const raw = { ...makeMeal(), title: 42 } as unknown as Meal;
      applyMessage(state, { type: "importState", mode: "replace", data: { name: "L", meals: [raw], archive: [] } }, NOW);
      expect(state.meals).toEqual([]);
    });

    it("retombe sur des valeurs par défaut pour les champs invalides/absents", () => {
      const state = makeState();
      const raw = {
        id: "m1",
        title: "Repas",
        status: "statut-invalide",
        note: "note-invalide",
        source: 42,
        comment: null,
        createdAt: "pas un nombre",
        doneAt: "pas un nombre",
        images: "pas un tableau",
        prepTime: "preptime-invalide",
        plannedDate: "pas un nombre",
      } as unknown as Meal;
      applyMessage(state, { type: "importState", mode: "replace", data: { name: "L", meals: [raw], archive: [] } }, NOW);
      const meal = state.meals[0];
      expect(meal.status).toBe("idee");
      expect(meal.note).toBeNull();
      expect(meal.source).toBe("");
      expect(meal.comment).toBe("");
      expect(meal.createdAt).toBe(NOW);
      expect(meal.updatedAt).toBe(NOW);
      expect(meal.doneAt).toBeNull();
      expect(meal.images).toEqual([]);
      expect(meal.prepTime).toBeNull();
      expect(meal.plannedDate).toBeNull();
    });

    it("conserve les valeurs valides (statut, note, temps de préparation, dates, photos)", () => {
      const state = makeState();
      const raw = makeMeal({
        id: "m1",
        title: "Repas",
        status: "validee",
        note: "quand_tu_veux",
        source: "https://exemple.fr",
        comment: "Un commentaire",
        createdAt: 111,
        doneAt: 222,
        images: ["img1", "img2"],
        prepTime: "rapide",
        plannedDate: 333,
      });
      applyMessage(state, { type: "importState", mode: "replace", data: { name: "L", meals: [raw], archive: [] } }, NOW);
      const meal = state.meals[0];
      expect(meal.status).toBe("validee");
      expect(meal.note).toBe("quand_tu_veux");
      expect(meal.source).toBe("https://exemple.fr");
      expect(meal.comment).toBe("Un commentaire");
      expect(meal.createdAt).toBe(111);
      expect(meal.doneAt).toBe(222);
      expect(meal.images).toEqual(["img1", "img2"]);
      expect(meal.prepTime).toBe("rapide");
      expect(meal.plannedDate).toBe(333);
    });

    it("filtre les entrées non-chaînes d'images (y compris avant la troncature)", () => {
      const state = makeState();
      // "42" est placé avant la fin pour distinguer filtrer-puis-tronquer de
      // tronquer-seul : si on ne filtrait pas, il resterait dans le résultat.
      const raw = makeMeal({ images: ["img1", 42, "img2", null] as unknown as string[] });
      applyMessage(state, { type: "importState", mode: "replace", data: { name: "L", meals: [raw], archive: [] } }, NOW);
      expect(state.meals[0].images).toEqual(["img1", "img2"]);
    });

    it("plafonne les images à MAX_IMAGES_PER_MEAL", () => {
      const state = makeState();
      const tooMany = Array.from({ length: MAX_IMAGES_PER_MEAL + 5 }, (_, i) => `img${i}`);
      const raw = makeMeal({ images: tooMany });
      applyMessage(state, { type: "importState", mode: "replace", data: { name: "L", meals: [raw], archive: [] } }, NOW);
      expect(state.meals[0].images).toEqual(tooMany.slice(0, MAX_IMAGES_PER_MEAL));
    });

    it("tronque le titre, la source et le commentaire aux longueurs maximales", () => {
      const state = makeState();
      const raw = makeMeal({
        title: "T".repeat(MAX_TITLE_LENGTH + 10),
        source: "S".repeat(MAX_SOURCE_LENGTH + 10),
        comment: "C".repeat(MAX_COMMENT_LENGTH + 10),
      });
      applyMessage(state, { type: "importState", mode: "replace", data: { name: "L", meals: [raw], archive: [] } }, NOW);
      const meal = state.meals[0];
      expect(meal.title).toHaveLength(MAX_TITLE_LENGTH);
      expect(meal.source).toHaveLength(MAX_SOURCE_LENGTH);
      expect(meal.comment).toHaveLength(MAX_COMMENT_LENGTH);
    });

    it("tronque le nom de liste importé à MAX_LIST_NAME_LENGTH", () => {
      const state = makeState();
      applyMessage(
        state,
        { type: "importState", mode: "replace", data: { name: "N".repeat(MAX_LIST_NAME_LENGTH + 10), meals: [], archive: [] } },
        NOW,
      );
      expect(state.name).toHaveLength(MAX_LIST_NAME_LENGTH);
    });

    it("plafonne le total importé à MAX_MEALS_TOTAL, priorité aux repas actifs", () => {
      const state = makeState();
      const meals = Array.from({ length: MAX_MEALS_TOTAL - 1 }, (_, i) => makeMeal({ id: `m${i}`, title: `M${i}` }));
      const archive = [makeMeal({ id: "a1", title: "A1" }), makeMeal({ id: "a2", title: "A2" })];
      applyMessage(state, { type: "importState", mode: "replace", data: { name: "L", meals, archive } }, NOW);
      expect(state.meals).toHaveLength(MAX_MEALS_TOTAL - 1);
      expect(state.archive).toHaveLength(1);
      expect(state.archive[0].id).toBe("a1");
    });

    it("n'importe aucun repas archivé si les repas actifs seuls atteignent déjà le plafond", () => {
      const state = makeState();
      const meals = Array.from({ length: MAX_MEALS_TOTAL + 5 }, (_, i) => makeMeal({ id: `m${i}`, title: `M${i}` }));
      applyMessage(
        state,
        { type: "importState", mode: "replace", data: { name: "L", meals, archive: [makeMeal({ id: "a1", title: "A1" })] } },
        NOW,
      );
      expect(state.meals).toHaveLength(MAX_MEALS_TOTAL);
      expect(state.archive).toEqual([]);
    });
  });

  describe("mode merge", () => {
    it("ajoute les nouveaux repas actifs et archivés à la suite de l'existant", () => {
      const state = makeState({ meals: [makeMeal({ id: "e1", title: "Existant" })] });
      applyMessage(
        state,
        {
          type: "importState",
          mode: "merge",
          data: { name: "L", meals: [makeMeal({ id: "n1", title: "Nouveau" })], archive: [makeMeal({ id: "n2", title: "Archivé" })] },
        },
        NOW,
      );
      expect(state.meals.map((m) => m.id)).toEqual(["e1", "n1"]);
      expect(state.archive.map((m) => m.id)).toEqual(["n2"]);
      expect(state.meals[1].order).toBe(1);
    });

    it("ignore un titre déjà présent parmi les repas actifs, insensible à la casse et aux espaces", () => {
      const state = makeState({ meals: [makeMeal({ id: "e1", title: "Tartiflette" })] });
      applyMessage(
        state,
        { type: "importState", mode: "merge", data: { name: "L", meals: [makeMeal({ id: "n1", title: "  tartiflette  " })], archive: [] } },
        NOW,
      );
      expect(state.meals).toHaveLength(1);
    });

    it("ignore un titre déjà présent parmi les repas archivés", () => {
      const state = makeState({ archive: [makeMeal({ id: "e1", title: "Tartiflette", status: "fait" })] });
      applyMessage(
        state,
        { type: "importState", mode: "merge", data: { name: "L", meals: [makeMeal({ id: "n1", title: "Tartiflette" })], archive: [] } },
        NOW,
      );
      expect(state.meals).toEqual([]);
    });

    it("n'ajoute pas un repas dont le titre est vide une fois nettoyé", () => {
      const state = makeState();
      applyMessage(state, { type: "importState", mode: "merge", data: { name: "L", meals: [makeMeal({ title: "  " })], archive: [] } }, NOW);
      expect(state.meals).toEqual([]);
    });

    it("ne dédoublonne pas deux repas de même titre au sein du fichier importé lui-même", () => {
      const state = makeState();
      applyMessage(
        state,
        {
          type: "importState",
          mode: "merge",
          data: { name: "L", meals: [makeMeal({ id: "n1", title: "Tartiflette" }), makeMeal({ id: "n2", title: "Tartiflette" })], archive: [] },
        },
        NOW,
      );
      expect(state.meals).toHaveLength(2);
    });

    it("s'arrête d'importer une fois le plafond MAX_MEALS_TOTAL atteint", () => {
      const state = makeState({ meals: Array.from({ length: MAX_MEALS_TOTAL - 1 }, (_, i) => makeMeal({ id: `m${i}`, title: `M${i}` })) });
      applyMessage(
        state,
        {
          type: "importState",
          mode: "merge",
          data: { name: "L", meals: [makeMeal({ id: "n1", title: "N1" }), makeMeal({ id: "n2", title: "N2" })], archive: [] },
        },
        NOW,
      );
      expect(state.meals).toHaveLength(MAX_MEALS_TOTAL);
    });

    it("compte le plafond MAX_MEALS_TOTAL sur repas actifs + archivés combinés, pas l'un ou l'autre seul", () => {
      const state = makeState({
        meals: Array.from({ length: MAX_MEALS_TOTAL - 5 }, (_, i) => makeMeal({ id: `m${i}`, title: `M${i}` })),
        archive: Array.from({ length: 10 }, (_, i) => makeMeal({ id: `a${i}`, title: `A${i}`, status: "fait" })),
      });
      applyMessage(
        state,
        { type: "importState", mode: "merge", data: { name: "L", meals: [makeMeal({ id: "n1", title: "Nouveau" })], archive: [] } },
        NOW,
      );
      expect(state.meals.some((m) => m.title === "Nouveau")).toBe(false);
    });

    it("ne touche pas au nom de la liste", () => {
      const state = makeState({ name: "Nom actuel" });
      applyMessage(state, { type: "importState", mode: "merge", data: { name: "Autre nom", meals: [], archive: [] } }, NOW);
      expect(state.name).toBe("Nom actuel");
    });
  });
});

describe("applyMessage: reorderMeals", () => {
  it("applique le nouvel ordre aux ids connus", () => {
    const state = makeState();
    applyMessage(state, { type: "addMeal", id: "m1", title: "A" }, NOW);
    applyMessage(state, { type: "addMeal", id: "m2", title: "B" }, NOW);
    applyMessage(state, { type: "reorderMeals", orderedIds: ["m2", "m1"] }, NOW);
    expect(state.meals.find((m) => m.id === "m2")!.order).toBe(0);
    expect(state.meals.find((m) => m.id === "m1")!.order).toBe(1);
  });

  it("ignore les ids inconnus dans la liste fournie", () => {
    const state = makeState();
    applyMessage(state, { type: "addMeal", id: "m1", title: "A" }, NOW);
    applyMessage(state, { type: "reorderMeals", orderedIds: ["ghost"] }, NOW);
    expect(state.meals[0].order).toBe(0);
  });
});

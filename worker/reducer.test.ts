import { describe, it, expect } from "vitest";
import { applyMessage, nextOrder } from "./reducer";
import type { ListState } from "../shared/types";

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

describe("nextOrder", () => {
  it("vaut 0 pour une liste vide", () => {
    expect(nextOrder([])).toBe(0);
  });
  it("vaut max(order) + 1 sinon", () => {
    expect(nextOrder([{ order: 0 }, { order: 5 }, { order: 2 }])).toBe(6);
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
      },
    ]);
  });

  it("ignore un titre vide", () => {
    const state = makeState();
    applyMessage(state, { type: "addMeal", id: "m1", title: "   " }, NOW);
    expect(state.meals).toEqual([]);
  });

  it("incrémente order pour chaque ajout", () => {
    const state = makeState();
    applyMessage(state, { type: "addMeal", id: "m1", title: "A" }, NOW);
    applyMessage(state, { type: "addMeal", id: "m2", title: "B" }, NOW);
    expect(state.meals.map((m) => m.order)).toEqual([0, 1]);
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
});

describe("applyMessage: deleteMeal", () => {
  it("supprime un repas actif", () => {
    const state = makeState();
    applyMessage(state, { type: "addMeal", id: "m1", title: "A" }, NOW);
    applyMessage(state, { type: "deleteMeal", id: "m1" }, NOW);
    expect(state.meals).toEqual([]);
  });
});

describe("applyMessage: deleteArchivedMeal", () => {
  it("supprime définitivement un repas archivé", () => {
    const state = makeState();
    applyMessage(state, { type: "addMeal", id: "m1", title: "A" }, NOW);
    applyMessage(state, { type: "setMealStatus", id: "m1", status: "fait" }, NOW);
    applyMessage(state, { type: "deleteArchivedMeal", id: "m1" }, NOW);
    expect(state.archive).toEqual([]);
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

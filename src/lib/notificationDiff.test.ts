import { describe, it, expect } from "vitest";
import { diffForNotifications } from "./notificationDiff";
import type { ListState, Meal } from "../../shared/types";

function makeMeal(overrides: Partial<Meal> = {}): Meal {
  return {
    id: "m",
    title: "Repas",
    status: "idee",
    note: null,
    source: "",
    comment: "",
    order: 0,
    createdAt: 0,
    updatedAt: 0,
    doneAt: null,
    images: [],
    prepTime: null,
    plannedDate: null,
    ...overrides,
  };
}

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

describe("diffForNotifications", () => {
  it("signale un nouveau repas actif (addMeal)", () => {
    const previous = makeState();
    const next = makeState({ meals: [makeMeal({ id: "m1", title: "Tartiflette" })] });
    const events = diffForNotifications(previous, next);
    expect(events).toEqual([{ kind: "added", meal: next.meals[0] }]);
  });

  it("signale un repas remis depuis l'historique comme une apparition, pas un changement de statut", () => {
    const archived = makeMeal({ id: "m1", status: "fait", doneAt: 111 });
    const previous = makeState({ archive: [archived] });
    const restored = makeMeal({ id: "m1", status: "idee", doneAt: null });
    const next = makeState({ meals: [restored] });
    const events = diffForNotifications(previous, next);
    expect(events).toEqual([{ kind: "added", meal: restored }]);
  });

  it("signale un repas dont le statut change en restant actif", () => {
    const before = makeMeal({ id: "m1", status: "idee" });
    const after = makeMeal({ id: "m1", status: "validee" });
    const previous = makeState({ meals: [before] });
    const next = makeState({ meals: [after] });
    const events = diffForNotifications(previous, next);
    expect(events).toEqual([{ kind: "statusChanged", meal: after, previousStatus: "idee" }]);
  });

  it("signale le passage à \"fait\" (le repas quitte meals pour archive)", () => {
    const before = makeMeal({ id: "m1", status: "validee" });
    const after = makeMeal({ id: "m1", status: "fait", doneAt: 999 });
    const previous = makeState({ meals: [before] });
    const next = makeState({ archive: [after] });
    const events = diffForNotifications(previous, next);
    expect(events).toEqual([{ kind: "statusChanged", meal: after, previousStatus: "validee" }]);
  });

  it("ne signale rien pour un repas resté archivé sans changement", () => {
    const meal = makeMeal({ id: "m1", status: "fait", doneAt: 1 });
    const previous = makeState({ archive: [meal] });
    const next = makeState({ archive: [meal] });
    expect(diffForNotifications(previous, next)).toEqual([]);
  });

  it("ne signale rien pour un repas inchangé", () => {
    const meal = makeMeal({ id: "m1" });
    const previous = makeState({ meals: [meal] });
    const next = makeState({ meals: [meal] });
    expect(diffForNotifications(previous, next)).toEqual([]);
  });

  it("ne signale rien pour un repas supprimé", () => {
    const previous = makeState({ meals: [makeMeal({ id: "m1" })] });
    const next = makeState();
    expect(diffForNotifications(previous, next)).toEqual([]);
  });

  it("ignore les changements d'un champ autre que le statut", () => {
    const before = makeMeal({ id: "m1", note: null, comment: "" });
    const after = makeMeal({ id: "m1", note: "quand_tu_veux", comment: "Un commentaire" });
    const previous = makeState({ meals: [before] });
    const next = makeState({ meals: [after] });
    expect(diffForNotifications(previous, next)).toEqual([]);
  });

  it("exclut les repas dont l'id figure dans skipMealIds (propres actions de cet appareil)", () => {
    const previous = makeState();
    const next = makeState({ meals: [makeMeal({ id: "m1" }), makeMeal({ id: "m2" })] });
    const events = diffForNotifications(previous, next, new Set(["m1"]));
    expect(events).toEqual([{ kind: "added", meal: next.meals[1] }]);
  });

  it("exclut aussi un changement de statut dont l'id figure dans skipMealIds", () => {
    const before = makeMeal({ id: "m1", status: "idee" });
    const after = makeMeal({ id: "m1", status: "validee" });
    const previous = makeState({ meals: [before] });
    const next = makeState({ meals: [after] });
    expect(diffForNotifications(previous, next, new Set(["m1"]))).toEqual([]);
  });

  it("exclut aussi un passage à \"fait\" dont l'id figure dans skipMealIds", () => {
    const before = makeMeal({ id: "m1", status: "validee" });
    const after = makeMeal({ id: "m1", status: "fait", doneAt: 999 });
    const previous = makeState({ meals: [before] });
    const next = makeState({ archive: [after] });
    expect(diffForNotifications(previous, next, new Set(["m1"]))).toEqual([]);
  });

  it("gère plusieurs repas à la fois, chacun avec son propre évènement", () => {
    const previous = makeState({ meals: [makeMeal({ id: "m1", status: "idee" })] });
    const next = makeState({
      meals: [makeMeal({ id: "m1", status: "commandee" }), makeMeal({ id: "m2", title: "Nouveau" })],
    });
    const events = diffForNotifications(previous, next);
    expect(events).toEqual([
      { kind: "statusChanged", meal: next.meals[0], previousStatus: "idee" },
      { kind: "added", meal: next.meals[1] },
    ]);
  });
});

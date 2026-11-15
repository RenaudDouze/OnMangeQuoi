import { describe, expect, it } from "vitest";
import { computeHistoryStats } from "./historyStats";
import type { Meal } from "../../shared/types";

function meal(overrides: Partial<Meal> = {}): Meal {
  return {
    id: "m",
    title: "Pâtes",
    status: "fait",
    note: null,
    source: "",
    comment: "",
    order: 0,
    createdAt: 0,
    updatedAt: 0,
    doneAt: 0,
    images: [],
    prepTime: null,
    plannedDate: null,
    later: false,
    ...overrides,
  };
}

describe("computeHistoryStats", () => {
  it("archive vide : tout à zéro", () => {
    expect(computeHistoryStats([])).toEqual({ total: 0, byNote: [], noNoteCount: 0, byPrepTime: [], noPrepTimeCount: 0, topMeals: [] });
  });

  it("compte les notes dans l'ordre des notes (de la moins à la plus positive), sans les notes absentes", () => {
    const stats = computeHistoryStats([
      meal({ note: "quand_tu_veux" }),
      meal({ note: "plus_jamais" }),
      meal({ note: "quand_tu_veux" }),
      meal({ note: null }),
    ]);
    expect(stats.total).toBe(4);
    expect(stats.byNote).toEqual([
      { note: "plus_jamais", count: 1 },
      { note: "quand_tu_veux", count: 2 },
    ]);
    expect(stats.noNoteCount).toBe(1);
  });

  it("compte les temps de préparation dans l'ordre rapide/normal/long, sans les absents", () => {
    const stats = computeHistoryStats([meal({ prepTime: "long" }), meal({ prepTime: "rapide" }), meal({ prepTime: "long" }), meal({ prepTime: null }), meal({ prepTime: null })]);
    expect(stats.byPrepTime).toEqual([
      { prepTime: "rapide", count: 1 },
      { prepTime: "long", count: 2 },
    ]);
    expect(stats.noPrepTimeCount).toBe(2);
  });

  it("les repas refaits : titre insensible à la casse et aux espaces, garde la première graphie, ignore les uniques", () => {
    const stats = computeHistoryStats([
      meal({ title: "Pâtes carbonara" }),
      meal({ title: "  pâtes CARBONARA " }),
      meal({ title: "Riz" }),
      meal({ title: "Pâtes carbonara" }),
    ]);
    expect(stats.topMeals).toEqual([{ title: "Pâtes carbonara", count: 3 }]);
  });

  it("trie par fréquence décroissante puis ordre alphabétique, limité à 5", () => {
    const titles = ["Zèbre", "Zèbre", "Abeille", "Abeille", "Cerf", "Cerf", "Cerf", "D", "D", "E", "E", "F", "F", "G", "G"];
    const stats = computeHistoryStats(titles.map((title) => meal({ title })));
    expect(stats.topMeals.map((m) => [m.title, m.count])).toEqual([
      ["Cerf", 3],
      ["Abeille", 2],
      ["D", 2],
      ["E", 2],
      ["F", 2],
    ]);
  });

  it("un repas refait exactement deux fois est inclus, un seul passage non", () => {
    expect(computeHistoryStats([meal({ title: "A" }), meal({ title: "A" })]).topMeals).toEqual([{ title: "A", count: 2 }]);
    expect(computeHistoryStats([meal({ title: "A" })]).topMeals).toEqual([]);
  });

  it("ne regroupe que les titres identiques à la casse près (ß et SS restent distincts)", () => {
    const stats = computeHistoryStats([meal({ title: "Straße" }), meal({ title: "STRASSE" })]);
    expect(stats.topMeals).toEqual([]);
  });
});

import type { Meal, MealNote, PrepTime } from "../../shared/types";
import { MEAL_NOTES, PREP_TIMES } from "../../shared/types";

export interface HistoryStats {
  total: number;
  byNote: { note: MealNote; count: number }[];
  noNoteCount: number;
  byPrepTime: { prepTime: PrepTime; count: number }[];
  noPrepTimeCount: number;
  /** Repas refaits plusieurs fois (titre identique, insensible à la casse),
   * les plus fréquents d'abord — n'inclut que ceux refaits au moins une
   * fois, pas la totalité de l'historique. */
  topMeals: { title: string; count: number }[];
}

/** Pure (aucun accès DOM/réseau), donc testable au même titre que
 * worker/reducer.ts — voir historyStats.test.ts. */
export function computeHistoryStats(archive: Meal[]): HistoryStats {
  const noteCounts = new Map<MealNote, number>();
  let noNoteCount = 0;
  const prepCounts = new Map<PrepTime, number>();
  let noPrepTimeCount = 0;
  const titleCounts = new Map<string, { title: string; count: number }>();

  for (const meal of archive) {
    if (meal.note) noteCounts.set(meal.note, (noteCounts.get(meal.note) ?? 0) + 1);
    else noNoteCount++;

    if (meal.prepTime) prepCounts.set(meal.prepTime, (prepCounts.get(meal.prepTime) ?? 0) + 1);
    else noPrepTimeCount++;

    const title = meal.title.trim();
    const key = title.toLowerCase();
    const existing = titleCounts.get(key);
    if (existing) existing.count++;
    else titleCounts.set(key, { title, count: 1 });
  }

  const byNote = MEAL_NOTES.map((note) => ({ note, count: noteCounts.get(note) ?? 0 })).filter((x) => x.count > 0);
  const byPrepTime = PREP_TIMES.map((prepTime) => ({ prepTime, count: prepCounts.get(prepTime) ?? 0 })).filter(
    (x) => x.count > 0,
  );
  const topMeals = Array.from(titleCounts.values())
    .filter((x) => x.count > 1)
    .sort((a, b) => b.count - a.count || a.title.localeCompare(b.title))
    .slice(0, 5);

  return { total: archive.length, byNote, noNoteCount, byPrepTime, noPrepTimeCount, topMeals };
}

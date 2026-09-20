// Logique pure (pas de DOM, pas d'API Notification) extraite pour rester
// unit-testable, comme compactShare.ts — voir wireNotifications dans
// src/views/list.ts pour l'utilisation : ne réagit qu'aux nouveaux repas
// actifs et aux changements de statut, comme demandé, pas aux autres champs
// (note, commentaire, source…).
import type { ListState, Meal, MealStatus } from "../../shared/types";

export interface MealAddedEvent {
  kind: "added";
  meal: Meal;
}

export interface MealStatusChangedEvent {
  kind: "statusChanged";
  meal: Meal;
  previousStatus: MealStatus;
}

export type NotificationEvent = MealAddedEvent | MealStatusChangedEvent;

/** Calcule les évènements dignes d'une notification entre deux ListState
 * consécutifs d'une même liste.
 *
 * Un repas qui apparaît dans la liste active sans y être juste avant est
 * signalé comme "added" — que ce soit un tout nouveau repas (addMeal), un
 * repas remis depuis l'historique (restoreMeal) ou une suppression annulée
 * (restoreDeletedMeal) : dans les trois cas, c'est une apparition dans la
 * liste active du point de vue des autres appareils. Un repas déjà actif
 * dont le statut change (y compris le passage à "fait", qui le fait sortir
 * de `meals` vers `archive`) est signalé comme "statusChanged" — jamais les
 * deux à la fois pour un même repas.
 *
 * `skipMealIds` exclut les repas dont ce même appareil vient d'être à
 * l'origine de la mutation (voir markOwnMutation dans list.ts) : on ne
 * notifie pas un appareil de ses propres actions, seulement de celles des
 * autres appareils connectés à la liste.
 */
export function diffForNotifications(previous: ListState, next: ListState, skipMealIds: ReadonlySet<string> = new Set()): NotificationEvent[] {
  const previousActiveIds = new Set(previous.meals.map((m) => m.id));
  const previousById = new Map<string, Meal>([...previous.meals, ...previous.archive].map((m) => [m.id, m]));
  const events: NotificationEvent[] = [];

  const considerStatusChange = (meal: Meal): void => {
    if (skipMealIds.has(meal.id)) return;
    const before = previousById.get(meal.id);
    if (before && before.status !== meal.status) {
      events.push({ kind: "statusChanged", meal, previousStatus: before.status });
    }
  };

  for (const meal of next.meals) {
    if (skipMealIds.has(meal.id)) continue;
    if (!previousActiveIds.has(meal.id)) {
      events.push({ kind: "added", meal });
      continue;
    }
    considerStatusChange(meal);
  }

  // Un repas tout juste passé "fait" a quitté `meals` pour `archive` : sans
  // ce second passage, son changement de statut (le plus significatif de
  // tous) ne serait jamais détecté. Seuls les repas actifs juste avant sont
  // concernés — un repas resté archivé sans rien changer n'a, lui, jamais
  // été dans previousActiveIds.
  for (const meal of next.archive) {
    if (previousActiveIds.has(meal.id)) considerStatusChange(meal);
  }

  return events;
}

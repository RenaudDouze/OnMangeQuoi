// Pure state-mutation logic for a shared meal list, extracted out of the
// Durable Object class (mealRoom.ts) so it can be unit-tested without any
// Workers runtime (storage, WebSockets, ctx...).

import type { ListState, ClientMessage, Meal } from "../shared/types";

export function nextOrder(list: { order: number }[]): number {
  return list.length === 0 ? 0 : Math.max(...list.map((x) => x.order)) + 1;
}

function findMeal(state: ListState, id: string): Meal | undefined {
  return state.meals.find((m) => m.id === id) ?? state.archive.find((m) => m.id === id);
}

/** Mutates `state` in place to apply one client message. */
export function applyMessage(state: ListState, msg: ClientMessage, now: number = Date.now()): void {
  switch (msg.type) {
    case "sync":
      return;

    case "renameList": {
      const name = msg.name.trim();
      if (name) state.name = name;
      return;
    }

    case "addMeal": {
      const title = msg.title.trim();
      if (!title) return;
      const meal: Meal = {
        id: msg.id,
        title,
        status: "idee",
        note: null,
        source: "",
        commentBefore: "",
        commentAfter: "",
        order: nextOrder(state.meals),
        createdAt: now,
        updatedAt: now,
        doneAt: null,
      };
      state.meals.push(meal);
      return;
    }

    case "updateMeal": {
      const meal = findMeal(state, msg.id);
      if (!meal) return;
      if (msg.title !== undefined) {
        const title = msg.title.trim();
        if (title) meal.title = title;
      }
      if (msg.source !== undefined) meal.source = msg.source;
      if (msg.commentBefore !== undefined) meal.commentBefore = msg.commentBefore;
      if (msg.commentAfter !== undefined) meal.commentAfter = msg.commentAfter;
      meal.updatedAt = now;
      return;
    }

    case "setMealStatus": {
      const idx = state.meals.findIndex((m) => m.id === msg.id);
      if (idx === -1) return;
      const meal = state.meals[idx];
      meal.status = msg.status;
      meal.updatedAt = now;
      if (msg.status === "fait") {
        // Disparaît de la liste active, part dans l'archive (voir
        // "restoreMeal" pour le remettre en liste plus tard).
        meal.doneAt = now;
        state.meals.splice(idx, 1);
        state.archive.unshift(meal);
      }
      return;
    }

    case "setMealNote": {
      const meal = findMeal(state, msg.id);
      if (!meal) return;
      meal.note = msg.note;
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

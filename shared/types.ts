// Types shared between the worker (Durable Object) and the client app.

export type MealStatus = "idee" | "validee" | "commandee" | "rangee" | "non_complet" | "fait";

export const MEAL_STATUSES: MealStatus[] = ["idee", "validee", "commandee", "rangee", "non_complet", "fait"];

export const MEAL_STATUS_LABELS: Record<MealStatus, string> = {
  idee: "Idée",
  validee: "Validée",
  commandee: "Commandée",
  rangee: "Rangée",
  non_complet: "Non complet",
  fait: "Fait",
};

/** Note laissée après avoir mangé le repas, de la moins à la plus positive. */
export type MealNote = "plus_jamais" | "mouais" | "remplacer" | "de_temps_en_temps" | "quand_tu_veux";

export const MEAL_NOTES: MealNote[] = ["plus_jamais", "mouais", "remplacer", "de_temps_en_temps", "quand_tu_veux"];

export const MEAL_NOTE_LABELS: Record<MealNote, string> = {
  plus_jamais: "Plus jamais",
  mouais: "Mouais, ça change mais bon",
  remplacer: "En remplaçant ça par ça peut-être ?",
  de_temps_en_temps: "De temps en temps oui",
  quand_tu_veux: "Quand tu veux où tu veux",
};

export interface Meal {
  id: string;
  title: string;
  status: MealStatus;
  note: MealNote | null;
  /** Source libre : lien ou simple texte (ex: nom d'un livre de cuisine). */
  source: string;
  commentBefore: string;
  commentAfter: string;
  order: number;
  createdAt: number;
  updatedAt: number;
  /** Date du dernier passage au statut "fait" (archivage). null en liste active. */
  doneAt: number | null;
}

export interface ListState {
  code: string;
  name: string;
  /** Repas actifs (statut != "fait"), affichés dans la liste principale. */
  meals: Meal[];
  /** Repas passés en "Fait" : ils disparaissent de la liste active mais
   * restent ici pour pouvoir être remis plus tard. */
  archive: Meal[];
  createdAt: number;
  updatedAt: number;
}

export type ClientMessage =
  | { type: "sync" }
  | { type: "renameList"; name: string }
  | { type: "addMeal"; id: string; title: string }
  | { type: "updateMeal"; id: string; title?: string; source?: string; commentBefore?: string; commentAfter?: string }
  | { type: "setMealStatus"; id: string; status: MealStatus }
  | { type: "setMealNote"; id: string; note: MealNote | null }
  | { type: "deleteMeal"; id: string }
  | { type: "reorderMeals"; orderedIds: string[] }
  | { type: "restoreMeal"; id: string }
  | { type: "deleteArchivedMeal"; id: string };

export type ServerMessage = { type: "state"; state: ListState } | { type: "error"; message: string };

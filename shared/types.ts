// Types shared between the worker (Durable Object) and the client app.

// Bornes appliquées aussi bien côté client (attributs maxlength, confort de
// saisie) que côté serveur (reducer.ts) : n'importe qui ayant le code peut
// écrire dans une liste sans authentification, donc le serveur ne doit pas
// se fier au seul client pour empêcher un texte ou une liste démesurés.
export const MAX_TITLE_LENGTH = 120;
export const MAX_LIST_NAME_LENGTH = 60;
export const MAX_SOURCE_LENGTH = 300;
export const MAX_COMMENT_LENGTH = 2000;
/** Total repas actifs + archivés : au-delà, les nouveaux ajouts sont ignorés. */
export const MAX_MEALS_TOTAL = 1000;
/** Taille max d'une image jointe à un repas (photo ou capture d'écran). */
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
/** Types d'image acceptés en upload — voir worker/index.ts. Pas de SVG :
 * un SVG peut embarquer du script, un risque inutile pour une simple photo. */
export const ALLOWED_IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif"] as const;

export type MealStatus = "idee" | "validee" | "commandee" | "rangee" | "non_complet" | "fait";

export const MEAL_STATUSES: MealStatus[] = ["idee", "validee", "commandee", "rangee", "non_complet", "fait"];

export const MEAL_STATUS_LABELS: Record<MealStatus, string> = {
  idee: "💡 Idée",
  validee: "✅ Validée",
  commandee: "🛒 Commandée",
  rangee: "🧺 Rangée",
  non_complet: "⚠️ Non complet",
  fait: "🎉 Fait",
};

/** Note laissée après avoir mangé le repas, de la moins à la plus positive. */
export type MealNote = "plus_jamais" | "mouais" | "remplacer" | "de_temps_en_temps" | "quand_tu_veux";

export const MEAL_NOTES: MealNote[] = ["plus_jamais", "mouais", "remplacer", "de_temps_en_temps", "quand_tu_veux"];

export const MEAL_NOTE_LABELS: Record<MealNote, string> = {
  plus_jamais: "👎 Plus jamais",
  mouais: "😐 Mouais, ça change mais bon",
  remplacer: "🔄 En remplaçant ça par ça peut-être ?",
  de_temps_en_temps: "🙂 De temps en temps oui",
  quand_tu_veux: "😍 Quand tu veux où tu veux",
};

export interface Meal {
  id: string;
  title: string;
  status: MealStatus;
  note: MealNote | null;
  /** Source libre : lien ou simple texte (ex: nom d'un livre de cuisine). */
  source: string;
  comment: string;
  order: number;
  createdAt: number;
  updatedAt: number;
  /** Date du dernier passage au statut "fait" (archivage). null en liste active. */
  doneAt: number | null;
  /** Image jointe (photo ou capture d'écran) — voir /api/lists/:code/meals/:id/image.
   * imageVersion s'incrémente à chaque remplacement, pour que l'URL de
   * l'image (qui l'inclut en query string) change et invalide le cache
   * navigateur plutôt que de réafficher l'ancienne image. */
  hasImage: boolean;
  imageVersion: number;
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
  | { type: "updateMeal"; id: string; title?: string; source?: string; comment?: string }
  | { type: "setMealStatus"; id: string; status: MealStatus; doneAt?: number }
  | { type: "setMealNote"; id: string; note: MealNote | null }
  | { type: "setMealImage"; id: string; hasImage: boolean }
  | { type: "deleteMeal"; id: string }
  | { type: "reorderMeals"; orderedIds: string[] }
  | { type: "restoreMeal"; id: string }
  | { type: "deleteArchivedMeal"; id: string };

export type ServerMessage = { type: "state"; state: ListState } | { type: "error"; message: string };

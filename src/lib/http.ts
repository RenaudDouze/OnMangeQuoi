import type { ListState } from "../../shared/types";
import { apiUrl } from "./syncWorker";

/** Erreur renvoyée par l'API avec un message déjà adapté à l'affichage (ex :
 * limite de débit atteinte) — à distinguer d'un échec réseau (fetch qui lève
 * lui-même), dont le message brut ne convient pas pour l'utilisateur. */
export class ApiError extends Error {}

export async function createList(name: string): Promise<ListState> {
  const res = await fetch(apiUrl("/api/lists"), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name }),
  });
  if (!res.ok) {
    const body: { error?: string } | null = await res.json().catch(() => null);
    throw new ApiError(body?.error || "Impossible de créer la liste.");
  }
  return res.json();
}

export async function fetchListState(code: string): Promise<ListState | null> {
  const res = await fetch(apiUrl(`/api/lists/${encodeURIComponent(code)}`));
  if (res.status === 404) return null;
  if (!res.ok) {
    const body: { error?: string } | null = await res.json().catch(() => null);
    throw new ApiError(body?.error || "Erreur réseau.");
  }
  return res.json();
}

function mealImagePath(code: string, mealId: string): string {
  return `/api/lists/${encodeURIComponent(code)}/meals/${encodeURIComponent(mealId)}/image`;
}

/** `version` (voir Meal.imageVersion) fait partie de l'URL : elle change à
 * chaque remplacement, ce qui invalide le cache navigateur sans avoir à
 * gérer d'en-têtes de cache spécifiques côté client. */
export function mealImageUrl(code: string, mealId: string, version: number): string {
  return apiUrl(`${mealImagePath(code, mealId)}?v=${version}`);
}

export async function uploadMealImage(code: string, mealId: string, file: Blob): Promise<void> {
  const res = await fetch(apiUrl(mealImagePath(code, mealId)), {
    method: "PUT",
    headers: { "content-type": file.type },
    body: file,
  });
  if (!res.ok) {
    const body: { error?: string } | null = await res.json().catch(() => null);
    throw new ApiError(body?.error || "Impossible d'envoyer l'image.");
  }
}

export async function deleteMealImage(code: string, mealId: string): Promise<void> {
  const res = await fetch(apiUrl(mealImagePath(code, mealId)), { method: "DELETE" });
  if (!res.ok) {
    const body: { error?: string } | null = await res.json().catch(() => null);
    throw new ApiError(body?.error || "Impossible de supprimer l'image.");
  }
}

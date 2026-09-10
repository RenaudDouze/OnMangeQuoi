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

// Même schéma que theme.ts/a11y.ts : préférence persistée en localStorage,
// propre à cet appareil (pas partagée via le serveur, comme les autres
// préférences d'affichage de l'app) — voir src/views/list.ts pour l'usage :
// active ou non le tri automatique de la liste active par statut, à la
// place de l'ordre manuel (glisser-déposer / boutons monter-descendre).
const KEY = "omq:sort-by-status";

export function getSortByStatus(): boolean {
  try {
    return localStorage.getItem(KEY) === "true";
  } catch {
    return false;
  }
}

export function setSortByStatus(enabled: boolean): void {
  try {
    localStorage.setItem(KEY, String(enabled));
  } catch {
    // stockage indisponible, la préférence ne persistera pas au rechargement
  }
}

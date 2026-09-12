// Même schéma que theme.ts : préférence persistée en localStorage, appliquée
// via un attribut sur <html> plutôt qu'une classe JS partout, pour que le CSS
// seul décide de ce qui change (texte/zones plus grands, contraste renforcé,
// animations réduites — voir style.css, sélecteurs [data-a11y]).
const KEY = "omq:a11y";

export function getA11yPreference(): boolean {
  try {
    return localStorage.getItem(KEY) === "true";
  } catch {
    return false;
  }
}

export function applyA11y(enabled: boolean): void {
  document.documentElement.toggleAttribute("data-a11y", enabled);
}

export function setA11yPreference(enabled: boolean): void {
  try {
    localStorage.setItem(KEY, String(enabled));
  } catch {
    // stockage indisponible, la préférence ne persistera pas au rechargement
  }
  applyA11y(enabled);
}

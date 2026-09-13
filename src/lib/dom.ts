const ESCAPE_MAP: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => ESCAPE_MAP[c]);
}

/** Ajoute un déclenchement au clavier (Entrée/Espace) en plus du clic, pour
 * un élément non nativement interactif rendu actionnable via role="button" +
 * tabindex="0" (ex : titre de repas ou de liste, source, éditables en ligne
 * au clic) — sans quoi seuls la souris et le tactile peuvent l'activer. */
export function onActivate(el: HTMLElement, handler: (e: Event) => void): void {
  el.addEventListener("click", handler);
  el.addEventListener("keydown", (e) => {
    const ke = e as KeyboardEvent;
    if (ke.key === "Enter" || ke.key === " ") {
      ke.preventDefault();
      handler(e);
    }
  });
}

/** Piège Tab/Shift+Tab à l'intérieur de `container` (une modale) : sans ça,
 * un utilisateur clavier peut tabuler vers le contenu caché derrière
 * l'overlay. Retourne une fonction à appeler à la fermeture, qui retire
 * l'écouteur et rend le focus à l'élément qui l'avait avant l'ouverture. */
export function trapFocus(container: HTMLElement, previouslyFocused: Element | null): () => void {
  function focusable(): HTMLElement[] {
    return Array.from(
      container.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ),
    );
  }

  function onKeydown(e: KeyboardEvent): void {
    if (e.key !== "Tab") return;
    const items = focusable();
    if (items.length === 0) return;
    const first = items[0];
    const last = items[items.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }

  container.addEventListener("keydown", onKeydown);
  return () => {
    container.removeEventListener("keydown", onKeydown);
    if (previouslyFocused instanceof HTMLElement) previouslyFocused.focus();
  };
}

// Confirmation "au même endroit" pour les actions destructrices : un premier
// clic arme le bouton (retour visuel + libellé changés), un second clic au
// même endroit confirme réellement l'action. Sans second clic dans le délai
// imparti, le bouton revient à son état normal — rien n'est fait.
export interface ConfirmClickOptions {
  /** aria-label affiché une fois le bouton armé (boutons icône). */
  armedLabel?: string;
  timeoutMs?: number;
  onConfirm: () => void;
}

const DEFAULT_TIMEOUT_MS = 3000;

export function wireConfirmClick(el: HTMLElement, opts: ConfirmClickOptions): void {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const originalLabel = el.getAttribute("aria-label");
  let timer: ReturnType<typeof setTimeout> | undefined;

  const disarm = (): void => {
    // clearTimeout ignore silencieusement un id undefined (aucun timer
    // programmé) : pas besoin de le vérifier nous-mêmes.
    clearTimeout(timer);
    timer = undefined;
    el.classList.remove("confirm-armed");
    if (originalLabel !== null) el.setAttribute("aria-label", originalLabel);
  };

  el.addEventListener("click", (e) => {
    const armed = el.classList.contains("confirm-armed");
    e.stopPropagation();
    if (armed) {
      disarm();
      opts.onConfirm();
      return;
    }
    el.classList.add("confirm-armed");
    if (opts.armedLabel) el.setAttribute("aria-label", opts.armedLabel);
    timer = setTimeout(disarm, timeoutMs);
  });
}

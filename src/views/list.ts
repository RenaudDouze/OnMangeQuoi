import type { ListState, Meal, MealStatus } from "../../shared/types";
import {
  MEAL_STATUSES,
  MEAL_STATUS_LABELS,
  MEAL_NOTES,
  MEAL_NOTE_LABELS,
  MAX_TITLE_LENGTH,
  MAX_LIST_NAME_LENGTH,
  MAX_SOURCE_LENGTH,
  MAX_COMMENT_LENGTH,
  MAX_IMAGE_BYTES,
  ALLOWED_IMAGE_TYPES,
} from "../../shared/types";
import { ListConnection } from "../lib/ws";
import { ApiError, fetchListState, uploadMealImage, deleteMealImage, mealImageUrl } from "../lib/http";
import { cacheListState, getCachedListState, touchRecentList } from "../lib/storage";
import { uid } from "../lib/id";
import { escapeHtml } from "../lib/dom";
import { startEdit } from "../lib/editable";
import { wireConfirmClick } from "../lib/confirmClick";
import { icons } from "../lib/icons";
import { appPath } from "../lib/basePath";
import { renderQrSvg } from "../lib/qr";
import Sortable from "sortablejs";

const URL_RE = /^(https?:\/\/|www\.)/i;

/** Lien de partage absolu, y compris le sous-chemin de déploiement (ex:
 * "/OnMangeQuoi/" sur GitHub Pages) — voir src/lib/basePath.ts. */
function shareUrl(code: string): string {
  return `${location.origin}${appPath(`/l/${code}`)}`;
}

function sourceHref(source: string): string | null {
  if (!URL_RE.test(source.trim())) return null;
  const trimmed = source.trim();
  return trimmed.startsWith("http") ? trimmed : `https://${trimmed}`;
}

function sourceHtml(source: string): string {
  if (!source) return `<span class="placeholder">Ajouter une source (lien ou texte)</span>`;
  const href = sourceHref(source);
  if (href) {
    return `${icons.link} <a href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer">${escapeHtml(source)}</a>`;
  }
  return escapeHtml(source);
}

function statusPickerHtml(selected: MealStatus): string {
  const pills = MEAL_STATUSES.map(
    (s) =>
      `<button type="button" class="status-pill" data-status="${s}" aria-pressed="${s === selected}">${MEAL_STATUS_LABELS[s]}</button>`,
  ).join("");
  return `<div class="status-picker" role="group" aria-label="Statut">${pills}</div>`;
}

/** Choix de note plus visuel qu'un <select>, réservé à la modale "Fait" (voir
 * openMarkDoneModal) : une carte par note, cochée façon bouton radio et
 * colorée. La note ne se règle que là, jamais depuis la carte du repas. */
function noteVisualPickerHtml(selected: Meal["note"]): string {
  const noneBtn = `<button type="button" class="note-option" data-note="" aria-pressed="${selected ? "false" : "true"}">Pas encore de note</button>`;
  const options = MEAL_NOTES.map(
    (n) => `<button type="button" class="note-option" data-note="${n}" aria-pressed="${n === selected}">${MEAL_NOTE_LABELS[n]}</button>`,
  ).join("");
  return `<div class="note-picker" id="mark-done-note-picker" role="group" aria-label="Note">${noneBtn}${options}</div>`;
}

function formatDate(ts: number): string {
  return new Date(ts).toLocaleDateString("fr-FR", { day: "numeric", month: "short", year: "numeric" });
}

/** Format attendu par <input type="date"> (YYYY-MM-DD), en heure locale : ne
 * pas passer par toISOString(), qui convertit en UTC et peut faire glisser
 * la date affichée d'un jour selon le fuseau. */
function toDateInputValue(ts: number): string {
  const d = new Date(ts);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/** Inverse de toDateInputValue : midi (plutôt que minuit) pour rester sur le
 * même jour local quel que soit le fuseau au moment de l'affichage. */
function fromDateInputValue(value: string): number {
  return new Date(`${value}T12:00:00`).getTime();
}

/** Ouvert au moment de passer un repas en "Fait" : c'est le moment naturel
 * pour noter comment c'était, plutôt qu'une étape séparée à ne pas oublier
 * une fois le repas déjà dans l'historique. */
function openMarkDoneModal(meal: Meal, onConfirm: (note: Meal["note"], comment: string, doneAt: number) => void): void {
  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  overlay.innerHTML = `
    <div class="modal" role="dialog" aria-modal="true" aria-labelledby="mark-done-title" tabindex="-1">
      <button type="button" class="icon-btn modal-close" aria-label="Fermer">${icons.close}</button>
      <h2 id="mark-done-title">Marquer « ${escapeHtml(meal.title)} » comme fait</h2>
      <p class="modal-hint">Le repas part dans l'historique. C'est le bon moment pour noter comment c'était.</p>
      <label class="modal-field">
        <span>Date</span>
        <input type="date" id="mark-done-date" value="${toDateInputValue(Date.now())}" />
      </label>
      <div class="modal-field">
        <span>Note</span>
        ${noteVisualPickerHtml(meal.note)}
      </div>
      <label class="modal-field">
        <span>Commentaire</span>
        <textarea id="mark-done-comment" rows="3" placeholder="Une note sur ce repas…" maxlength="${MAX_COMMENT_LENGTH}">${escapeHtml(meal.comment)}</textarea>
      </label>
      <div class="stacked-actions">
        <button type="button" class="btn primary" id="mark-done-confirm">Marquer comme fait</button>
        <button type="button" class="btn" id="mark-done-cancel">Annuler</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);

  const close = () => {
    overlay.remove();
    document.removeEventListener("keydown", onKeydown);
  };
  function onKeydown(e: KeyboardEvent): void {
    if (e.key === "Escape") close();
  }
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) close();
  });
  document.addEventListener("keydown", onKeydown);
  overlay.querySelector(".modal-close")?.addEventListener("click", close);
  overlay.querySelector("#mark-done-cancel")?.addEventListener("click", close);
  overlay.querySelectorAll<HTMLButtonElement>(".note-option").forEach((btn) => {
    btn.addEventListener("click", () => {
      overlay.querySelectorAll(".note-option").forEach((b) => b.setAttribute("aria-pressed", "false"));
      btn.setAttribute("aria-pressed", "true");
    });
  });
  overlay.querySelector("#mark-done-confirm")?.addEventListener("click", () => {
    const noteBtn = overlay.querySelector<HTMLButtonElement>('.note-option[aria-pressed="true"]');
    const note = noteBtn?.dataset.note || "";
    const comment = (overlay.querySelector("#mark-done-comment") as HTMLTextAreaElement).value;
    const dateValue = (overlay.querySelector("#mark-done-date") as HTMLInputElement).value;
    const doneAt = dateValue ? fromDateInputValue(dateValue) : Date.now();
    close();
    onConfirm(note ? (note as Meal["note"]) : null, comment, doneAt);
  });

  (overlay.querySelector("#mark-done-comment") as HTMLTextAreaElement)?.focus();
}

/** Affiche une image en plein écran (clic sur une miniature) : overlay
 * sombre, fermeture au clic n'importe où dessus, sur Échap, ou sur le
 * bouton fermer — même mécanique que openMarkDoneModal. */
function openImageLightbox(url: string, alt: string): void {
  const overlay = document.createElement("div");
  overlay.className = "modal-overlay image-lightbox-overlay";
  overlay.innerHTML = `
    <button type="button" class="icon-btn image-lightbox-close" aria-label="Fermer">${icons.close}</button>
    <img src="${url}" alt="${escapeHtml(alt)}" class="image-lightbox-img" />`;
  document.body.appendChild(overlay);

  const close = () => {
    overlay.remove();
    document.removeEventListener("keydown", onKeydown);
  };
  function onKeydown(e: KeyboardEvent): void {
    if (e.key === "Escape") close();
  }
  overlay.addEventListener("click", close);
  document.addEventListener("keydown", onKeydown);
}

/** Photo ou capture d'écran jointe : bouton d'ajout si absente, sinon
 * miniature (cliquable pour l'afficher en plein écran) + suppression.
 * Uploadée via un input file (data-action="add-image") ou en collant
 * depuis le presse-papiers (voir wireMealCard) — les deux passent par la
 * même fonction d'envoi, dont l'indicateur de chargement ci-dessous
 * (masqué par défaut) reflète la progression : sans lui, le temps
 * d'attente réseau donne l'impression que rien ne s'est passé. */
function mealImageFieldHtml(meal: Meal, code: string): string {
  const content = meal.hasImage
    ? `<div class="meal-image-preview">
        <button type="button" class="meal-image-view" data-action="view-image">
          <img src="${mealImageUrl(code, meal.id, meal.imageVersion)}" alt="Photo de « ${escapeHtml(meal.title)} »" loading="lazy" />
        </button>
        <button type="button" class="icon-btn danger-hover meal-image-remove" data-action="remove-image" aria-label="Supprimer l'image">${icons.trash}</button>
      </div>`
    : `<button type="button" class="btn meal-image-add" data-action="add-image">${icons.image} Ajouter une photo</button>`;
  return `
    <div class="meal-field meal-image-field">
      <span class="meal-field-label">Photo</span>
      ${content}
      <span class="meal-image-loading" hidden><span class="spinner" aria-hidden="true"></span>Envoi…</span>
      <input type="file" class="meal-image-input" data-action="image-input" accept="${ALLOWED_IMAGE_TYPES.join(",")}" hidden />
    </div>`;
}

/** Replié par défaut (juste le titre) : le contenu (statut, source,
 * commentaire) ne s'affiche qu'une fois déplié, au clic sur le chevron ou
 * via "Tout déplier" — voir expandedIds dans mountListView. */
function mealCardHtml(meal: Meal, archived: boolean, expanded: boolean, code: string): string {
  const statusArea = archived
    ? `<span class="status-badge">🎉 Fait le ${formatDate(meal.doneAt ?? meal.updatedAt)}</span>`
    : statusPickerHtml(meal.status);

  // Repliée, la carte ne garde que l'action la plus utile depuis l'historique
  // (remettre en liste) ; les suppressions, destructives et rares, n'ont pas
  // besoin d'être à portée de tap en permanence — elles n'apparaissent
  // qu'une fois la carte dépliée.
  const restoreBtn = archived
    ? `<button type="button" class="icon-btn" data-action="restore" aria-label="Remettre dans la liste" title="Remettre dans la liste">${icons.undo}</button>`
    : "";

  // Le bouton supprimer vit dans le contenu déplié plutôt que sur la ligne
  // du titre (voir .meal-main) : son apparition/disparition au dépli n'y
  // change plus la place laissée au titre, qui garde une largeur stable
  // qu'on soit replié ou déplié.
  const deleteBtn = archived
    ? `<button type="button" class="icon-btn danger-hover" data-action="delete-forever" aria-label="Supprimer définitivement">${icons.trash}</button>`
    : `<button type="button" class="icon-btn danger-hover" data-action="delete" aria-label="Supprimer">${icons.trash}</button>`;

  const details = expanded
    ? `
      ${statusArea}
      <div class="meal-details">
        <div class="meal-field">
          <span class="meal-field-label">Source</span>
          <div class="meal-source" data-action="edit-source" tabindex="0">${sourceHtml(meal.source)}</div>
        </div>
        <div class="meal-field">
          <span class="meal-field-label">Commentaire</span>
          <textarea class="meal-comment" data-field="comment" placeholder="Une note sur ce repas…" rows="2" maxlength="${MAX_COMMENT_LENGTH}">${escapeHtml(meal.comment)}</textarea>
        </div>
        ${mealImageFieldHtml(meal, code)}
        <div class="meal-details-actions">${deleteBtn}</div>
      </div>`
    : "";

  // Repère de couleur sur le bord gauche de la carte (voir style.css,
  // .meal-card[data-status]/[data-note]) : statut pour un repas en cours,
  // note (si renseignée) pour un repas de l'historique. Remplace un ancien
  // emoji dédié, qui prenait trop de place une fois la carte repliée — un
  // simple liséré suffit à donner le même repère en un coup d'œil.
  const colorAttr = archived ? (meal.note ? ` data-note="${meal.note}"` : "") : ` data-status="${meal.status}"`;

  // Sur la liste active, le chevron sert aussi de poignée de glissé (voir
  // wireMealList/SortableJS) : un tap déplie/replie, un appui-glissé
  // réordonne. Le navigateur ne déclenche pas de "click" après un glissé
  // avec déplacement, donc pas d'ambiguïté entre les deux gestes — et un
  // seul élément plutôt que deux économise de la place sur la ligne
  // repliée. Sur l'historique (jamais réordonnable), c'est un bouton simple.
  const toggleBtn = `<button type="button" class="icon-btn meal-toggle${archived ? "" : " drag-handle"}" data-action="toggle" aria-expanded="${expanded}" aria-label="${expanded ? "Réduire" : "Déplier"}"${archived ? "" : ` title="Glisser pour réordonner"`}>${archived ? icons.chevronDown : icons.grip}</button>`;

  return `
    <li class="meal-card${archived ? " archived" : ""}${expanded ? " expanded" : ""}" data-id="${meal.id}"${colorAttr}>
      <div class="meal-main" data-action="toggle-row">
        ${toggleBtn}
        <h3 class="meal-title" data-action="edit-title" tabindex="0">${escapeHtml(meal.title)}</h3>
        <div class="meal-controls">${restoreBtn}</div>
      </div>
      ${details}
    </li>`;
}

function notFoundHtml(code: string): string {
  return `
    <div class="centered-message">
      <p>Aucune liste ne correspond au code <strong>${escapeHtml(code)}</strong>.</p>
      <button class="btn primary" id="btn-home">Retour à l'accueil</button>
    </div>`;
}

function layoutHtml(state: ListState, connected: boolean): string {
  return `
    <div class="list-view">
      <header class="list-header">
        <button type="button" class="icon-btn" id="btn-home" aria-label="Retour à l'accueil">${icons.back}</button>
        <h1 id="list-title" tabindex="0">${escapeHtml(state.name)}</h1>
        <span class="conn-dot" id="conn-dot" title="${connected ? "Synchronisé" : "Connexion…"}"></span>
        <button type="button" class="btn-link" id="toggle-all-btn" hidden>Tout déplier</button>
        <button type="button" class="icon-btn" id="btn-share" aria-label="Partager">${icons.share}</button>
      </header>
      <div class="share-panel" id="share-panel" hidden>
        <p>Code : <strong id="share-code">${state.code}</strong></p>
        <div class="qr-wrap" id="qr-wrap" aria-label="QR code de partage"></div>
        <button type="button" class="btn" id="copy-code">Copier le code</button>
        <button type="button" class="btn" id="copy-link">Copier le lien</button>
      </div>

      <nav class="tabs" id="tabs">
        <button type="button" class="tab-btn" data-tab="active" aria-pressed="true">Repas</button>
        <button type="button" class="tab-btn" data-tab="archive" aria-pressed="false">${icons.history} Historique</button>
      </nav>

      <section class="card add-meal-card" id="add-meal-card">
        <form id="add-form" class="row">
          <input id="add-title" type="text" placeholder="Nom du repas" maxlength="${MAX_TITLE_LENGTH}" autocomplete="off" />
          <button type="submit" class="btn primary">${icons.plus} Ajouter</button>
        </form>
        <ul class="add-suggestions" id="add-suggestions" aria-label="Repas déjà faits" hidden></ul>
      </section>

      <section class="card search-card" id="search-card" hidden>
        <input id="archive-search" type="search" placeholder="Rechercher dans l'historique…" autocomplete="off" />
      </section>

      <ul class="meal-list" id="meal-list"></ul>
      <p class="empty-message" id="empty-message" hidden></p>

      <p class="add-form-hint">Les données ne sont ni chiffrées ni protégées : n'y mets rien de privé ou de sensible.</p>
    </div>`;
}

export function mountListView(root: HTMLElement, code: string, navigate: (path: string) => void): () => void {
  let state: ListState | null = getCachedListState(code);
  let connected = false;
  let loading = state === null;
  let notFound = false;
  let loadError = false;
  let shellMounted = false;
  let tab: "active" | "archive" = "active";
  let archiveQuery = "";
  // Le temps d'un glissé (voir wireMealList) : évite qu'une mise à jour
  // reçue en direct ne reconstruise la liste sous les doigts de la personne
  // en train de réordonner. Le prochain envoi (celui du dépôt) redéclenche
  // de toute façon un rendu complet une fois l'état renvoyé par le serveur.
  let dragging = false;
  // Repliés par défaut ; conserve l'état ouvert/fermé d'un repas d'un
  // rendu à l'autre (renderMeals régénère tout le HTML à chaque mise à
  // jour temps réel, y compris quand seul un autre appareil a modifié la
  // liste).
  const expandedIds = new Set<string>();
  const conn = new ListConnection(code);

  function onStateUpdate(next: ListState) {
    state = next;
    loading = false;
    notFound = false;
    cacheListState(next);
    touchRecentList(next.code, next.name);
    render();
  }

  conn.onState(onStateUpdate);
  conn.onConnectionChange((isConnected) => {
    connected = isConnected;
    updateConnDot();
  });
  conn.onError((message) => showToast(message));

  (async () => {
    try {
      const fetched = await fetchListState(code);
      if (!fetched) {
        if (!state) {
          notFound = true;
          loading = false;
          render();
          return;
        }
      } else {
        state = fetched;
        cacheListState(fetched);
        touchRecentList(fetched.code, fetched.name);
      }
    } catch {
      loadError = state === null;
    }
    loading = false;
    render();
    conn.connect();
  })();

  render();

  function render(): void {
    if (notFound) {
      root.innerHTML = notFoundHtml(code);
      root.querySelector("#btn-home")?.addEventListener("click", () => navigate("/"));
      return;
    }
    if (loading && !state) {
      root.innerHTML = `<div class="centered-message"><p>Chargement…</p></div>`;
      return;
    }
    if (loadError && !state) {
      root.innerHTML = `<div class="centered-message"><p>Impossible de charger la liste. Vérifie ta connexion.</p><button class="btn" id="retry">Réessayer</button></div>`;
      root.querySelector("#retry")?.addEventListener("click", () => location.reload());
      return;
    }
    if (!state) return;

    if (!shellMounted) {
      // Construit une seule fois : reconstruire à chaque mise à jour temps
      // réel effacerait ce que l'utilisateur est en train de saisir (titre
      // de la liste, formulaire d'ajout) si quelqu'un d'autre modifie la
      // liste pendant ce temps.
      root.innerHTML = layoutHtml(state, connected);
      wireHeader();
      wireAddForm();
      wireSearch();
      wireTabs();
      wireToolbar();
      wireMealList();
      shellMounted = true;
    } else {
      updateTitle();
    }
    renderMeals();
  }

  function updateTitle(): void {
    const titleEl = root.querySelector("#list-title") as HTMLElement | null;
    if (!titleEl || !state) return;
    if (titleEl.querySelector("input")) return; // édition en cours, ne pas écraser
    if (titleEl.textContent !== state.name) titleEl.textContent = state.name;
  }

  function updateConnDot(): void {
    const dot = root.querySelector("#conn-dot");
    if (!dot) return;
    dot.classList.toggle("online", connected);
    dot.setAttribute("title", connected ? "Synchronisé" : "Connexion…");
  }

  function wireHeader(): void {
    root.querySelector("#btn-home")?.addEventListener("click", () => navigate("/"));

    const sharePanel = root.querySelector("#share-panel") as HTMLElement | null;
    root.querySelector("#btn-share")?.addEventListener("click", (e) => {
      e.stopPropagation();
      if (sharePanel) sharePanel.hidden = !sharePanel.hidden;
    });
    document.addEventListener("click", () => {
      if (sharePanel) sharePanel.hidden = true;
    });
    sharePanel?.addEventListener("click", (e) => e.stopPropagation());
    root.querySelector("#copy-code")?.addEventListener("click", () => {
      if (state) copyToClipboard(state.code, "Code copié.");
    });
    root.querySelector("#copy-link")?.addEventListener("click", () => {
      if (state) copyToClipboard(shareUrl(state.code), "Lien copié.");
    });

    if (state) {
      const qrWrap = root.querySelector("#qr-wrap") as HTMLElement | null;
      renderQrSvg(shareUrl(state.code)).then((svg) => {
        if (qrWrap) qrWrap.innerHTML = svg;
      });
    }

    const titleEl = root.querySelector("#list-title") as HTMLElement | null;
    titleEl?.addEventListener("click", () => {
      if (!state) return;
      startEdit(titleEl, {
        value: state.name,
        maxLength: MAX_LIST_NAME_LENGTH,
        onCommit: (value) => {
          if (value && state) conn.send({ type: "renameList", name: value });
          else render();
        },
      });
    });
  }

  function wireTabs(): void {
    root.querySelectorAll<HTMLButtonElement>(".tab-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        tab = btn.dataset.tab as "active" | "archive";
        root.querySelectorAll<HTMLButtonElement>(".tab-btn").forEach((b) => b.setAttribute("aria-pressed", String(b === btn)));
        const addCard = root.querySelector("#add-meal-card") as HTMLElement | null;
        if (addCard) addCard.hidden = tab !== "active";
        const searchCard = root.querySelector("#search-card") as HTMLElement | null;
        if (searchCard) searchCard.hidden = tab !== "archive";
        renderMeals();
      });
    });
  }

  function wireSearch(): void {
    root.querySelector("#archive-search")?.addEventListener("input", (e) => {
      archiveQuery = (e.target as HTMLInputElement).value;
      renderMeals();
    });
  }

  function wireToolbar(): void {
    root.querySelector("#toggle-all-btn")?.addEventListener("click", () => {
      const meals = visibleMeals();
      const allExpanded = meals.length > 0 && meals.every((m) => expandedIds.has(m.id));
      for (const m of meals) {
        if (allExpanded) expandedIds.delete(m.id);
        else expandedIds.add(m.id);
      }
      renderMeals();
    });
  }

  /** Réordonner la liste active à la main : glisser une carte par sa
   * poignée (`.drag-handle`, le bouton chevron — absente sur l'historique,
   * qui n'est jamais réordonnable — SortableJS n'a donc rien à saisir côté
   * archive). Pas de mise à jour optimiste "posée" : le DOM reflète déjà le
   * nouvel ordre pendant/après le glissé (SortableJS déplace les vrais
   * nœuds), et le prochain état renvoyé par le serveur confirme (ou
   * corrige) l'affichage, comme pour le reste de l'app. */
  function wireMealList(): void {
    const listEl = root.querySelector("#meal-list") as HTMLElement | null;
    if (!listEl) return;
    new Sortable(listEl, {
      handle: ".drag-handle",
      draggable: ".meal-card",
      animation: 150,
      // Gestion du glissé entièrement en JS (souris/tactile) plutôt que le
      // drag-and-drop HTML5 natif : ce dernier ne fonctionne pas au tactile
      // (l'usage principal de cette app, en PWA) et se comporte de façon
      // moins cohérente d'un navigateur à l'autre.
      forceFallback: true,
      onStart: () => {
        dragging = true;
      },
      onEnd: () => {
        dragging = false;
        const orderedIds = Array.from(listEl.querySelectorAll<HTMLLIElement>(".meal-card")).map((li) => li.dataset.id!);
        conn.send({ type: "reorderMeals", orderedIds });
      },
    });
  }

  function wireAddForm(): void {
    const input = root.querySelector("#add-title") as HTMLInputElement;
    const suggestionsEl = root.querySelector("#add-suggestions") as HTMLElement | null;

    function hideSuggestions(): void {
      if (!suggestionsEl) return;
      suggestionsEl.hidden = true;
      suggestionsEl.innerHTML = "";
    }

    // Suggère les repas de l'historique dont le titre correspond à la
    // saisie : reprendre un repas déjà fait le remet en liste active avec sa
    // note/son commentaire d'origine (comme "Remettre dans la liste"),
    // plutôt que de créer un nouveau repas vierge du même nom.
    function renderSuggestions(): void {
      if (!suggestionsEl || !state) return;
      const query = input.value.trim().toLowerCase();
      if (!query) {
        hideSuggestions();
        return;
      }
      const seenTitles = new Set<string>();
      const matches: Meal[] = [];
      for (const meal of state.archive) {
        const key = meal.title.toLowerCase();
        if (!key.includes(query) || seenTitles.has(key)) continue;
        seenTitles.add(key);
        matches.push(meal);
        if (matches.length >= 5) break;
      }
      if (matches.length === 0) {
        hideSuggestions();
        return;
      }
      suggestionsEl.innerHTML = matches
        .map((m) => {
          const note = m.note
            ? `<span class="add-suggestion-note">${escapeHtml(MEAL_NOTE_LABELS[m.note])}</span>`
            : "";
          return `<li><button type="button" class="add-suggestion" data-id="${m.id}"><span class="add-suggestion-title">${icons.history} ${escapeHtml(m.title)}</span>${note}</button></li>`;
        })
        .join("");
      suggestionsEl.hidden = false;
      suggestionsEl.querySelectorAll<HTMLButtonElement>(".add-suggestion").forEach((btn) => {
        btn.addEventListener("click", () => {
          conn.send({ type: "restoreMeal", id: btn.dataset.id! });
          input.value = "";
          hideSuggestions();
          input.focus();
        });
      });
    }

    input.addEventListener("input", renderSuggestions);
    input.addEventListener("focus", renderSuggestions);
    input.addEventListener("blur", () => {
      // Laisse le temps au clic sur une suggestion de se déclencher avant de la masquer.
      setTimeout(hideSuggestions, 150);
    });
    input.addEventListener("keydown", (e) => {
      if (e.key === "Escape") hideSuggestions();
    });

    root.querySelector("#add-form")?.addEventListener("submit", (e) => {
      e.preventDefault();
      const title = input.value.trim();
      if (!title) return;
      conn.send({ type: "addMeal", id: uid(), title });
      input.value = "";
      hideSuggestions();
      input.focus();
    });
  }

  function copyToClipboard(text: string, message: string): void {
    navigator.clipboard?.writeText(text).then(
      () => showToast(message),
      () => showToast("Impossible de copier."),
    );
  }

  /** Repas actuellement affichés (onglet + recherche), dans l'ordre affiché
   * — partagé entre le rendu et "Tout déplier" pour qu'ils portent sur
   * exactement les mêmes repas. */
  function visibleMeals(): Meal[] {
    if (!state) return [];
    const query = archiveQuery.trim().toLowerCase();
    return tab === "active"
      ? [...state.meals].sort((a, b) => a.order - b.order)
      : query
        ? state.archive.filter((m) => m.title.toLowerCase().includes(query))
        : state.archive;
  }

  function renderMeals(): void {
    if (!state) return;
    if (dragging) return;
    const listEl = root.querySelector("#meal-list") as HTMLElement | null;
    const emptyEl = root.querySelector("#empty-message") as HTMLElement | null;
    if (!listEl || !emptyEl) return;

    const meals = visibleMeals();
    const query = archiveQuery.trim().toLowerCase();

    if (meals.length === 0) {
      listEl.innerHTML = "";
      emptyEl.hidden = false;
      emptyEl.textContent =
        tab === "active"
          ? "Aucun repas pour l'instant. Ajoute une idée ci-dessus !"
          : query
            ? "Aucun repas ne correspond à la recherche."
            : "Aucun repas dans l'historique pour le moment.";
    } else {
      emptyEl.hidden = true;
      reconcileMealList(listEl, meals);
    }

    const toggleAllBtn = root.querySelector("#toggle-all-btn") as HTMLButtonElement | null;
    if (toggleAllBtn) {
      toggleAllBtn.hidden = meals.length === 0;
      const allExpanded = meals.length > 0 && meals.every((m) => expandedIds.has(m.id));
      toggleAllBtn.textContent = allExpanded ? "Tout replier" : "Tout déplier";
    }
  }

  /** Id du repas dont un champ texte (titre/source en édition en ligne, ou
   * commentaire) a le focus dans `listEl`, s'il y en a un. Un simple bouton
   * ayant le focus (ex: juste après un clic sur le chevron) ne compte pas :
   * lui seul régénère volontairement sa carte pour refléter le nouvel état. */
  function focusedMealId(listEl: HTMLElement): string | null {
    const active = document.activeElement;
    if (!(active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement)) return null;
    const card = active.closest<HTMLElement>(".meal-card");
    return card && listEl.contains(card) ? (card.dataset.id ?? null) : null;
  }

  /** Reconstruit la liste sans jamais régénérer la carte en cours d'édition :
   * comme il n'y a pas de mise à jour optimiste locale (voir ListConnection),
   * une mise à jour temps réel reçue pendant qu'on tape effacerait sinon la
   * saisie non encore validée (le nœud DOM de l'input/textarea serait détruit
   * et recréé avec l'ancienne valeur venue du serveur). */
  function reconcileMealList(listEl: HTMLElement, meals: Meal[]): void {
    const frozenId = focusedMealId(listEl);
    const existingById = new Map<string, HTMLLIElement>();
    listEl.querySelectorAll<HTMLLIElement>(".meal-card").forEach((li) => {
      if (li.dataset.id) existingById.set(li.dataset.id, li);
    });

    const cards = meals.map((meal) => {
      const existing = meal.id === frozenId ? existingById.get(meal.id) : undefined;
      if (existing) return existing;
      const card = elementFromHtml(mealCardHtml(meal, tab === "archive", expandedIds.has(meal.id), code));
      wireMealCard(card, meal);
      return card;
    });
    listEl.replaceChildren(...cards);
  }

  function elementFromHtml(html: string): HTMLLIElement {
    const template = document.createElement("template");
    template.innerHTML = html.trim();
    return template.content.firstElementChild as HTMLLIElement;
  }

  function wireMealCard(card: HTMLLIElement, meal: Meal): void {
    const id = meal.id;

    function toggleExpanded(): void {
      if (expandedIds.has(id)) expandedIds.delete(id);
      else expandedIds.add(id);
      renderMeals();
    }

    card.querySelector<HTMLButtonElement>('[data-action="toggle"]')?.addEventListener("click", toggleExpanded);

    // Élargit la zone cliquable pour déplier/replier au-delà du seul bouton
    // chevron (poignée de glissé, titre éditable et boutons d'action gardent
    // leur propre comportement, donc exclus ici — et le bouton chevron a
    // déjà son propre écouteur juste au-dessus, à ne pas déclencher deux fois).
    card.querySelector<HTMLElement>('[data-action="toggle-row"]')?.addEventListener("click", (e) => {
      const target = e.target as HTMLElement;
      if (target.closest(".drag-handle, .meal-controls, .meal-toggle, [data-action='edit-title']")) return;
      toggleExpanded();
    });

    const titleEl = card.querySelector<HTMLElement>('[data-action="edit-title"]');
    titleEl?.addEventListener("click", () => {
      startEdit(titleEl, {
        value: meal.title,
        maxLength: MAX_TITLE_LENGTH,
        onCommit: (value) => {
          if (value) conn.send({ type: "updateMeal", id, title: value });
          else render();
        },
      });
    });

    const sourceEl = card.querySelector<HTMLElement>('[data-action="edit-source"]');
    sourceEl?.addEventListener("click", () => {
      startEdit(sourceEl, {
        value: meal.source,
        placeholder: "Lien ou texte libre",
        maxLength: MAX_SOURCE_LENGTH,
        onCommit: (value) => conn.send({ type: "updateMeal", id, source: value }),
      });
    });

    card.querySelectorAll<HTMLButtonElement>(".status-pill").forEach((btn) => {
      btn.addEventListener("click", () => {
        const status = btn.dataset.status as MealStatus;
        if (status === meal.status) return;
        if (status === "fait") {
          // Lit la valeur en direct du textarea plutôt que meal.comment (qui
          // peut être périmé si on clique juste après avoir tapé, avant que
          // le blur n'ait eu le temps de synchroniser) : la modale doit
          // toujours proposer ce qui est effectivement affiché.
          const commentEl = card.querySelector<HTMLTextAreaElement>('[data-field="comment"]');
          const mealForModal = commentEl ? { ...meal, comment: commentEl.value } : meal;
          openMarkDoneModal(mealForModal, (note, comment, doneAt) => {
            conn.send({ type: "updateMeal", id, comment });
            conn.send({ type: "setMealNote", id, note });
            conn.send({ type: "setMealStatus", id, status: "fait", doneAt });
            showUndoToast("Repas déplacé vers l'historique.", () => conn.send({ type: "restoreMeal", id }));
          });
          return;
        }
        conn.send({ type: "setMealStatus", id, status });
      });
    });

    card.querySelector<HTMLTextAreaElement>('[data-field="comment"]')?.addEventListener("blur", (e) => {
      conn.send({ type: "updateMeal", id, comment: (e.target as HTMLTextAreaElement).value });
    });

    const deleteBtn = card.querySelector<HTMLButtonElement>('[data-action="delete"]');
    if (deleteBtn) {
      wireConfirmClick(deleteBtn, {
        armedLabel: "Confirmer la suppression ?",
        onConfirm: () => conn.send({ type: "deleteMeal", id }),
      });
    }

    const deleteForeverBtn = card.querySelector<HTMLButtonElement>('[data-action="delete-forever"]');
    if (deleteForeverBtn) {
      wireConfirmClick(deleteForeverBtn, {
        armedLabel: "Confirmer la suppression définitive ?",
        onConfirm: () => conn.send({ type: "deleteArchivedMeal", id }),
      });
    }

    card.querySelector<HTMLButtonElement>('[data-action="restore"]')?.addEventListener("click", () => {
      conn.send({ type: "restoreMeal", id });
    });

    wireMealImage(card, id);
  }

  /** Ajout/remplacement d'une photo (input file ou collage — ex : capture
   * d'écran) et suppression. Pas de mise à jour optimiste : comme pour le
   * reste de l'app, l'aperçu ne se met à jour qu'au retour de l'état par le
   * serveur (ici via la diffusion websocket déclenchée par l'upload, voir
   * worker/index.ts), l'appel HTTP se contentant de confirmer/rejeter
   * l'envoi lui-même. */
  function wireMealImage(card: HTMLLIElement, id: string): void {
    // Le champ reste inerte pendant l'envoi (le seul retour serait sinon
    // l'attente réseau elle-même, qui donne l'impression d'un blocage) :
    // boutons désactivés, aperçu/bouton d'ajout estompés, indicateur visible.
    function setLoading(loading: boolean): void {
      card.querySelector(".meal-image-field")?.classList.toggle("is-loading", loading);
      card.querySelectorAll<HTMLButtonElement>(".meal-image-field button").forEach((btn) => {
        btn.disabled = loading;
      });
      const loadingEl = card.querySelector<HTMLElement>(".meal-image-loading");
      if (loadingEl) loadingEl.hidden = !loading;
    }

    async function send(file: File | Blob): Promise<void> {
      if (!(ALLOWED_IMAGE_TYPES as readonly string[]).includes(file.type)) {
        showToast("Format d'image non supporté (PNG, JPEG, WebP ou GIF).");
        return;
      }
      if (file.size > MAX_IMAGE_BYTES) {
        showToast("Image trop volumineuse (5 Mo max).");
        return;
      }
      setLoading(true);
      try {
        await uploadMealImage(code, id, file);
      } catch (err) {
        showToast(err instanceof ApiError ? err.message : "Erreur réseau, réessaie.");
      } finally {
        setLoading(false);
      }
    }

    const input = card.querySelector<HTMLInputElement>('[data-action="image-input"]');
    card.querySelector<HTMLButtonElement>('[data-action="add-image"]')?.addEventListener("click", () => {
      input?.click();
    });
    input?.addEventListener("change", () => {
      const file = input.files?.[0];
      if (file) send(file);
      input.value = "";
    });

    card.querySelector<HTMLButtonElement>('[data-action="view-image"]')?.addEventListener("click", () => {
      const img = card.querySelector<HTMLImageElement>(".meal-image-preview img");
      if (img) openImageLightbox(img.src, img.alt);
    });

    const removeBtn = card.querySelector<HTMLButtonElement>('[data-action="remove-image"]');
    if (removeBtn) {
      wireConfirmClick(removeBtn, {
        armedLabel: "Confirmer la suppression ?",
        onConfirm: () => {
          setLoading(true);
          deleteMealImage(code, id)
            .catch((err) => {
              showToast(err instanceof ApiError ? err.message : "Erreur réseau, réessaie.");
            })
            .finally(() => setLoading(false));
        },
      });
    }

    // Coller une image (ex : capture d'écran) pendant que la carte est
    // dépliée l'envoie directement, sans passer par le sélecteur de
    // fichier — geste naturel juste après une capture d'écran.
    card.addEventListener("paste", (e) => {
      const items = e.clipboardData?.items;
      if (!items) return;
      for (const item of items) {
        if (item.kind === "file" && item.type.startsWith("image/")) {
          const file = item.getAsFile();
          if (file) {
            e.preventDefault();
            send(file);
          }
          return;
        }
      }
    });
  }

  let toastTimer: ReturnType<typeof setTimeout> | null = null;
  function showToast(message: string): void {
    showUndoToast(message, null);
  }

  function showUndoToast(message: string, onUndo: (() => void) | null): void {
    if (toastTimer) clearTimeout(toastTimer);
    document.getElementById("list-toast")?.remove();
    const el = document.createElement("div");
    el.id = "list-toast";
    el.className = "list-toast";
    el.setAttribute("role", "status");
    const span = document.createElement("span");
    span.textContent = message;
    el.appendChild(span);
    if (onUndo) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.textContent = "Annuler";
      btn.addEventListener("click", () => {
        onUndo();
        el.remove();
      });
      el.appendChild(btn);
    }
    document.body.appendChild(el);
    toastTimer = setTimeout(() => el.remove(), 6000);
  }

  return () => {
    conn.disconnect();
    document.getElementById("list-toast")?.remove();
  };
}

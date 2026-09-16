import type { ListState, Meal, MealStatus, PrepTime } from "../../shared/types";
import {
  MEAL_STATUSES,
  MEAL_STATUS_LABELS,
  MEAL_NOTES,
  MEAL_NOTE_LABELS,
  PREP_TIMES,
  PREP_TIME_LABELS,
  MAX_TITLE_LENGTH,
  MAX_LIST_NAME_LENGTH,
  MAX_SOURCE_LENGTH,
  MAX_COMMENT_LENGTH,
  MAX_IMAGE_BYTES,
  MAX_IMAGES_PER_MEAL,
  ALLOWED_IMAGE_TYPES,
} from "../../shared/types";
import { ListConnection } from "../lib/ws";
import { ApiError, fetchListState, uploadMealImage, deleteMealImage, mealImageUrl } from "../lib/http";
import { cacheListState, getCachedListState, touchRecentList } from "../lib/storage";
import { getSortByStatus, setSortByStatus } from "../lib/sortPreference";
import { uid } from "../lib/id";
import { escapeHtml, onActivate, trapFocus } from "../lib/dom";
import { startEdit } from "../lib/editable";
import { wireConfirmClick } from "../lib/confirmClick";
import { icons } from "../lib/icons";
import { appPath } from "../lib/basePath";
import { renderQrSvg } from "../lib/qr";
import { computeHistoryStats } from "../lib/historyStats";
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

/** Les libellés (voir MEAL_STATUS_LABELS/MEAL_NOTE_LABELS) sont toujours
 * "emoji + espace + texte" : l'emoji seul sert de badge compact (voir
 * mealCardHtml) sans reprendre le texte complet, trop large une fois la
 * carte repliée. */
function firstEmoji(label: string): string {
  return label.split(" ")[0];
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

/** Purement indicatif (pas de durée précise) : rapide/normal/long plutôt
 * qu'un champ libre, pour rester aussi rapide à renseigner que le statut. */
function prepTimePickerHtml(selected: Meal["prepTime"]): string {
  const noneBtn = `<button type="button" class="preptime-pill" data-preptime="" aria-pressed="${selected ? "false" : "true"}">Non renseigné</button>`;
  const options = PREP_TIMES.map(
    (p) =>
      `<button type="button" class="preptime-pill" data-preptime="${p}" aria-pressed="${p === selected}">${PREP_TIME_LABELS[p]}</button>`,
  ).join("");
  return `<div class="preptime-picker" role="group" aria-label="Temps de préparation">${noneBtn}${options}</div>`;
}

/** Pastilles multi-sélection (contrairement à statusPickerHtml, une seule
 * valeur au plus) : voir activeStatusFilters dans mountListView. Classes
 * distinctes de .status-pill/.preptime-pill (bien que visuellement
 * identiques, voir style.css) : les deux pickers coexistent toujours dans
 * le DOM (carte de repas + panneau de filtre), une classe partagée rendrait
 * les sélecteurs ambigus (ex : en tests e2e). */
function filterStatusPickerHtml(active: Set<MealStatus>): string {
  const pills = MEAL_STATUSES.map(
    (s) => `<button type="button" class="filter-status-pill" data-status="${s}" aria-pressed="${active.has(s)}">${MEAL_STATUS_LABELS[s]}</button>`,
  ).join("");
  return `<div class="status-picker" role="group" aria-label="Filtrer par statut">${pills}</div>`;
}

function filterPrepTimePickerHtml(active: Set<PrepTime>): string {
  const pills = PREP_TIMES.map(
    (p) =>
      `<button type="button" class="filter-preptime-pill" data-preptime="${p}" aria-pressed="${active.has(p)}">${PREP_TIME_LABELS[p]}</button>`,
  ).join("");
  return `<div class="preptime-picker" role="group" aria-label="Filtrer par temps de préparation">${pills}</div>`;
}

function historyStatsHtml(archive: Meal[]): string {
  const stats = computeHistoryStats(archive);
  if (stats.total === 0) {
    return `<p class="stats-empty">Aucun repas dans l'historique pour l'instant.</p>`;
  }
  const noteGroup = stats.byNote.length
    ? `<div class="stats-group">
        <h3>Par note</h3>
        <ul class="stats-list">${stats.byNote
          .map((x) => `<li><span>${MEAL_NOTE_LABELS[x.note]}</span><span class="stats-count">${x.count}</span></li>`)
          .join("")}</ul>
      </div>`
    : "";
  const prepGroup = stats.byPrepTime.length
    ? `<div class="stats-group">
        <h3>Par temps de préparation</h3>
        <ul class="stats-list">${stats.byPrepTime
          .map((x) => `<li><span>${PREP_TIME_LABELS[x.prepTime]}</span><span class="stats-count">${x.count}</span></li>`)
          .join("")}</ul>
      </div>`
    : "";
  const topGroup = stats.topMeals.length
    ? `<div class="stats-group">
        <h3>Les plus refaits</h3>
        <ul class="stats-list">${stats.topMeals
          .map((x) => `<li><span>${escapeHtml(x.title)}</span><span class="stats-count">×${x.count}</span></li>`)
          .join("")}</ul>
      </div>`
    : "";
  return `<p class="stats-total">${stats.total} repas dans l'historique.</p>${noteGroup}${prepGroup}${topGroup}`;
}

/** Lundi de la semaine (minuit local) contenant `ts` — voir l'onglet
 * Planning, qui affiche toujours une semaine complète de lundi à dimanche. */
function startOfWeek(ts: number): number {
  const d = new Date(ts);
  const day = d.getDay(); // 0 = dimanche .. 6 = samedi
  const diffToMonday = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diffToMonday);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function addDays(ts: number, days: number): number {
  const d = new Date(ts);
  d.setDate(d.getDate() + days);
  return d.getTime();
}

const PLANNING_DAY_LABELS = ["Lundi", "Mardi", "Mercredi", "Jeudi", "Vendredi", "Samedi", "Dimanche"];

/** Grille des 7 jours de la semaine commençant à `weekStart` (voir
 * startOfWeek), chacun listant les repas actifs planifiés ce jour-là — voir
 * Meal.plannedDate. Uniquement les repas actifs : un repas archivé ("fait")
 * n'a plus de raison d'apparaître dans une planification à venir. */
function planningHtml(activeMeals: Meal[], weekStart: number): string {
  // Minuit aujourd'hui (contrairement à startOfWeek(Date.now()), qui donne
  // le lundi de la semaine courante, pas le jour lui-même) : sert à
  // repérer la colonne du jour dans la grille, quelle que soit la semaine
  // affichée.
  const todayDayStart = new Date(new Date().setHours(0, 0, 0, 0)).getTime();
  const days = PLANNING_DAY_LABELS.map((label, i) => {
    const dayStart = addDays(weekStart, i);
    const dayEnd = addDays(weekStart, i + 1);
    const dayMeals = activeMeals.filter((m) => m.plannedDate !== null && m.plannedDate >= dayStart && m.plannedDate < dayEnd);
    const isToday = dayStart === todayDayStart;
    const entries = dayMeals.length
      ? dayMeals
          .map(
            (m) => `
              <li class="planning-entry" data-id="${escapeHtml(m.id)}">
                <span class="planning-entry-title">${escapeHtml(m.title)}</span>
                <button type="button" class="icon-btn" data-action="unplan" aria-label="Retirer « ${escapeHtml(m.title)} » du planning">${icons.close}</button>
              </li>`,
          )
          .join("")
      : `<li class="planning-entry-empty">—</li>`;
    const dateLabel = new Date(dayStart).toLocaleDateString("fr-FR", { day: "numeric", month: "short" });
    return `
      <div class="planning-day${isToday ? " today" : ""}">
        <div class="planning-day-label">${label} <span class="planning-day-date">${dateLabel}</span></div>
        <ul class="planning-entries">${entries}</ul>
      </div>`;
  }).join("");
  const weekLabel = `Semaine du ${new Date(weekStart).toLocaleDateString("fr-FR", { day: "numeric", month: "short" })}`;
  return `
    <div class="planning-nav">
      <button type="button" class="icon-btn" id="planning-prev" aria-label="Semaine précédente">${icons.back}</button>
      <span class="planning-week-label">${weekLabel}</span>
      <button type="button" class="icon-btn" id="planning-next" aria-label="Semaine suivante">${icons.forward}</button>
      <button type="button" class="btn-link" id="planning-today-btn">Aujourd'hui</button>
    </div>
    <div class="planning-grid">${days}</div>`;
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
  const triggerEl = document.activeElement;
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
  const untrap = trapFocus(overlay, triggerEl);

  const close = () => {
    overlay.remove();
    document.removeEventListener("keydown", onKeydown);
    untrap();
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

/** Affiche une image en plein écran (clic sur une miniature de la galerie,
 * voir mealImageFieldHtml/wireMealImage) : overlay sombre, fermeture au clic
 * n'importe où dessus, sur Échap, ou sur le bouton fermer — même mécanique
 * que openMarkDoneModal. Plusieurs photos par repas (voir Meal.images) : la
 * navigation précédent/suivant (boutons, flèches clavier) ne s'affiche que
 * s'il y en a plus d'une. */
function openImageLightbox(images: { url: string; alt: string }[], startIndex: number): void {
  if (images.length === 0) return;
  let index = startIndex;
  const triggerEl = document.activeElement;
  const overlay = document.createElement("div");
  overlay.className = "modal-overlay image-lightbox-overlay";
  overlay.setAttribute("role", "dialog");
  overlay.setAttribute("aria-modal", "true");
  document.body.appendChild(overlay);

  const untrap = trapFocus(overlay, triggerEl);

  const close = () => {
    overlay.remove();
    document.removeEventListener("keydown", onKeydown);
    untrap();
  };

  function go(delta: number): void {
    index = (index + delta + images.length) % images.length;
    renderContent(delta > 0 ? "next" : "prev");
  }

  function onKeydown(e: KeyboardEvent): void {
    if (e.key === "Escape") close();
    else if (e.key === "ArrowLeft" && images.length > 1) go(-1);
    else if (e.key === "ArrowRight" && images.length > 1) go(1);
  }

  // Régénère le contenu de l'overlay plutôt que d'en ouvrir une nouvelle à
  // chaque navigation : garde le même overlay/piège de focus, et permet de
  // rendre le focus au bouton précédent/suivant qui vient d'être activé
  // (focusTarget) plutôt qu'au bouton fermer par défaut.
  function renderContent(focusTarget: "close" | "prev" | "next" = "close"): void {
    const img = images[index];
    overlay.setAttribute("aria-label", img.alt);
    const hasMultiple = images.length > 1;
    overlay.innerHTML = `
      <button type="button" class="icon-btn image-lightbox-close" aria-label="Fermer">${icons.close}</button>
      ${hasMultiple ? `<button type="button" class="icon-btn image-lightbox-prev" aria-label="Photo précédente">${icons.back}</button>` : ""}
      <img src="${escapeHtml(img.url)}" alt="${escapeHtml(img.alt)}" class="image-lightbox-img" />
      ${hasMultiple ? `<button type="button" class="icon-btn image-lightbox-next" aria-label="Photo suivante">${icons.forward}</button>` : ""}
      ${hasMultiple ? `<span class="image-lightbox-counter">${index + 1} / ${images.length}</span>` : ""}`;
    overlay.querySelector(".image-lightbox-close")?.addEventListener("click", close);
    overlay.querySelector(".image-lightbox-prev")?.addEventListener("click", (e) => {
      e.stopPropagation();
      go(-1);
    });
    overlay.querySelector(".image-lightbox-next")?.addEventListener("click", (e) => {
      e.stopPropagation();
      go(1);
    });
    const focusSelector =
      focusTarget === "prev" ? ".image-lightbox-prev" : focusTarget === "next" ? ".image-lightbox-next" : ".image-lightbox-close";
    (overlay.querySelector<HTMLElement>(focusSelector) ?? overlay.querySelector<HTMLElement>(".image-lightbox-close"))?.focus();
  }

  // Un clic n'importe où sur l'overlay referme (pas seulement le bouton
  // fermer dédié) — y compris sur l'image elle-même, qui n'a pas d'autre
  // interaction. Les boutons précédent/suivant appellent stopPropagation
  // (voir plus haut) pour ne pas déclencher cette fermeture après avoir
  // juste navigué.
  overlay.addEventListener("click", close);
  document.addEventListener("keydown", onKeydown);
  renderContent();
}

/** Photos jointes (jusqu'à MAX_IMAGES_PER_MEAL) : une galerie de miniatures
 * (chacune cliquable pour s'afficher en plein écran avec navigation, voir
 * openImageLightbox, et individuellement supprimable) + un bouton d'ajout
 * tant que la limite n'est pas atteinte. Uploadées via un input file
 * (data-action="add-image") ou en collant depuis le presse-papiers (voir
 * wireMealCard) — les deux passent par la même fonction d'envoi, dont
 * l'indicateur de chargement ci-dessous (masqué par défaut) reflète la
 * progression : sans lui, le temps d'attente réseau donne l'impression que
 * rien ne s'est passé. */
function mealImageFieldHtml(meal: Meal, code: string): string {
  const thumbs = meal.images
    .map(
      (imageId) => `
        <div class="meal-image-item" data-image-id="${escapeHtml(imageId)}">
          <button type="button" class="meal-image-view" data-action="view-image" data-image-id="${escapeHtml(imageId)}">
            <img src="${escapeHtml(mealImageUrl(code, meal.id, imageId))}" alt="Photo de « ${escapeHtml(meal.title)} »" loading="lazy" />
          </button>
          <button type="button" class="icon-btn danger-hover meal-image-remove" data-action="remove-image" data-image-id="${escapeHtml(imageId)}" aria-label="Supprimer cette photo">${icons.trash}</button>
        </div>`,
    )
    .join("");
  const addBtn =
    meal.images.length < MAX_IMAGES_PER_MEAL
      ? `<button type="button" class="btn meal-image-add" data-action="add-image">${icons.image} Ajouter une photo</button>`
      : "";
  return `
    <div class="meal-field meal-image-field">
      <span class="meal-field-label">Photos</span>
      <div class="meal-image-gallery">${thumbs}</div>
      ${addBtn}
      <span class="meal-image-loading" hidden><span class="spinner" aria-hidden="true"></span>Envoi…</span>
      <input type="file" class="meal-image-input" data-action="image-input" accept="${ALLOWED_IMAGE_TYPES.join(",")}" hidden />
    </div>`;
}

/** Replié par défaut (juste le titre) : le contenu (statut, source,
 * commentaire) ne s'affiche qu'une fois déplié, au clic sur le chevron ou
 * via "Tout déplier" — voir expandedIds dans mountListView. */
function mealCardHtml(meal: Meal, archived: boolean, expanded: boolean, code: string, reorderable: boolean): string {
  const statusArea = archived
    ? `<span class="status-badge">🎉 Fait le ${formatDate(meal.doneAt ?? meal.updatedAt)}</span>`
    : statusPickerHtml(meal.status);

  // Repère visible même carte repliée (voir aussi colorAttr plus bas, dont
  // le seul liséré de couleur s'est révélé insuffisant en pratique pour
  // distinguer le statut d'un coup d'œil) : l'emoji du statut (ou de la
  // note une fois archivé, si renseignée) plutôt que le libellé complet,
  // qui prendrait trop de place une fois la carte repliée.
  const badgeLabel = archived ? (meal.note ? MEAL_NOTE_LABELS[meal.note] : "Fait") : MEAL_STATUS_LABELS[meal.status];
  const badgeEmoji = archived ? (meal.note ? firstEmoji(MEAL_NOTE_LABELS[meal.note]) : "🎉") : firstEmoji(MEAL_STATUS_LABELS[meal.status]);
  const statusBadge = `<span class="meal-status-badge" role="img" aria-label="${escapeHtml(badgeLabel)}" title="${escapeHtml(badgeLabel)}">${badgeEmoji}</span>`;

  // Repliée, la carte ne garde que l'action la plus utile depuis l'historique
  // (remettre en liste) ; les suppressions, destructives et rares, n'ont pas
  // besoin d'être à portée de tap en permanence — elles n'apparaissent
  // qu'une fois la carte dépliée.
  const restoreBtn = archived
    ? `<button type="button" class="icon-btn" data-action="restore" aria-label="Remettre dans la liste" title="Remettre dans la liste">${icons.undo}</button>`
    : "";

  const copyTitleBtn = `<button type="button" class="icon-btn" data-action="copy-title" aria-label="Copier le titre" title="Copier le titre">${icons.copy}</button>`;

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
          <div class="meal-source" data-action="edit-source" role="button" tabindex="0">${sourceHtml(meal.source)}</div>
        </div>
        <div class="meal-field">
          <span class="meal-field-label">Temps de préparation</span>
          ${prepTimePickerHtml(meal.prepTime)}
        </div>
        ${
          archived
            ? ""
            : `<div class="meal-field">
                <label class="meal-field-label" for="meal-planned-${escapeHtml(meal.id)}">Jour prévu</label>
                <input type="date" id="meal-planned-${escapeHtml(meal.id)}" class="meal-planned-date" data-action="planned-date" value="${meal.plannedDate ? toDateInputValue(meal.plannedDate) : ""}" />
              </div>`
        }
        <div class="meal-field">
          <label class="meal-field-label" for="meal-comment-${escapeHtml(meal.id)}">Commentaire</label>
          <textarea id="meal-comment-${escapeHtml(meal.id)}" class="meal-comment" data-field="comment" placeholder="Une note sur ce repas…" rows="2" maxlength="${MAX_COMMENT_LENGTH}">${escapeHtml(meal.comment)}</textarea>
        </div>
        ${mealImageFieldHtml(meal, code)}
        <div class="meal-details-actions">${deleteBtn}</div>
      </div>`
    : "";

  // Repère de couleur sur le bord gauche de la carte (voir style.css,
  // .meal-card[data-status]/[data-note]) : statut pour un repas en cours,
  // note (si renseignée) pour un repas de l'historique — en complément de
  // statusBadge ci-dessus (emoji), pas à sa place : un simple liséré s'est
  // révélé insuffisant seul pour distinguer le statut d'un coup d'œil,
  // notamment carte repliée.
  // Échappés bien que le reducer serveur valide déjà status/note contre les
  // enums attendues (voir worker/reducer.ts) : ce sont deux couches
  // indépendantes, pas l'une à la place de l'autre — un attribut HTML non
  // échappé reste une XSS stockée potentielle pour n'importe quelle valeur
  // qui finirait par lui être passée, y compris via un futur changement côté
  // serveur.
  const colorAttr = archived
    ? meal.note
      ? ` data-note="${escapeHtml(meal.note)}"`
      : ""
    : ` data-status="${escapeHtml(meal.status)}"`;

  // Sur la liste active, le chevron sert aussi de poignée de glissé (voir
  // wireMealList/SortableJS) : un tap déplie/replie, un appui-glissé
  // réordonne. Le navigateur ne déclenche pas de "click" après un glissé
  // avec déplacement, donc pas d'ambiguïté entre les deux gestes — et un
  // seul élément plutôt que deux économise de la place sur la ligne
  // repliée. Sur l'historique (jamais réordonnable), c'est un bouton simple.
  const toggleBtn = `<button type="button" class="icon-btn meal-toggle${reorderable ? " drag-handle" : ""}" data-action="toggle" aria-expanded="${expanded}" aria-label="${expanded ? "Réduire" : "Déplier"}"${reorderable ? ` title="Glisser pour réordonner"` : ""}>${reorderable ? icons.grip : icons.chevronDown}</button>`;

  return `
    <li class="meal-card${archived ? " archived" : ""}${expanded ? " expanded" : ""}" data-id="${escapeHtml(meal.id)}"${colorAttr}>
      <div class="meal-main" data-action="toggle-row">
        ${toggleBtn}
        ${statusBadge}
        <h3 class="meal-title" data-action="edit-title" role="button" tabindex="0">${escapeHtml(meal.title)}</h3>
        <div class="meal-controls">${copyTitleBtn}${restoreBtn}</div>
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
        <h1 id="list-title" role="button" tabindex="0">${escapeHtml(state.name)}</h1>
        <span class="conn-dot" id="conn-dot" title="${connected ? "Synchronisé" : "Connexion…"}"></span>
        <button type="button" class="icon-btn" id="menu-toggle-btn" aria-label="Menu" aria-expanded="false">${icons.more}</button>
      </header>
      <div class="action-menu" id="action-menu" hidden>
        <button type="button" class="btn-link" id="sort-toggle-btn" aria-pressed="false">Trier par statut</button>
        <button type="button" class="btn-link" id="filter-toggle-btn" aria-pressed="false">Filtrer</button>
        <button type="button" class="btn-link" id="toggle-all-btn" hidden>Tout déplier</button>
        <button type="button" class="btn-link" id="btn-share">Partager</button>
      </div>
      <div class="share-panel" id="share-panel" hidden>
        <p>Code : <strong id="share-code">${state.code}</strong></p>
        <div class="qr-wrap" id="qr-wrap" aria-label="QR code de partage"></div>
        <button type="button" class="btn" id="copy-name">Copier le nom</button>
        <button type="button" class="btn" id="copy-code">Copier le code</button>
        <button type="button" class="btn" id="copy-link">Copier le lien</button>
      </div>

      <nav class="tabs" id="tabs">
        <button type="button" class="tab-btn" data-tab="active" aria-pressed="true">Repas</button>
        <button type="button" class="tab-btn" data-tab="planning" aria-pressed="false">${icons.calendar} Planning</button>
        <button type="button" class="tab-btn" data-tab="archive" aria-pressed="false">${icons.history} Historique</button>
      </nav>

      <section class="card add-meal-card" id="add-meal-card">
        <form id="add-form" class="row">
          <label class="sr-only" for="add-title">Nom du repas</label>
          <input id="add-title" type="text" placeholder="Nom du repas" maxlength="${MAX_TITLE_LENGTH}" autocomplete="off" />
          <button type="submit" class="btn primary">${icons.plus} Ajouter</button>
        </form>
        <ul class="add-suggestions" id="add-suggestions" aria-label="Repas déjà faits" hidden></ul>
      </section>

      <div class="card filter-panel" id="filter-panel" hidden>
        <div class="filter-group">
          <span class="meal-field-label">Statut</span>
          <div id="filter-status-pills"></div>
        </div>
        <div class="filter-group">
          <span class="meal-field-label">Temps de préparation</span>
          <div id="filter-preptime-pills"></div>
        </div>
        <button type="button" class="btn-link filter-reset-btn" id="filter-reset-btn" hidden>Réinitialiser les filtres</button>
      </div>

      <section class="card search-card" id="search-card" hidden>
        <div class="search-row">
          <label class="sr-only" for="archive-search">Rechercher dans l'historique</label>
          <input id="archive-search" type="search" placeholder="Rechercher dans l'historique…" autocomplete="off" />
          <button type="button" class="btn-link" id="stats-toggle-btn" aria-pressed="false">Statistiques</button>
        </div>
        <div class="stats-panel" id="stats-panel" hidden></div>
      </section>

      <div class="card planning-view" id="planning-view" hidden></div>

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
  let tab: "active" | "planning" | "archive" = "active";
  let archiveQuery = "";
  // Filtres de la liste active (voir wireFilters/visibleMeals) : un
  // ensemble vide signifie "pas de filtre", pas "tout exclure". Purement en
  // mémoire (pas persisté, contrairement à sortByStatus) : contrairement à
  // une préférence d'appareil, un filtre a vocation à être remis à zéro
  // d'une visite à l'autre.
  const activeStatusFilters = new Set<MealStatus>();
  const activePrepTimeFilters = new Set<PrepTime>();
  // Semaine affichée dans l'onglet Planning (voir renderPlanning) : le lundi
  // de la semaine courante par défaut.
  let weekStart = startOfWeek(Date.now());
  // Préférence propre à cet appareil (voir src/lib/sortPreference.ts) : trie
  // la liste active par statut plutôt que par ordre manuel. Le glisser-
  // déposer (voir wireMealList) n'a alors plus de sens et est désactivé tant
  // qu'elle reste active.
  let sortByStatus = getSortByStatus();
  let sortable: Sortable | null = null;
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
      wireStats();
      wireFilters();
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

  /** Referme le menu d'actions (tri, filtrer, tout déplier, partager) —
   * appelé après chaque sélection dedans (voir wireHeader/wireToolbar/
   * wireFilters), contrairement au panneau de partage ou de filtres, qui
   * restent ouverts après une action pour permettre plusieurs interactions
   * de suite (copier plusieurs champs, cocher plusieurs filtres). */
  function closeActionMenu(): void {
    const menu = root.querySelector("#action-menu") as HTMLElement | null;
    if (menu) menu.hidden = true;
    root.querySelector("#menu-toggle-btn")?.setAttribute("aria-expanded", "false");
  }

  function wireHeader(): void {
    root.querySelector("#btn-home")?.addEventListener("click", () => navigate("/"));

    const actionMenu = root.querySelector("#action-menu") as HTMLElement | null;
    const menuToggleBtn = root.querySelector("#menu-toggle-btn") as HTMLButtonElement | null;
    menuToggleBtn?.addEventListener("click", (e) => {
      e.stopPropagation();
      if (!actionMenu) return;
      actionMenu.hidden = !actionMenu.hidden;
      menuToggleBtn.setAttribute("aria-expanded", String(!actionMenu.hidden));
    });
    actionMenu?.addEventListener("click", (e) => e.stopPropagation());

    const sharePanel = root.querySelector("#share-panel") as HTMLElement | null;
    root.querySelector("#btn-share")?.addEventListener("click", (e) => {
      e.stopPropagation();
      if (sharePanel) sharePanel.hidden = !sharePanel.hidden;
      closeActionMenu();
    });
    document.addEventListener("click", () => {
      if (sharePanel) sharePanel.hidden = true;
      closeActionMenu();
    });
    sharePanel?.addEventListener("click", (e) => e.stopPropagation());
    root.querySelector("#copy-name")?.addEventListener("click", () => {
      if (state) copyToClipboard(state.name, "Nom copié.");
    });
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
    if (titleEl) {
      onActivate(titleEl, () => {
        if (!state) return;
        const previousName = state.name;
        startEdit(titleEl, {
          value: state.name,
          maxLength: MAX_LIST_NAME_LENGTH,
          onCommit: (value) => {
            if (!value) {
              render();
              return;
            }
            conn.send({ type: "renameList", name: value });
            if (value !== previousName) {
              showUndoToast("Nom de la liste modifié.", () => conn.send({ type: "renameList", name: previousName }));
            }
          },
        });
      });
    }
  }

  function activateTab(next: "active" | "planning" | "archive"): void {
    tab = next;
    root.querySelectorAll<HTMLButtonElement>(".tab-btn").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.tab === tab)));
    const addCard = root.querySelector("#add-meal-card") as HTMLElement | null;
    if (addCard) addCard.hidden = tab !== "active";
    const searchCard = root.querySelector("#search-card") as HTMLElement | null;
    if (searchCard) searchCard.hidden = tab !== "archive";
    const mealListEl = root.querySelector("#meal-list") as HTMLElement | null;
    if (mealListEl) mealListEl.hidden = tab === "planning";
    const planningView = root.querySelector("#planning-view") as HTMLElement | null;
    if (planningView) planningView.hidden = tab !== "planning";
    updateSortToggleBtn();
    updateFilterToggleBtn();
    renderMeals();
  }

  function wireTabs(): void {
    root.querySelectorAll<HTMLButtonElement>(".tab-btn").forEach((btn) => {
      btn.addEventListener("click", () => activateTab(btn.dataset.tab as "active" | "planning" | "archive"));
    });
  }

  /** Le tri automatique par statut (voir sortByStatus) n'a de sens que sur la
   * liste active : masqué sur l'historique, dont l'ordre suit toujours la
   * date d'archivage. */
  function updateSortToggleBtn(): void {
    const btn = root.querySelector("#sort-toggle-btn") as HTMLButtonElement | null;
    if (!btn) return;
    btn.hidden = tab !== "active";
    btn.setAttribute("aria-pressed", String(sortByStatus));
    btn.textContent = sortByStatus ? "Tri manuel" : "Trier par statut";
  }

  /** Les filtres ne concernent que la liste active (voir visibleMeals) :
   * masqué sur les autres onglets, même motif que updateSortToggleBtn.
   * Referme aussi le panneau en quittant l'onglet actif — sans bouton
   * visible pour le rouvrir/refermer ailleurs, il resterait sinon affiché
   * hors de propos sur l'historique ou le planning. */
  function updateFilterToggleBtn(): void {
    const btn = root.querySelector("#filter-toggle-btn") as HTMLButtonElement | null;
    if (!btn) return;
    btn.hidden = tab !== "active";
    if (tab !== "active") {
      const panel = root.querySelector("#filter-panel") as HTMLElement | null;
      if (panel) panel.hidden = true;
      btn.setAttribute("aria-pressed", "false");
    }
  }

  function wireSearch(): void {
    root.querySelector("#archive-search")?.addEventListener("input", (e) => {
      archiveQuery = (e.target as HTMLInputElement).value;
      renderMeals();
    });
  }

  function wireStats(): void {
    const toggleBtn = root.querySelector("#stats-toggle-btn") as HTMLButtonElement | null;
    const panel = root.querySelector("#stats-panel") as HTMLElement | null;
    toggleBtn?.addEventListener("click", () => {
      if (!panel) return;
      panel.hidden = !panel.hidden;
      toggleBtn.setAttribute("aria-pressed", String(!panel.hidden));
      if (!panel.hidden) updateStatsPanel();
    });
  }

  /** Recalculée à chaque rendu (voir renderMeals) plutôt qu'une fois pour
   * toutes : les statistiques doivent refléter l'historique à jour, y
   * compris quand un autre appareil archive un repas pendant que le panneau
   * est ouvert. Inutile tant qu'il est masqué. */
  function updateStatsPanel(): void {
    const panel = root.querySelector("#stats-panel") as HTMLElement | null;
    if (!panel || panel.hidden || !state) return;
    panel.innerHTML = historyStatsHtml(state.archive);
  }

  /** Filtres de la liste active (statut, temps de préparation) : multi-
   * sélection, purement client (voir activeStatusFilters/activePrepTimeFilters) —
   * contrairement au tri par statut (sortByStatus), rien n'est envoyé au
   * serveur. */
  function wireFilters(): void {
    const toggleBtn = root.querySelector("#filter-toggle-btn") as HTMLButtonElement | null;
    const panel = root.querySelector("#filter-panel") as HTMLElement | null;
    toggleBtn?.addEventListener("click", () => {
      if (!panel) return;
      panel.hidden = !panel.hidden;
      toggleBtn.setAttribute("aria-pressed", String(!panel.hidden));
      closeActionMenu();
    });
    root.querySelector("#filter-reset-btn")?.addEventListener("click", () => {
      activeStatusFilters.clear();
      activePrepTimeFilters.clear();
      renderFilterPickers();
      renderMeals();
    });
    renderFilterPickers();
    updateFilterToggleBtn();
  }

  function renderFilterPickers(): void {
    const statusEl = root.querySelector("#filter-status-pills") as HTMLElement | null;
    if (statusEl) {
      statusEl.innerHTML = filterStatusPickerHtml(activeStatusFilters);
      statusEl.querySelectorAll<HTMLButtonElement>(".filter-status-pill").forEach((btn) => {
        btn.addEventListener("click", () => {
          const status = btn.dataset.status as MealStatus;
          if (activeStatusFilters.has(status)) activeStatusFilters.delete(status);
          else activeStatusFilters.add(status);
          renderFilterPickers();
          renderMeals();
        });
      });
    }
    const prepEl = root.querySelector("#filter-preptime-pills") as HTMLElement | null;
    if (prepEl) {
      prepEl.innerHTML = filterPrepTimePickerHtml(activePrepTimeFilters);
      prepEl.querySelectorAll<HTMLButtonElement>(".filter-preptime-pill").forEach((btn) => {
        btn.addEventListener("click", () => {
          const prepTime = btn.dataset.preptime as PrepTime;
          if (activePrepTimeFilters.has(prepTime)) activePrepTimeFilters.delete(prepTime);
          else activePrepTimeFilters.add(prepTime);
          renderFilterPickers();
          renderMeals();
        });
      });
    }
    const resetBtn = root.querySelector("#filter-reset-btn") as HTMLButtonElement | null;
    if (resetBtn) resetBtn.hidden = activeStatusFilters.size === 0 && activePrepTimeFilters.size === 0;
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
      closeActionMenu();
    });

    root.querySelector("#sort-toggle-btn")?.addEventListener("click", () => {
      sortByStatus = !sortByStatus;
      setSortByStatus(sortByStatus);
      updateSortToggleBtn();
      sortable?.option("disabled", sortByStatus);
      renderMeals();
      closeActionMenu();
    });
    updateSortToggleBtn();
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
    // Pas d'animation de repositionnement en mode accessibilité (voir
    // src/lib/a11y.ts) ni si le système demande de réduire les animations :
    // SortableJS n'a pas d'option "prefers-reduced-motion" native, donc on
    // vérifie les deux nous-mêmes.
    const reduceMotion =
      document.documentElement.hasAttribute("data-a11y") || matchMedia("(prefers-reduced-motion: reduce)").matches;
    sortable = new Sortable(listEl, {
      handle: ".drag-handle",
      draggable: ".meal-card",
      animation: reduceMotion ? 0 : 150,
      // Glisser une carte n'a plus de sens tant que le tri automatique par
      // statut est actif (voir sortByStatus/wireToolbar) : l'ordre y est
      // recalculé à chaque rendu, un glissé serait aussitôt défait.
      disabled: sortByStatus,
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
          return `<li><button type="button" class="add-suggestion" data-id="${escapeHtml(m.id)}"><span class="add-suggestion-title">${icons.history} ${escapeHtml(m.title)}</span>${note}</button></li>`;
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
   * exactement les mêmes repas. Sur la liste active, soit l'ordre manuel
   * (glisser-déposer), soit un tri automatique par statut (voir
   * sortByStatus) — au choix, jamais les deux à la fois. */
  function visibleMeals(): Meal[] {
    if (!state) return [];
    if (tab === "planning") return [];
    const query = archiveQuery.trim().toLowerCase();
    if (tab === "archive") {
      return query ? state.archive.filter((m) => m.title.toLowerCase().includes(query)) : state.archive;
    }
    let meals = state.meals;
    if (activeStatusFilters.size > 0) meals = meals.filter((m) => activeStatusFilters.has(m.status));
    if (activePrepTimeFilters.size > 0) meals = meals.filter((m) => m.prepTime !== null && activePrepTimeFilters.has(m.prepTime));
    return sortByStatus
      ? [...meals].sort((a, b) => MEAL_STATUSES.indexOf(a.status) - MEAL_STATUSES.indexOf(b.status) || a.order - b.order)
      : [...meals].sort((a, b) => a.order - b.order);
  }

  function renderMeals(): void {
    if (!state) return;

    if (tab === "planning") {
      const emptyEl = root.querySelector("#empty-message") as HTMLElement | null;
      if (emptyEl) emptyEl.hidden = true;
      const toggleAllBtn = root.querySelector("#toggle-all-btn") as HTMLButtonElement | null;
      if (toggleAllBtn) toggleAllBtn.hidden = true;
      renderPlanning();
      return;
    }

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
          ? state.meals.length === 0
            ? "Aucun repas pour l'instant. Ajoute une idée ci-dessus !"
            : "Aucun repas ne correspond aux filtres."
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

    if (tab === "archive") updateStatsPanel();
  }

  function renderPlanning(): void {
    const container = root.querySelector("#planning-view") as HTMLElement | null;
    if (!container || !state) return;
    container.innerHTML = planningHtml(state.meals, weekStart);
    container.querySelector("#planning-prev")?.addEventListener("click", () => {
      weekStart = addDays(weekStart, -7);
      renderPlanning();
    });
    container.querySelector("#planning-next")?.addEventListener("click", () => {
      weekStart = addDays(weekStart, 7);
      renderPlanning();
    });
    container.querySelector("#planning-today-btn")?.addEventListener("click", () => {
      weekStart = startOfWeek(Date.now());
      renderPlanning();
    });
    container.querySelectorAll<HTMLButtonElement>('[data-action="unplan"]').forEach((btn) => {
      btn.addEventListener("click", () => {
        const li = btn.closest<HTMLLIElement>(".planning-entry");
        const id = li?.dataset.id;
        if (id) conn.send({ type: "setMealPlannedDate", id, plannedDate: null });
      });
    });
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

  /** Reconstruit la liste en réutilisant chaque carte dont le contenu affiché
   * n'a pas changé, plutôt que de tout régénérer à chaque état reçu : une
   * mise à jour temps réel ne modifie en général qu'un seul repas, inutile
   * de détruire/recréer (HTML + ré-attachement des écouteurs) toutes les
   * autres. Le repas garde `updatedAt` à jour à chaque mutation du reducer
   * (sauf reorderMeals, qui ne change pas le contenu affiché d'une carte) :
   * combiné à l'état déplié/replié (propre au client, pas au repas), ça
   * suffit à savoir si une carte doit être régénérée. La carte en cours
   * d'édition (`frozenId`) reste elle un cas à part : il ne faut jamais
   * l'écraser, même si `updatedAt` a changé, sous peine d'effacer une saisie
   * non encore validée (le nœud DOM de l'input/textarea serait détruit et
   * recréé avec l'ancienne valeur venue du serveur). */
  function reconcileMealList(listEl: HTMLElement, meals: Meal[]): void {
    const frozenId = focusedMealId(listEl);
    const existingById = new Map<string, HTMLLIElement>();
    listEl.querySelectorAll<HTMLLIElement>(".meal-card").forEach((li) => {
      if (li.dataset.id) existingById.set(li.dataset.id, li);
    });

    const reorderable = tab === "active" && !sortByStatus;
    const cards = meals.map((meal) => {
      const existing = existingById.get(meal.id);
      const expanded = expandedIds.has(meal.id);
      const rev = `${meal.updatedAt}:${expanded}:${reorderable}`;
      if (existing && (meal.id === frozenId || existing.dataset.rev === rev)) return existing;
      const card = elementFromHtml(mealCardHtml(meal, tab === "archive", expanded, code, reorderable));
      card.dataset.rev = rev;
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
    if (titleEl) {
      onActivate(titleEl, () => {
        const previousTitle = meal.title;
        startEdit(titleEl, {
          value: meal.title,
          maxLength: MAX_TITLE_LENGTH,
          onCommit: (value) => {
            if (!value) {
              render();
              return;
            }
            conn.send({ type: "updateMeal", id, title: value });
            if (value !== previousTitle) {
              showUndoToast("Titre modifié.", () => conn.send({ type: "updateMeal", id, title: previousTitle }));
            }
          },
        });
      });
    }

    const sourceEl = card.querySelector<HTMLElement>('[data-action="edit-source"]');
    if (sourceEl) {
      onActivate(sourceEl, () => {
        const previousSource = meal.source;
        startEdit(sourceEl, {
          value: meal.source,
          placeholder: "Lien ou texte libre",
          maxLength: MAX_SOURCE_LENGTH,
          onCommit: (value) => {
            conn.send({ type: "updateMeal", id, source: value });
            if (value !== previousSource) {
              showUndoToast("Source modifiée.", () => conn.send({ type: "updateMeal", id, source: previousSource }));
            }
          },
        });
      });
    }

    card.querySelector<HTMLButtonElement>('[data-action="copy-title"]')?.addEventListener("click", () => {
      copyToClipboard(meal.title, "Titre copié.");
    });

    card.querySelectorAll<HTMLButtonElement>(".preptime-pill").forEach((btn) => {
      btn.addEventListener("click", () => {
        const value = btn.dataset.preptime;
        const prepTime = value ? (value as Meal["prepTime"]) : null;
        if (prepTime === meal.prepTime) return;
        conn.send({ type: "setMealPrepTime", id, prepTime });
      });
    });

    card.querySelector<HTMLInputElement>('[data-action="planned-date"]')?.addEventListener("change", (e) => {
      const value = (e.target as HTMLInputElement).value;
      const plannedDate = value ? fromDateInputValue(value) : null;
      conn.send({ type: "setMealPlannedDate", id, plannedDate });
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

    // Suit la dernière valeur effectivement envoyée plutôt que meal.comment
    // (figé au moment du rendu) : sans ça, plusieurs éditions successives
    // avant qu'un nouvel état ne revienne du serveur proposeraient toutes la
    // même valeur d'origine pour "Annuler", au lieu de celle juste avant
    // chacune d'elles.
    let previousComment = meal.comment;
    card.querySelector<HTMLTextAreaElement>('[data-field="comment"]')?.addEventListener("blur", (e) => {
      const value = (e.target as HTMLTextAreaElement).value;
      conn.send({ type: "updateMeal", id, comment: value });
      if (value !== previousComment) {
        const restored = previousComment;
        showUndoToast("Commentaire modifié.", () => conn.send({ type: "updateMeal", id, comment: restored }));
        previousComment = value;
      }
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

    wireMealImage(card, id, meal);
  }

  /** Ajout (jusqu'à MAX_IMAGES_PER_MEAL, input file ou collage — ex :
   * capture d'écran) et suppression individuelle d'une photo. Pas de mise à
   * jour optimiste : comme pour le reste de l'app, la galerie ne se met à
   * jour qu'au retour de l'état par le serveur (ici via la diffusion
   * websocket déclenchée par l'upload, voir worker/index.ts), l'appel HTTP
   * se contentant de confirmer/rejeter l'envoi lui-même. */
  function wireMealImage(card: HTMLLIElement, id: string, meal: Meal): void {
    // Le champ reste inerte pendant l'envoi (le seul retour serait sinon
    // l'attente réseau elle-même, qui donne l'impression d'un blocage) :
    // boutons désactivés, galerie/bouton d'ajout estompés, indicateur visible.
    function setLoading(loading: boolean): void {
      card.querySelector(".meal-image-field")?.classList.toggle("is-loading", loading);
      card.querySelectorAll<HTMLButtonElement>(".meal-image-field button").forEach((btn) => {
        btn.disabled = loading;
      });
      const loadingEl = card.querySelector<HTMLElement>(".meal-image-loading");
      if (loadingEl) loadingEl.hidden = !loading;
    }

    async function send(file: File | Blob): Promise<void> {
      if (meal.images.length >= MAX_IMAGES_PER_MEAL) {
        showToast(`Maximum ${MAX_IMAGES_PER_MEAL} photos par repas.`);
        return;
      }
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

    card.querySelectorAll<HTMLButtonElement>('[data-action="view-image"]').forEach((btn) => {
      btn.addEventListener("click", () => {
        const images = meal.images.map((imageId) => ({
          url: mealImageUrl(code, id, imageId),
          alt: `Photo de « ${meal.title} »`,
        }));
        const startIndex = meal.images.indexOf(btn.dataset.imageId ?? "");
        openImageLightbox(images, startIndex === -1 ? 0 : startIndex);
      });
    });

    card.querySelectorAll<HTMLButtonElement>('[data-action="remove-image"]').forEach((removeBtn) => {
      wireConfirmClick(removeBtn, {
        armedLabel: "Confirmer la suppression ?",
        onConfirm: () => {
          const imageId = removeBtn.dataset.imageId!;
          setLoading(true);
          deleteMealImage(code, id, imageId)
            .catch((err) => {
              showToast(err instanceof ApiError ? err.message : "Erreur réseau, réessaie.");
            })
            .finally(() => setLoading(false));
        },
      });
    });

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

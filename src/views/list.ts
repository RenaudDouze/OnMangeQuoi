import type { ListState, Meal, MealStatus } from "../../shared/types";
import { MEAL_STATUSES, MEAL_STATUS_LABELS, MEAL_NOTES, MEAL_NOTE_LABELS } from "../../shared/types";
import { ListConnection } from "../lib/ws";
import { fetchListState } from "../lib/http";
import { cacheListState, getCachedListState, touchRecentList } from "../lib/storage";
import { uid } from "../lib/id";
import { escapeHtml } from "../lib/dom";
import { startEdit } from "../lib/editable";
import { wireConfirmClick } from "../lib/confirmClick";
import { icons } from "../lib/icons";

const URL_RE = /^(https?:\/\/|www\.)/i;

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

function noteOptionsHtml(selected: string | null): string {
  const none = `<option value="" ${selected ? "" : "selected"}>Pas encore de note</option>`;
  const options = MEAL_NOTES.map((n) => `<option value="${n}" ${n === selected ? "selected" : ""}>${MEAL_NOTE_LABELS[n]}</option>`).join("");
  return none + options;
}

function formatDate(ts: number): string {
  return new Date(ts).toLocaleDateString("fr-FR", { day: "numeric", month: "short", year: "numeric" });
}

/** Ouvert au moment de passer un repas en "Fait" : c'est le moment naturel
 * pour noter comment c'était, plutôt qu'une étape séparée à ne pas oublier
 * une fois le repas déjà dans l'historique. */
function openMarkDoneModal(meal: Meal, onConfirm: (note: Meal["note"], comment: string) => void): void {
  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  overlay.innerHTML = `
    <div class="modal" role="dialog" aria-modal="true" aria-labelledby="mark-done-title" tabindex="-1">
      <button type="button" class="icon-btn modal-close" aria-label="Fermer">${icons.close}</button>
      <h2 id="mark-done-title">Marquer « ${escapeHtml(meal.title)} » comme fait</h2>
      <p class="modal-hint">Le repas part dans l'historique. C'est le bon moment pour noter comment c'était.</p>
      <label class="modal-field">
        <span>Note</span>
        <select id="mark-done-note">${noteOptionsHtml(meal.note)}</select>
      </label>
      <label class="modal-field">
        <span>Commentaire</span>
        <textarea id="mark-done-comment" rows="3" placeholder="Une note sur ce repas…">${escapeHtml(meal.comment)}</textarea>
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
  overlay.querySelector("#mark-done-confirm")?.addEventListener("click", () => {
    const note = (overlay.querySelector("#mark-done-note") as HTMLSelectElement).value;
    const comment = (overlay.querySelector("#mark-done-comment") as HTMLTextAreaElement).value;
    close();
    onConfirm(note ? (note as Meal["note"]) : null, comment);
  });

  (overlay.querySelector("#mark-done-comment") as HTMLTextAreaElement)?.focus();
}

function mealCardHtml(meal: Meal, archived: boolean): string {
  const statusArea = archived
    ? `<span class="status-badge">Fait le ${formatDate(meal.doneAt ?? meal.updatedAt)}</span>`
    : statusPickerHtml(meal.status);

  const actions = archived
    ? `<button type="button" class="icon-btn" data-action="restore" aria-label="Remettre dans la liste" title="Remettre dans la liste">${icons.undo}</button>
       <button type="button" class="icon-btn danger-hover" data-action="delete-forever" aria-label="Supprimer définitivement">${icons.trash}</button>`
    : `<button type="button" class="icon-btn danger-hover" data-action="delete" aria-label="Supprimer">${icons.trash}</button>`;

  return `
    <li class="meal-card${archived ? " archived" : ""}" data-id="${meal.id}">
      <div class="meal-main">
        <h3 class="meal-title" data-action="edit-title" tabindex="0">${escapeHtml(meal.title)}</h3>
        <div class="meal-controls">
          <select class="meal-note" data-field="note" aria-label="Note">${noteOptionsHtml(meal.note)}</select>
          ${actions}
        </div>
      </div>
      ${statusArea}
      <div class="meal-details">
        <div class="meal-field">
          <span class="meal-field-label">Source</span>
          <div class="meal-source" data-action="edit-source" tabindex="0">${sourceHtml(meal.source)}</div>
        </div>
        <div class="meal-field">
          <span class="meal-field-label">Commentaire</span>
          <textarea class="meal-comment" data-field="comment" placeholder="Une note sur ce repas…" rows="2">${escapeHtml(meal.comment)}</textarea>
        </div>
      </div>
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
        <button type="button" class="icon-btn" id="btn-share" aria-label="Partager">${icons.share}</button>
      </header>
      <div class="share-panel" id="share-panel" hidden>
        <p>Code : <strong id="share-code">${state.code}</strong></p>
        <button type="button" class="btn" id="copy-code">Copier le code</button>
        <button type="button" class="btn" id="copy-link">Copier le lien</button>
      </div>

      <nav class="tabs" id="tabs">
        <button type="button" class="tab-btn" data-tab="active" aria-pressed="true">Repas</button>
        <button type="button" class="tab-btn" data-tab="archive" aria-pressed="false">${icons.history} Historique</button>
      </nav>

      <section class="card add-meal-card" id="add-meal-card">
        <form id="add-form" class="row">
          <input id="add-title" type="text" placeholder="Nom du repas" maxlength="120" autocomplete="off" />
          <button type="submit" class="btn primary">${icons.plus} Ajouter</button>
        </form>
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
      wireTabs();
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
      if (state) copyToClipboard(`${location.origin}/l/${state.code}`, "Lien copié.");
    });

    const titleEl = root.querySelector("#list-title") as HTMLElement | null;
    titleEl?.addEventListener("click", () => {
      if (!state) return;
      startEdit(titleEl, {
        value: state.name,
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
        renderMeals();
      });
    });
  }

  function wireAddForm(): void {
    root.querySelector("#add-form")?.addEventListener("submit", (e) => {
      e.preventDefault();
      const input = root.querySelector("#add-title") as HTMLInputElement;
      const title = input.value.trim();
      if (!title) return;
      conn.send({ type: "addMeal", id: uid(), title });
      input.value = "";
      input.focus();
    });
  }

  function copyToClipboard(text: string, message: string): void {
    navigator.clipboard?.writeText(text).then(
      () => showToast(message),
      () => showToast("Impossible de copier."),
    );
  }

  function renderMeals(): void {
    if (!state) return;
    const listEl = root.querySelector("#meal-list") as HTMLElement | null;
    const emptyEl = root.querySelector("#empty-message") as HTMLElement | null;
    if (!listEl || !emptyEl) return;

    const meals = tab === "active" ? [...state.meals].sort((a, b) => a.order - b.order) : state.archive;

    if (meals.length === 0) {
      listEl.innerHTML = "";
      emptyEl.hidden = false;
      emptyEl.textContent =
        tab === "active" ? "Aucun repas pour l'instant. Ajoute une idée ci-dessus !" : "Aucun repas dans l'historique pour le moment.";
    } else {
      emptyEl.hidden = true;
      listEl.innerHTML = meals.map((m) => mealCardHtml(m, tab === "archive")).join("");
    }
    wireMealCards();
  }

  function wireMealCards(): void {
    const listEl = root.querySelector("#meal-list") as HTMLElement | null;
    if (!listEl || !state) return;

    listEl.querySelectorAll<HTMLLIElement>(".meal-card").forEach((card) => {
      const id = card.dataset.id!;
      const meal = (tab === "active" ? state!.meals : state!.archive).find((m) => m.id === id);
      if (!meal) return;

      const titleEl = card.querySelector<HTMLElement>('[data-action="edit-title"]');
      titleEl?.addEventListener("click", () => {
        startEdit(titleEl, {
          value: meal.title,
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
          onCommit: (value) => conn.send({ type: "updateMeal", id, source: value }),
        });
      });

      card.querySelectorAll<HTMLButtonElement>(".status-pill").forEach((btn) => {
        btn.addEventListener("click", () => {
          const status = btn.dataset.status as MealStatus;
          if (status === meal.status) return;
          if (status === "fait") {
            openMarkDoneModal(meal, (note, comment) => {
              conn.send({ type: "updateMeal", id, comment });
              conn.send({ type: "setMealNote", id, note });
              conn.send({ type: "setMealStatus", id, status: "fait" });
              showUndoToast("Repas déplacé vers l'historique.", () => conn.send({ type: "restoreMeal", id }));
            });
            return;
          }
          conn.send({ type: "setMealStatus", id, status });
        });
      });

      card.querySelector<HTMLSelectElement>('[data-field="note"]')?.addEventListener("change", (e) => {
        const value = (e.target as HTMLSelectElement).value;
        conn.send({ type: "setMealNote", id, note: value ? (value as Meal["note"]) : null });
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

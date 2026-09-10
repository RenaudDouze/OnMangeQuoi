import { createList, fetchListState, ApiError } from "../lib/http";
import { getRecentLists, forgetRecentList, touchRecentList } from "../lib/storage";
import { escapeHtml } from "../lib/dom";
import { icons } from "../lib/icons";
import { cycleThemePreference, getThemePreference, themeLabel, type ThemePreference } from "../lib/theme";
import { MAX_LIST_NAME_LENGTH } from "../../shared/types";

const THEME_ICON: Record<ThemePreference, string> = { system: icons.themeAuto, light: icons.sun, dark: icons.moon };

export function mountHomeView(root: HTMLElement, navigate: (path: string) => void): () => void {
  render();

  function recentItemHtml(r: { code: string; name: string }): string {
    return `
      <li class="recent-item">
        <button type="button" class="recent-open" data-code="${r.code}">
          <span class="recent-name">${escapeHtml(r.name)}</span>
          <span class="recent-code">${r.code}</span>
        </button>
        <button type="button" class="icon-btn recent-forget" data-code="${r.code}" aria-label="Oublier cette liste">${icons.close}</button>
      </li>`;
  }

  function render(): void {
    const recents = getRecentLists();
    const theme = getThemePreference();
    root.innerHTML = `
      <div class="home">
        <button type="button" class="icon-btn theme-toggle" id="theme-toggle" aria-label="Thème : ${themeLabel(theme)}" title="Thème : ${themeLabel(theme)}">
          ${THEME_ICON[theme]}
        </button>
        <header class="home-header">
          <div class="logo">${icons.bowl}</div>
          <h1>OnMangeQuoi</h1>
          <p class="tagline">La liste de repas partagée, synchronisée en direct.</p>
          <p class="tagline privacy-note">
            Les données ne sont ni chiffrées ni protégées : n'y mets rien de privé ou
            de sensible.
          </p>
        </header>

        ${
          recents.length
            ? `<section class="card">
                <h2>Listes récentes</h2>
                <ul class="recent-list">${recents.map(recentItemHtml).join("")}</ul>
              </section>`
            : ""
        }

        <section class="card">
          <h2>Nouvelle liste de repas</h2>
          <form id="create-form" class="row">
            <input id="create-name" type="text" placeholder="Nom de la liste (optionnel)" maxlength="${MAX_LIST_NAME_LENGTH}" />
            <button type="submit" class="btn primary">Créer</button>
          </form>
          <p class="add-form-hint">Les données ne sont ni chiffrées ni protégées : n'y mets rien de privé ou de sensible.</p>
        </section>

        <section class="card">
          <h2>Rejoindre une liste</h2>
          <form id="join-form" class="row">
            <input id="join-code" type="text" placeholder="Code à 6 caractères" maxlength="10" autocapitalize="characters" />
            <button type="submit" class="btn">Rejoindre</button>
          </form>
          <p id="join-error" class="error" hidden></p>
        </section>
      </div>
    `;

    root.querySelector("#theme-toggle")?.addEventListener("click", () => {
      cycleThemePreference();
      render();
    });

    root.querySelector("#create-form")?.addEventListener("submit", async (e) => {
      e.preventDefault();
      const form = e.target as HTMLFormElement;
      const nameInput = root.querySelector("#create-name") as HTMLInputElement;
      const btn = form.querySelector("button") as HTMLButtonElement;
      btn.disabled = true;
      try {
        const state = await createList(nameInput.value.trim() || "On mange quoi ?");
        touchRecentList(state.code, state.name);
        navigate(`/l/${state.code}`);
      } catch (err) {
        alert(err instanceof ApiError ? err.message : "Impossible de créer la liste. Vérifie ta connexion internet.");
        btn.disabled = false;
      }
    });

    root.querySelector("#join-form")?.addEventListener("submit", async (e) => {
      e.preventDefault();
      const form = e.target as HTMLFormElement;
      const input = root.querySelector("#join-code") as HTMLInputElement;
      const errorEl = root.querySelector("#join-error") as HTMLElement;
      const btn = form.querySelector("button") as HTMLButtonElement;
      const code = input.value.trim().toUpperCase();
      errorEl.hidden = true;
      if (!code) return;
      btn.disabled = true;
      try {
        const state = await fetchListState(code);
        if (!state) {
          errorEl.textContent = "Aucune liste ne correspond à ce code.";
          errorEl.hidden = false;
        } else {
          touchRecentList(state.code, state.name);
          navigate(`/l/${state.code}`);
        }
      } catch {
        errorEl.textContent = "Erreur réseau, réessaie.";
        errorEl.hidden = false;
      } finally {
        btn.disabled = false;
      }
    });

    root.querySelectorAll<HTMLButtonElement>(".recent-open").forEach((btn) => {
      btn.addEventListener("click", () => navigate(`/l/${btn.dataset.code}`));
    });
    root.querySelectorAll<HTMLButtonElement>(".recent-forget").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        if (btn.dataset.code) forgetRecentList(btn.dataset.code);
        render();
      });
    });
  }

  return () => {};
}

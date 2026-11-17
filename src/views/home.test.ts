// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mountHomeView } from "./home";
import { encodeSnapshotToParam } from "../lib/compactShare";
import type { ListState } from "../../shared/types";

const { FakeApiError } = vi.hoisted(() => ({ FakeApiError: class extends Error {} }));
const createList = vi.fn();
const fetchListState = vi.fn();
vi.mock("../lib/http", () => ({
  createList: (...a: unknown[]) => createList(...a),
  fetchListState: (...a: unknown[]) => fetchListState(...a),
  ApiError: FakeApiError,
}));

let recents: { code: string; name: string; lastOpened: number }[] = [];
const forgetRecentList = vi.fn();
const touchRecentList = vi.fn();
vi.mock("../lib/storage", () => ({
  getRecentLists: () => recents,
  forgetRecentList: (...a: unknown[]) => forgetRecentList(...a),
  touchRecentList: (...a: unknown[]) => touchRecentList(...a),
}));

function sampleState(overrides: Partial<ListState> = {}): ListState {
  return { code: "ABCDEF", name: "Semaine", meals: [], archive: [], createdAt: 0, updatedAt: 0, ...overrides };
}

const stray = (selector: string) =>
  Array.from(document.querySelectorAll(selector)).flatMap((el) =>
    Array.from(el.childNodes)
      .filter((n) => n.nodeType === Node.TEXT_NODE && n.textContent!.trim() !== "")
      .map((n) => n.textContent),
  );

describe("mountHomeView", () => {
  let root: HTMLElement;
  let navigate: ReturnType<typeof vi.fn<(path: string) => void>>;
  const submit = (form: Element) => {
    const event = new Event("submit", { bubbles: true, cancelable: true });
    form.dispatchEvent(event);
    return event;
  };
  const deferred = <T,>() => {
    let resolve!: (v: T) => void;
    let reject!: (e: unknown) => void;
    const promise = new Promise<T>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    return { promise, resolve, reject };
  };
  const rec = (code: string, name = `Liste ${code}`) => ({ code, name, lastOpened: 1 });
  const mount = () => mountHomeView(root, navigate);

  beforeEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute("data-theme");
    document.documentElement.removeAttribute("data-a11y");
    document.body.innerHTML = "";
    root = document.createElement("div");
    document.body.appendChild(root);
    history.replaceState({}, "", "/");
    recents = [];
    for (const fn of [createList, fetchListState, forgetRecentList, touchRecentList]) fn.mockReset();
    navigate = vi.fn<(path: string) => void>();
    vi.stubGlobal("alert", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    history.replaceState({}, "", "/");
  });

  it("affiche la version du projet en pied d'accueil (VER-09)", () => {
    mountHomeView(root, navigate);
    expect(root.querySelector(".app-version")?.textContent).toBe("Version 9.9.9-test");
  });

  it("le nettoyage renvoyé est sans effet", () => {
    const stop = mount();
    expect(() => stop()).not.toThrow();
    expect(root.querySelector("h1")).not.toBeNull();
  });

  it("affiche l'accueil sans liste récente, avec l'avertissement de confidentialité, sans texte parasite", () => {
    mount();
    expect(root.querySelector("h1")!.textContent).toBe("OnMangeQuoi");
    expect(Array.from(root.querySelectorAll("h2")).map((h) => h.textContent)).toEqual(["Nouvelle liste de repas", "Rejoindre une liste"]);
    expect(root.querySelector(".privacy-note")!.textContent!.replace(/\s+/g, " ").trim()).toBe("Les données ne sont ni chiffrées ni protégées : n'y mets rien de privé ou de sensible.");
    expect(root.querySelector(".add-form-hint")!.textContent).toBe("Les données ne sont ni chiffrées ni protégées : n'y mets rien de privé ou de sensible.");
    expect(stray(".home, .card, .home-header")).toEqual([]);
  });

  describe("listes récentes", () => {
    it("affichées avec nom et code, échappés", () => {
      recents = [rec("AAAAAA", "<b>x</b>"), rec("BBBBBB", "Deux")];
      mount();
      const names = Array.from(root.querySelectorAll(".recent-name")).map((n) => n.textContent);
      expect(names).toEqual(["<b>x</b>", "Deux"]);
      expect(root.querySelector(".recent-name b")).toBeNull();
      expect(Array.from(root.querySelectorAll(".recent-code")).map((n) => n.textContent)).toEqual(["AAAAAA", "BBBBBB"]);
      expect(root.querySelector("section.card h2")!.textContent).toBe("Listes récentes");
      expect(stray(".recent-list")).toEqual([]);
    });

    it("cliquer une liste navigue vers son code ; oublier la retire et redessine", () => {
      recents = [rec("AAAAAA"), rec("BBBBBB")];
      mount();
      (root.querySelectorAll(".recent-open")[1] as HTMLElement).click();
      expect(navigate).toHaveBeenCalledWith("/l/BBBBBB");

      root.querySelector(".home")!.setAttribute("data-marker", "1");
      const forget = root.querySelectorAll(".recent-forget")[0] as HTMLElement;
      expect(forget.getAttribute("aria-label")).toBe("Oublier cette liste");
      forget.click();
      expect(forgetRecentList).toHaveBeenCalledWith("AAAAAA");
      expect(root.querySelector(".home")!.hasAttribute("data-marker")).toBe(false);
      expect(navigate).toHaveBeenCalledTimes(1);
    });
  });

  describe("thème et accessibilité", () => {
    it("le bouton de thème affiche l'icône du thème courant et cycle", () => {
      const labels: string[] = [];
      for (const [theme, label] of [["system", "Auto"], ["light", "Clair"], ["dark", "Sombre"]] as const) {
        localStorage.setItem("omq:theme", theme);
        mount();
        const btn = root.querySelector("#theme-toggle")!;
        expect(btn.getAttribute("aria-label")).toBe(`Thème : ${label}`);
        expect(btn.getAttribute("title")).toBe(`Thème : ${label}`);
        expect(btn.querySelector("svg")).not.toBeNull();
        labels.push(btn.innerHTML.replace(/\s+/g, " "));
      }
      expect(new Set(labels).size).toBe(3);
      localStorage.setItem("omq:theme", "system");
      mount();
      (root.querySelector("#theme-toggle") as HTMLElement).click();
      expect(root.querySelector("#theme-toggle")!.getAttribute("aria-label")).toBe("Thème : Clair");
    });

    it("le mode accessibilité : état affiché, bascule, persistance et application", () => {
      mount();
      const btn = () => root.querySelector("#a11y-toggle") as HTMLElement;
      expect(btn().getAttribute("aria-pressed")).toBe("false");
      expect(btn().getAttribute("aria-label")).toBe("Mode accessibilité : désactivé");
      btn().click();
      expect(btn().getAttribute("aria-pressed")).toBe("true");
      expect(btn().getAttribute("aria-label")).toBe("Mode accessibilité : activé");
      expect(localStorage.getItem("omq:a11y")).toBe("true");
      expect(document.documentElement.hasAttribute("data-a11y")).toBe(true);
      btn().click();
      expect(btn().getAttribute("aria-pressed")).toBe("false");
      expect(document.documentElement.hasAttribute("data-a11y")).toBe(false);
    });
  });

  describe("créer une liste", () => {
    const setup = () => {
      mount();
      return {
        form: root.querySelector("#create-form")!,
        input: root.querySelector("#create-name") as HTMLInputElement,
        btn: root.querySelector("#create-form button") as HTMLButtonElement,
      };
    };

    it("limite la longueur du nom, bloque l'envoi natif, désactive le bouton, recadre, mémorise puis navigue", async () => {
      const call = deferred<ListState>();
      createList.mockReturnValue(call.promise);
      const { form, input, btn } = setup();
      expect(input.maxLength).toBe(60);
      input.value = "  Ma semaine  ";
      const event = submit(form);
      expect(event.defaultPrevented).toBe(true);
      expect(btn.disabled).toBe(true);
      expect(createList).toHaveBeenCalledWith("Ma semaine");

      call.resolve(sampleState({ code: "NEWCOD", name: "Ma semaine" }));
      await vi.waitFor(() => expect(navigate).toHaveBeenCalledWith("/l/NEWCOD"));
      expect(touchRecentList).toHaveBeenCalledWith("NEWCOD", "Ma semaine");
    });

    it("sans nom : nom par défaut", async () => {
      createList.mockResolvedValue(sampleState());
      const { form } = setup();
      submit(form);
      await vi.waitFor(() => expect(createList).toHaveBeenCalledWith("On mange quoi ?"));
    });

    it("échec réseau : alerte générique ; erreur de l'API : son message ; bouton réactivé", async () => {
      createList.mockRejectedValue(new Error("réseau"));
      const { form, btn } = setup();
      submit(form);
      await vi.waitFor(() => expect(alert).toHaveBeenCalledWith("Impossible de créer la liste. Vérifie ta connexion internet."));
      expect(btn.disabled).toBe(false);

      createList.mockRejectedValue(new FakeApiError("Trop de listes"));
      submit(form);
      await vi.waitFor(() => expect(alert).toHaveBeenCalledWith("Trop de listes"));
      expect(navigate).not.toHaveBeenCalled();
    });
  });

  describe("rejoindre une liste", () => {
    const setup = () => {
      mount();
      return {
        form: root.querySelector("#join-form")!,
        input: root.querySelector("#join-code") as HTMLInputElement,
        error: root.querySelector("#join-error") as HTMLElement,
        btn: root.querySelector("#join-form button") as HTMLButtonElement,
      };
    };

    it("bloque l'envoi natif ; un code vide ne fait rien et masque l'erreur précédente", () => {
      const { form, input, error } = setup();
      error.hidden = false;
      input.value = "   ";
      expect(submit(form).defaultPrevented).toBe(true);
      expect(error.hidden).toBe(true);
      expect(fetchListState).not.toHaveBeenCalled();
    });

    it("recadre et met en majuscules, désactive le bouton pendant l'appel, mémorise puis navigue", async () => {
      const call = deferred<ListState | null>();
      fetchListState.mockReturnValue(call.promise);
      const { form, input, btn } = setup();
      input.value = "  abc123 ";
      submit(form);
      expect(fetchListState).toHaveBeenCalledWith("ABC123");
      expect(btn.disabled).toBe(true);
      call.resolve(sampleState({ code: "ABC123", name: "Vue" }));
      await vi.waitFor(() => expect(navigate).toHaveBeenCalledWith("/l/ABC123"));
      expect(touchRecentList).toHaveBeenCalledWith("ABC123", "Vue");
      expect(btn.disabled).toBe(false);
    });

    it("code inconnu : message exact", async () => {
      fetchListState.mockResolvedValue(null);
      const { form, input, error } = setup();
      input.value = "zzz";
      submit(form);
      await vi.waitFor(() => expect(error.hidden).toBe(false));
      expect(error.textContent).toBe("Aucune liste ne correspond à ce code.");
    });

    it("erreur réseau : message dédié ; erreur de l'API : son message ; bouton réactivé", async () => {
      fetchListState.mockRejectedValue(new Error("réseau"));
      const { form, input, error, btn } = setup();
      input.value = "abc";
      submit(form);
      await vi.waitFor(() => expect(error.textContent).toBe("Erreur réseau, réessaie."));
      expect(btn.disabled).toBe(false);

      fetchListState.mockRejectedValue(new FakeApiError("Doucement"));
      submit(form);
      await vi.waitFor(() => expect(error.textContent).toBe("Doucement"));
      expect(error.hidden).toBe(false);
    });
  });

  describe("aperçu de liste partagé (?import=)", () => {
    const snapshot = { name: "  Semaine type ", meals: [{ id: "", title: "Pâtes", status: "idee", note: null, source: "", comment: "", order: 0, createdAt: 1, updatedAt: 1, doneAt: null, images: [], prepTime: null, plannedDate: null, later: false }], archive: [] };
    const withParam = (param: string) => history.replaceState({}, "", `/?import=${param}`);

    it("sans paramètre : aucune section d'aperçu", () => {
      mount();
      expect(root.querySelector("#import-snapshot-create")).toBeNull();
      expect(root.textContent).not.toContain("invalide");
    });

    it("avec un lien valide : résumé (nom échappé, compteurs) et bouton de création", () => {
      withParam(encodeSnapshotToParam(snapshot as never));
      mount();
      const card = root.querySelector("section.card")!;
      expect(card.querySelector("h2")!.textContent).toBe("Aperçu de liste partagé");
      expect(card.querySelector("p")!.textContent).toBe("  Semaine type  — 1 repas actif(s), 0 dans l'historique.");
      expect(root.querySelector("#import-snapshot-create")!.textContent).toBe("Créer une nouvelle liste avec cet aperçu");
    });

    it("un aperçu sans nom s'affiche « Sans nom »", () => {
      withParam(encodeSnapshotToParam({ ...snapshot, name: "" } as never));
      mount();
      expect(root.querySelector("section.card p")!.textContent).toContain("Sans nom — ");
    });

    it("un lien invalide affiche un message d'erreur, sans bouton", () => {
      withParam("corrompu");
      mount();
      expect(root.querySelector(".card .error")!.textContent).toBe("Le lien de partage figé est invalide ou corrompu.");
      expect(root.querySelector("#import-snapshot-create")).toBeNull();
    });

    it("créer : bouton désactivé pendant l'appel, nom recadré, mémorise puis navigue avec le paramètre encodé", async () => {
      const param = encodeSnapshotToParam(snapshot as never);
      withParam(param);
      const call = deferred<ListState>();
      createList.mockReturnValue(call.promise);
      mount();
      const btn = root.querySelector("#import-snapshot-create") as HTMLButtonElement;
      btn.click();
      expect(btn.disabled).toBe(true);
      expect(createList).toHaveBeenCalledWith("Semaine type");
      call.resolve(sampleState({ code: "NEWCOD", name: "Semaine type" }));
      await vi.waitFor(() => expect(navigate).toHaveBeenCalledWith(`/l/NEWCOD?import=${encodeURIComponent(param)}`));
      expect(touchRecentList).toHaveBeenCalledWith("NEWCOD", "Semaine type");
    });

    it("un aperçu sans nom crée la liste avec le nom par défaut", async () => {
      withParam(encodeSnapshotToParam({ ...snapshot, name: "" } as never));
      createList.mockResolvedValue(sampleState());
      mount();
      (root.querySelector("#import-snapshot-create") as HTMLElement).click();
      await vi.waitFor(() => expect(createList).toHaveBeenCalledWith("On mange quoi ?"));
    });

    it("échec : alerte (message de l'API ou générique), bouton réactivé", async () => {
      withParam(encodeSnapshotToParam(snapshot as never));
      createList.mockRejectedValue(new Error("réseau"));
      mount();
      const btn = root.querySelector("#import-snapshot-create") as HTMLButtonElement;
      btn.click();
      await vi.waitFor(() => expect(alert).toHaveBeenCalledWith("Impossible de créer la liste. Vérifie ta connexion internet."));
      expect(btn.disabled).toBe(false);
      createList.mockRejectedValue(new FakeApiError("Trop de listes"));
      btn.click();
      await vi.waitFor(() => expect(alert).toHaveBeenCalledWith("Trop de listes"));
      expect(navigate).not.toHaveBeenCalled();
    });
  });
});

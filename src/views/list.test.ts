// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mountListView } from "./list";
import { cacheListState, getCachedListState, getRecentLists } from "../lib/storage";
import { encodeSnapshotToParam } from "../lib/compactShare";
import { MAX_IMAGES_PER_MEAL } from "../../shared/types";
import type { ClientMessage, ListState, Meal } from "../../shared/types";

type Listener<T> = (arg: T) => void;
const { FakeListConnection, fakeConnectionInstances, FakeApiError } = vi.hoisted(() => {
  const instances: unknown[] = [];
  class Impl {
    send = vi.fn();
    connect = vi.fn();
    disconnect = vi.fn();
    private l: Record<string, Listener<unknown>[]> = { state: [], error: [], conn: [] };
    constructor(public code: string) {
      instances.push(this);
    }
    onState(fn: Listener<unknown>) {
      this.l.state.push(fn);
      return () => {};
    }
    onError(fn: Listener<unknown>) {
      this.l.error.push(fn);
      return () => {};
    }
    onConnectionChange(fn: Listener<unknown>) {
      this.l.conn.push(fn);
      return () => {};
    }
    emit(kind: string, value: unknown) {
      for (const fn of [...this.l[kind]]) fn(value);
    }
  }
  return { FakeListConnection: Impl, fakeConnectionInstances: instances, FakeApiError: class extends Error {} };
});
type FakeConn = InstanceType<typeof FakeListConnection> & {
  send: ReturnType<typeof vi.fn<(msg: ClientMessage) => void>>;
  connect: ReturnType<typeof vi.fn>;
  disconnect: ReturnType<typeof vi.fn>;
};
vi.mock("../lib/ws", () => ({ ListConnection: FakeListConnection }));

const fetchListState = vi.fn();
const uploadMealImage = vi.fn();
const deleteMealImage = vi.fn();
vi.mock("../lib/http", () => ({
  ApiError: FakeApiError,
  fetchListState: (...a: unknown[]) => fetchListState(...a),
  uploadMealImage: (...a: unknown[]) => uploadMealImage(...a),
  deleteMealImage: (...a: unknown[]) => deleteMealImage(...a),
  mealImageUrl: (code: string, mealId: string, imageId: string) => `/img/${code}/${mealId}/${imageId}`,
}));

const exportListState = vi.fn();
const parseImportFile = vi.fn();
vi.mock("../lib/importExport", () => ({
  exportListState: (...a: unknown[]) => exportListState(...a),
  parseImportFile: (...a: unknown[]) => parseImportFile(...a),
}));

const renderQrSvg = vi.fn();
vi.mock("../lib/qr", () => ({ renderQrSvg: (...a: unknown[]) => renderQrSvg(...a) }));

interface SortableCall {
  el: HTMLElement;
  opts: { handle: string; draggable: string; animation: number; disabled: boolean; forceFallback: boolean; onStart: () => void; onEnd: (e: { item: HTMLElement }) => void };
  option: ReturnType<typeof vi.fn>;
}
const { sortableCalls } = vi.hoisted(() => ({ sortableCalls: [] as unknown[] }));
vi.mock("sortablejs", () => ({
  default: class {
    option = vi.fn();
    constructor(el: HTMLElement, opts: unknown) {
      sortableCalls.push({ el, opts, option: this.option });
    }
  },
}));
const sortable = () => sortableCalls[sortableCalls.length - 1] as SortableCall;

interface StartEditCall {
  el: HTMLElement;
  opts: { value: string; placeholder?: string; maxLength?: number; onCommit: (value: string) => void };
}
const startEditCalls: StartEditCall[] = [];
vi.mock("../lib/editable", () => ({
  startEdit: (el: HTMLElement, opts: StartEditCall["opts"]) => startEditCalls.push({ el, opts }),
}));
const findEdit = (el: Element) => [...startEditCalls].reverse().find((c) => c.el === el)!;

interface ConfirmCall {
  button: HTMLElement;
  opts: { armedLabel: string; onConfirm: () => void };
}
const confirmCalls: ConfirmCall[] = [];
vi.mock("../lib/confirmClick", () => ({
  wireConfirmClick: (button: HTMLElement, opts: ConfirmCall["opts"]) => confirmCalls.push({ button, opts }),
}));

function makeMeal(overrides: Partial<Meal> = {}): Meal {
  return {
    id: "m1",
    title: "Pâtes",
    status: "idee",
    note: null,
    source: "",
    comment: "",
    order: 0,
    createdAt: 1,
    updatedAt: 1,
    doneAt: null,
    images: [],
    prepTime: null,
    plannedDate: null,
    later: false,
    ...overrides,
  };
}
function sampleState(overrides: Partial<ListState> = {}): ListState {
  return { code: "ABCDEF", name: "Semaine", meals: [], archive: [], createdAt: 0, updatedAt: 0, ...overrides };
}
const archived = (overrides: Partial<Meal> = {}) => makeMeal({ status: "fait", doneAt: 1_700_000_000_000, ...overrides });

describe("mountListView", () => {
  let root: HTMLElement;
  let navigate: ReturnType<typeof vi.fn<(path: string) => void>>;
  let cleanup: (() => void) | undefined;

  beforeEach(() => {
    vi.useFakeTimers();
    localStorage.clear();
    document.body.innerHTML = "";
    document.documentElement.removeAttribute("data-a11y");
    root = document.createElement("div");
    document.body.appendChild(root);
    navigate = vi.fn<(path: string) => void>();
    fakeConnectionInstances.length = 0;
    sortableCalls.length = 0;
    startEditCalls.length = 0;
    confirmCalls.length = 0;
    fetchListState.mockReset().mockResolvedValue(sampleState());
    uploadMealImage.mockReset().mockResolvedValue(undefined);
    deleteMealImage.mockReset().mockResolvedValue(undefined);
    exportListState.mockReset();
    parseImportFile.mockReset();
    renderQrSvg.mockReset().mockResolvedValue("<svg></svg>");
    vi.stubGlobal("matchMedia", vi.fn().mockReturnValue({ matches: false }));
    history.replaceState({}, "", "/l/ABCDEF");
    cleanup = undefined;
  });

  afterEach(() => {
    cleanup?.();
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  const conn = () => fakeConnectionInstances[fakeConnectionInstances.length - 1] as FakeConn;
  const $ = <T extends HTMLElement>(sel: string) => root.querySelector(sel) as T;

  async function mount(state: ListState | null = sampleState()): Promise<FakeConn> {
    fetchListState.mockResolvedValue(state);
    cleanup = mountListView(root, "ABCDEF", navigate);
    await vi.waitFor(() => expect(fetchListState).toHaveBeenCalled());
    await vi.advanceTimersByTimeAsync(0);
    return conn();
  }
  const emitState = (c: FakeConn, s: ListState) => c.emit("state", s);
  const titles = () => Array.from(root.querySelectorAll(".meal-card .meal-title")).map((n) => n.textContent);
  const card = (id: string) => root.querySelector(`.meal-card[data-id="${id}"]`) as HTMLElement;
  const expand = (id: string) => (card(id).querySelector('[data-action="toggle"]') as HTMLElement).click();
  const toastText = () => document.querySelector("#list-toast span")?.textContent;
  const stray = (selector: string) =>
    Array.from(document.querySelectorAll(selector)).flatMap((el) =>
      Array.from(el.childNodes)
        .filter((n) => n.nodeType === Node.TEXT_NODE && n.textContent!.trim() !== "")
        .map((n) => n.textContent),
    );
  const keydown = (key: string) => document.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
  const openMenu = () => $("#menu-toggle-btn").click();

  describe("chargement", () => {
    it("avant la réponse : « Chargement… » et pas encore de connexion", () => {
      fetchListState.mockReturnValue(new Promise(() => {}));
      cleanup = mountListView(root, "ABCDEF", navigate);
      expect(root.textContent).toContain("Chargement…");
      expect(root.querySelector("#list-title")).toBeNull();
      expect(conn().connect).not.toHaveBeenCalled();
    });

    it("liste récupérée : titre, connexion ouverte, cache et listes récentes à jour", async () => {
      const c = await mount(sampleState({ name: "Ma semaine" }));
      expect($("#list-title").textContent).toBe("Ma semaine");
      expect(c.connect).toHaveBeenCalledOnce();
      expect(c.code).toBe("ABCDEF");
      expect(getCachedListState("ABCDEF")?.name).toBe("Ma semaine");
      expect(getRecentLists().find((r) => r.code === "ABCDEF")?.name).toBe("Ma semaine");
    });

    it("affiche tout de suite une liste en cache, que la réponse serveur remplace ensuite", async () => {
      cacheListState(sampleState({ name: "Cache" }));
      fetchListState.mockResolvedValue(sampleState({ name: "Fraîche" }));
      cleanup = mountListView(root, "ABCDEF", navigate);
      expect($("#list-title").textContent).toBe("Cache");
      expect(root.textContent).not.toContain("Chargement");
      await vi.advanceTimersByTimeAsync(0);
      expect($("#list-title").textContent).toBe("Fraîche");
    });

    it("liste introuvable : message avec le code échappé, retour accueil, pas de connexion", async () => {
      fetchListState.mockResolvedValue(null);
      cleanup = mountListView(root, "<i>", navigate);
      await vi.advanceTimersByTimeAsync(0);
      expect(root.textContent).toContain("Aucune liste ne correspond au code");
      expect(root.querySelector("strong")!.textContent).toBe("<i>");
      expect(root.querySelector("strong i")).toBeNull();
      $("#btn-home").click();
      expect(navigate).toHaveBeenCalledWith("/");
      expect(conn().connect).not.toHaveBeenCalled();
    });

    it("404 mais cache présent : la liste en cache reste affichée", async () => {
      cacheListState(sampleState({ name: "Cache" }));
      fetchListState.mockResolvedValue(null);
      cleanup = mountListView(root, "ABCDEF", navigate);
      await vi.advanceTimersByTimeAsync(0);
      expect($("#list-title").textContent).toBe("Cache");
      expect(conn().connect).toHaveBeenCalledOnce();
    });

    it("erreur réseau sans cache : message et bouton réessayer ; la connexion est tentée", async () => {
      fetchListState.mockRejectedValue(new Error("réseau"));
      cleanup = mountListView(root, "ABCDEF", navigate);
      await vi.advanceTimersByTimeAsync(0);
      expect(root.textContent).toContain("Impossible de charger la liste. Vérifie ta connexion.");
      const reload = vi.fn();
      vi.stubGlobal("location", { ...location, reload });
      $("#retry").click();
      expect(reload).toHaveBeenCalledOnce();
      expect(conn().connect).toHaveBeenCalledOnce();
    });

    it("erreur réseau avec cache : la liste reste affichée sans message d'erreur", async () => {
      cacheListState(sampleState({ name: "Cache" }));
      fetchListState.mockRejectedValue(new Error("réseau"));
      cleanup = mountListView(root, "ABCDEF", navigate);
      await vi.advanceTimersByTimeAsync(0);
      expect($("#list-title").textContent).toBe("Cache");
      expect(root.textContent).not.toContain("Impossible de charger");
    });
  });

  describe("synchronisation en direct", () => {
    it("un état reçu redessine, met en cache et dans les récentes", async () => {
      const c = await mount();
      emitState(c, sampleState({ name: "Diffusée", meals: [makeMeal({ title: "Riz" })] }));
      expect($("#list-title").textContent).toBe("Diffusée");
      expect(titles()).toEqual(["Riz"]);
      expect(getCachedListState("ABCDEF")?.name).toBe("Diffusée");
      expect(getRecentLists()[0].name).toBe("Diffusée");
    });

    it("un état reçu sort de l'écran « introuvable »", async () => {
      fetchListState.mockResolvedValue(null);
      cleanup = mountListView(root, "ABCDEF", navigate);
      await vi.advanceTimersByTimeAsync(0);
      emitState(conn(), sampleState({ name: "Apparue" }));
      expect($("#list-title").textContent).toBe("Apparue");
    });

    it("point de connexion : titre et classe suivent la connexion", async () => {
      const c = await mount();
      expect($("#conn-dot").className).toBe("conn-dot");
      expect($("#conn-dot").getAttribute("title")).toBe("Connexion…");
      c.emit("conn", true);
      expect($("#conn-dot").classList.contains("online")).toBe(true);
      expect($("#conn-dot").getAttribute("title")).toBe("Synchronisé");
      c.emit("conn", false);
      expect($("#conn-dot").classList.contains("online")).toBe(false);
      expect($("#conn-dot").getAttribute("title")).toBe("Connexion…");
    });


    it("ignore un évènement de connexion après le remplacement de la vue", async () => {
      const c = await mount();
      root.innerHTML = "<div>autre</div>";
      expect(() => c.emit("conn", true)).not.toThrow();
    });

    it("une erreur du serveur s'affiche en toast", async () => {
      const c = await mount();
      c.emit("error", "Boom");
      expect(toastText()).toBe("Boom");
    });

    it("un titre en cours d'édition n'est pas écrasé par une mise à jour", async () => {
      const c = await mount();
      const input = document.createElement("input");
      $("#list-title").replaceChildren(input);
      emitState(c, sampleState({ name: "Autre" }));
      expect($("#list-title").querySelector("input")).toBe(input);
    });
  });

  describe("en-tête, menu et partage", () => {
    it("le retour accueil navigue vers /", async () => {
      await mount();
      $("#btn-home").click();
      expect(navigate).toHaveBeenCalledWith("/");
    });

    it("renommer : propose le nom actuel, envoie et permet d'annuler ; vide ou inchangé", async () => {
      const c = await mount(sampleState({ name: "Semaine" }));
      const title = $("#list-title");
      title.click();
      expect(findEdit(title).opts.value).toBe("Semaine");
      expect(findEdit(title).opts.maxLength).toBe(60);

      findEdit(title).opts.onCommit("Semaine 2");
      expect(c.send).toHaveBeenCalledWith({ type: "renameList", name: "Semaine 2" });
      expect(toastText()).toBe("Nom de la liste modifié.");
      (document.querySelector("#list-toast button") as HTMLElement).click();
      expect(c.send).toHaveBeenLastCalledWith({ type: "renameList", name: "Semaine" });

      c.send.mockClear();
      document.getElementById("list-toast")?.remove();
      findEdit(title).opts.onCommit("Semaine");
      expect(c.send).toHaveBeenCalledWith({ type: "renameList", name: "Semaine" });
      expect(document.querySelector("#list-toast")).toBeNull();

      c.send.mockClear();
      title.replaceChildren(document.createElement("input"));
      findEdit(title).opts.onCommit("");
      expect(c.send).not.toHaveBeenCalled();
      expect(title.querySelector("input")).toBeNull();
      expect(title.textContent).toBe("Semaine");

      title.replaceChildren(document.createElement("input"));
      findEdit(title).opts.onCommit("Nouveau nom");
      expect(title.querySelector("input")).toBeNull();
      expect(title.textContent).toBe("Nouveau nom");
    });

    it("le titre s'active aussi au clavier (Entrée)", async () => {
      await mount();
      $("#list-title").dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
      expect(startEditCalls).toHaveLength(1);
    });

    it("le menu s'ouvre/se ferme, marque son état, se ferme au clic extérieur mais pas dedans", async () => {
      await mount();
      const menu = $("#action-menu");
      expect(menu.hidden).toBe(true);
      openMenu();
      expect(menu.hidden).toBe(false);
      expect($("#menu-toggle-btn").getAttribute("aria-expanded")).toBe("true");
      menu.click();
      expect(menu.hidden).toBe(false);
      openMenu();
      expect(menu.hidden).toBe(true);
      expect($("#menu-toggle-btn").getAttribute("aria-expanded")).toBe("false");
      openMenu();
      document.body.click();
      expect(menu.hidden).toBe(true);
    });

    it("le panneau de partage s'ouvre depuis le menu (qui se ferme), se ferme au clic extérieur", async () => {
      await mount();
      openMenu();
      $("#btn-share").click();
      expect($("#share-panel").hidden).toBe(false);
      expect($("#action-menu").hidden).toBe(true);
      $("#share-panel").click();
      expect($("#share-panel").hidden).toBe(false);
      document.body.click();
      expect($("#share-panel").hidden).toBe(true);
      $("#btn-share").click();
      $("#btn-share").click();
      expect($("#share-panel").hidden).toBe(true);
    });

    it("le panneau affiche le code et le QR du lien", async () => {
      await mount();
      expect($("#share-code").textContent).toBe("ABCDEF");
      expect(renderQrSvg).toHaveBeenCalledWith(`${location.origin}/l/ABCDEF`);
      await vi.advanceTimersByTimeAsync(0);
      expect($("#qr-wrap").innerHTML).toBe("<svg></svg>");
    });

    it("copier le nom, le code, le lien : presse-papiers et toast ; échec signalé ; API absente sans erreur", async () => {
      const writeText = vi.fn().mockResolvedValue(undefined);
      vi.stubGlobal("navigator", { ...navigator, clipboard: { writeText } });
      await mount(sampleState({ name: "Semaine" }));
      $("#copy-name").click();
      await vi.advanceTimersByTimeAsync(0);
      expect(writeText).toHaveBeenLastCalledWith("Semaine");
      expect(toastText()).toBe("Nom copié.");
      $("#copy-code").click();
      await vi.advanceTimersByTimeAsync(0);
      expect(writeText).toHaveBeenLastCalledWith("ABCDEF");
      expect(toastText()).toBe("Code copié.");
      $("#copy-link").click();
      await vi.advanceTimersByTimeAsync(0);
      expect(writeText).toHaveBeenLastCalledWith(`${location.origin}/l/ABCDEF`);
      expect(toastText()).toBe("Lien copié.");

      writeText.mockRejectedValue(new Error("refusé"));
      $("#copy-code").click();
      await vi.advanceTimersByTimeAsync(0);
      expect(toastText()).toBe("Impossible de copier.");

      vi.stubGlobal("navigator", { userAgent: "test" });
      expect(() => $("#copy-name").click()).not.toThrow();
    });

    it("le lien/QR figé : génère l'instantané décodable, l'affiche et le rend copiable", async () => {
      const writeText = vi.fn().mockResolvedValue(undefined);
      vi.stubGlobal("navigator", { ...navigator, clipboard: { writeText } });
      const meals = [makeMeal({ title: "Riz" })];
      await mount(sampleState({ name: "Semaine", meals }));
      expect($("#snapshot-qr-wrap").hidden).toBe(true);
      expect($("#copy-snapshot-link").hidden).toBe(true);

      $("#btn-snapshot-link").click();
      await vi.advanceTimersByTimeAsync(0);

      const url = renderQrSvg.mock.calls[renderQrSvg.mock.calls.length - 1][0] as string;
      const param = new URL(url).searchParams.get("import")!;
      const { decodeSnapshotFromParam } = await import("../lib/compactShare");
      const decoded = decodeSnapshotFromParam(param)!;
      expect(decoded.name).toBe("Semaine");
      expect(decoded.meals.map((m) => m.title)).toEqual(["Riz"]);
      expect(new URL(url).pathname).toBe("/");
      expect($("#snapshot-qr-wrap").hidden).toBe(false);
      expect($("#snapshot-qr-wrap").innerHTML).toBe("<svg></svg>");
      expect($("#copy-snapshot-link").hidden).toBe(false);
      $("#copy-snapshot-link").click();
      await vi.advanceTimersByTimeAsync(0);
      expect(writeText).toHaveBeenLastCalledWith(url);
      expect(toastText()).toBe("Lien figé copié.");
    });

    it("lien figé : si le QR échoue (liste trop volumineuse), message dédié", async () => {
      await mount();
      renderQrSvg.mockRejectedValue(new Error("trop gros"));
      $("#btn-snapshot-link").click();
      await vi.advanceTimersByTimeAsync(0);
      expect(toastText()).toBe("Liste trop volumineuse pour un lien/QR figé — utilise plutôt l'export JSON.");
      expect($("#snapshot-qr-wrap").hidden).toBe(true);
    });

    it("exporter envoie l'état courant à l'export et ferme le menu", async () => {
      const c = await mount(sampleState({ name: "Ancienne" }));
      emitState(c, sampleState({ name: "Récente" }));
      openMenu();
      $("#btn-export").click();
      expect(exportListState).toHaveBeenCalledWith(expect.objectContaining({ name: "Récente" }));
      expect($("#action-menu").hidden).toBe(true);
    });
  });

  describe("import de fichier", () => {
    const data = { name: "Reçue", meals: [makeMeal({ id: "x" })], archive: [archived({ id: "y" })] };
    const pick = async (file: File | null) => {
      const input = $("#import-file-input") as HTMLInputElement;
      Object.defineProperty(input, "files", { value: file ? [file] : [], configurable: true });
      input.dispatchEvent(new Event("change"));
      await vi.advanceTimersByTimeAsync(0);
    };
    const modal = () => document.querySelector(".modal-overlay") as HTMLElement | null;

    it("« Importer » ouvre le sélecteur de fichier et ferme le menu", async () => {
      await mount();
      const click = vi.spyOn($("#import-file-input"), "click").mockImplementation(() => {});
      openMenu();
      $("#btn-import").click();
      expect(click).toHaveBeenCalledOnce();
      expect($("#action-menu").hidden).toBe(true);
    });

    it("annuler la sélection n'ouvre rien", async () => {
      await mount();
      await pick(null);
      expect(parseImportFile).not.toHaveBeenCalled();
      expect(modal()).toBeNull();
    });

    it("un fichier invalide affiche l'erreur ; une erreur inconnue, un message générique", async () => {
      await mount();
      parseImportFile.mockRejectedValue(new Error("Ce fichier n'est pas un JSON valide."));
      await pick(new File(["x"], "a.json"));
      expect(toastText()).toBe("Ce fichier n'est pas un JSON valide.");
      parseImportFile.mockRejectedValue("autre");
      await pick(new File(["x"], "a.json"));
      expect(toastText()).toBe("Import impossible.");
    });

    it("la modale résume le fichier (nom échappé, compteurs)", async () => {
      await mount();
      parseImportFile.mockResolvedValue({ ...data, name: "<b>Reçue</b>" });
      await pick(new File(["x"], "a.json"));
      expect(modal()!.querySelector("h2")!.textContent).toBe("Importer « <b>Reçue</b> »");
      expect(modal()!.querySelector("h2 b")).toBeNull();
      expect(modal()!.querySelector(".modal-hint")!.textContent).toBe("2 repas trouvé(s) (1 actif(s), 1 dans l'historique).");
    });

    it("sans nom dans le fichier, le titre ne mentionne rien", async () => {
      await mount();
      parseImportFile.mockResolvedValue({ ...data, name: "" });
      await pick(new File(["x"], "a.json"));
      expect(modal()!.querySelector("h2")!.textContent).toBe("Importer");
    });

    it("fusionner envoie importState et ferme", async () => {
      const c = await mount();
      parseImportFile.mockResolvedValue(data);
      await pick(new File(["x"], "a.json"));
      (modal()!.querySelector("#import-merge") as HTMLElement).click();
      expect(c.send).toHaveBeenCalledWith({ type: "importState", mode: "merge", data });
      expect(modal()).toBeNull();
    });

    it("remplacer demande confirmation (texte exact) ; refusé : rien, la modale reste", async () => {
      const confirmSpy = vi.fn(() => false);
      vi.stubGlobal("confirm", confirmSpy);
      const c = await mount();
      parseImportFile.mockResolvedValue(data);
      await pick(new File(["x"], "a.json"));
      (modal()!.querySelector("#import-replace") as HTMLElement).click();
      expect(confirmSpy).toHaveBeenCalledWith("Remplacer entièrement la liste actuelle par le contenu importé ?");
      expect(c.send).not.toHaveBeenCalled();
      expect(modal()).not.toBeNull();
      confirmSpy.mockReturnValue(true);
      (modal()!.querySelector("#import-replace") as HTMLElement).click();
      expect(c.send).toHaveBeenCalledWith({ type: "importState", mode: "replace", data });
      expect(modal()).toBeNull();
    });


    it.each([["#import-cancel"], [".modal-close"]])("%s ferme la modale", async (selector) => {
      await mount();
      parseImportFile.mockResolvedValue(data);
      await pick(new File(["x"], "a.json"));
      (modal()!.querySelector(selector) as HTMLElement).click();
      expect(modal()).toBeNull();
    });

    it("Échap ferme une seule fois ; fond ferme, fenêtre non", async () => {
      await mount();
      parseImportFile.mockResolvedValue(data);
      await pick(new File(["x"], "a.json"));
      (modal()!.querySelector(".modal") as HTMLElement).click();
      expect(modal()).not.toBeNull();
      keydown("a");
      expect(modal()).not.toBeNull();
      modal()!.click();
      expect(modal()).toBeNull();
      await pick(new File(["x"], "a.json"));
      keydown("Escape");
      expect(modal()).toBeNull();
    });
  });

  describe("lien figé reçu (?import=)", () => {
    const payload = { name: "Reçue", meals: [makeMeal({ id: "x" })], archive: [] };

    it("ouvre le choix fusionner/remplacer une seule fois, retire le paramètre de l'URL (autres conservés)", async () => {
      history.replaceState({}, "", `/l/ABCDEF?a=1&import=${encodeURIComponent(encodeSnapshotToParam(payload))}`);
      const c = await mount();
      expect(document.querySelector(".modal-overlay h2")!.textContent).toBe("Importer « Reçue »");
      expect(location.search).toBe("?a=1");
      (document.querySelector("#import-merge") as HTMLElement).click();
      expect(c.send).toHaveBeenCalledWith(expect.objectContaining({ type: "importState", mode: "merge" }));
      emitState(c, sampleState());
      expect(document.querySelector(".modal-overlay")).toBeNull();
    });

    it("sans autre paramètre, l'URL redevient le simple chemin", async () => {
      history.replaceState({}, "", `/l/ABCDEF?import=${encodeURIComponent(encodeSnapshotToParam(payload))}`);
      await mount();
      expect(location.search).toBe("");
      expect(location.pathname).toBe("/l/ABCDEF");
    });

    it("un lien invalide affiche un message et retire quand même le paramètre", async () => {
      history.replaceState({}, "", "/l/ABCDEF?import=corrompu");
      await mount();
      expect(toastText()).toBe("Le lien de partage figé est invalide ou corrompu.");
      expect(document.querySelector(".modal-overlay")).toBeNull();
      expect(location.search).toBe("");
    });

    it("sans paramètre, l'URL n'est pas touchée", async () => {
      const replace = vi.spyOn(history, "replaceState");
      await mount();
      expect(replace).not.toHaveBeenCalled();
    });
  });

  describe("onglets, tri et filtres", () => {
    const withMeals = () =>
      sampleState({
        meals: [
          makeMeal({ id: "a", title: "Alpha", status: "validee", order: 0, prepTime: "rapide" }),
          makeMeal({ id: "b", title: "Bravo", status: "idee", order: 1, prepTime: "long" }),
          makeMeal({ id: "c", title: "Charlie", status: "commandee", order: 2 }),
        ],
        archive: [archived({ id: "x", title: "Xavier", note: "quand_tu_veux" }), archived({ id: "y", title: "Yann", prepTime: "normal" })],
      });

    it("trois onglets, « Repas » actif au départ ; les autres cartes sont masquées", async () => {
      await mount(withMeals());
      const tabs = Array.from(root.querySelectorAll(".tab-btn")).map((b) => [b.getAttribute("data-tab"), b.getAttribute("aria-pressed")]);
      expect(tabs).toEqual([["active", "true"], ["planning", "false"], ["archive", "false"]]);
      expect($("#add-meal-card").hidden).toBe(false);
      expect($("#search-card").hidden).toBe(true);
      expect($("#planning-view").hidden).toBe(true);
      expect($("#meal-list").hidden).toBe(false);
      expect(titles()).toEqual(["Alpha", "Bravo", "Charlie"]);
    });

    it("l'historique : ses repas, la recherche, l'état et le bouton de tri/filtre masqués", async () => {
      await mount(withMeals());
      (root.querySelector('[data-tab="archive"]') as HTMLElement).click();
      expect((root.querySelector('[data-tab="archive"]') as HTMLElement).getAttribute("aria-pressed")).toBe("true");
      expect($("#add-meal-card").hidden).toBe(true);
      expect($("#search-card").hidden).toBe(false);
      expect($("#sort-toggle-btn").hidden).toBe(true);
      expect($("#filter-toggle-btn").hidden).toBe(true);
      expect(titles()).toEqual(["Xavier", "Yann"]);

      const search = $<HTMLInputElement>("#archive-search");
      search.value = "  XAV ";
      search.dispatchEvent(new Event("input"));
      expect(titles()).toEqual(["Xavier"]);
      search.value = "zzz";
      search.dispatchEvent(new Event("input"));
      expect($("#empty-message").textContent).toBe("Aucun repas ne correspond à la recherche.");
      expect($("#empty-message").hidden).toBe(false);
      search.value = "";
      search.dispatchEvent(new Event("input"));
      expect(titles()).toHaveLength(2);
    });

    it("historique vide : message dédié", async () => {
      await mount(sampleState());
      (root.querySelector('[data-tab="archive"]') as HTMLElement).click();
      expect($("#empty-message").textContent).toBe("Aucun repas dans l'historique pour le moment.");
    });

    it("liste vide : message d'accueil ; filtres sans résultat : message dédié", async () => {
      const c = await mount(sampleState());
      expect($("#empty-message").textContent).toBe("Aucun repas pour l'instant. Ajoute une idée ci-dessus !");
      emitState(c, withMeals());
      expect($("#empty-message").hidden).toBe(true);
      (root.querySelector('.filter-status-pill[data-status="fait"]') as HTMLElement).click();
      expect($("#empty-message").textContent).toBe("Aucun repas ne correspond aux filtres.");
      expect($("#empty-message").hidden).toBe(false);
      expect(titles()).toEqual([]);
    });

    it("le planning masque la liste, le message vide et « tout déplier »", async () => {
      await mount(withMeals());
      (root.querySelector('[data-tab="planning"]') as HTMLElement).click();
      expect($("#planning-view").hidden).toBe(false);
      expect($("#meal-list").hidden).toBe(true);
      expect($("#empty-message").hidden).toBe(true);
      expect($("#toggle-all-btn").hidden).toBe(true);
      expect($("#add-meal-card").hidden).toBe(true);
      expect($("#sort-toggle-btn").hidden).toBe(true);
    });

    it("trier par statut : bascule, libellé, mémorisation, désactivation du glisser, ordre par statut puis ordre manuel", async () => {
      await mount(withMeals());
      const btn = $("#sort-toggle-btn");
      expect(btn.textContent).toBe("Trier par statut");
      expect(btn.getAttribute("aria-pressed")).toBe("false");
      openMenu();
      btn.click();
      expect(btn.textContent).toBe("Tri manuel");
      expect(btn.getAttribute("aria-pressed")).toBe("true");
      expect(localStorage.getItem("omq:sort-by-status")).toBe("true");
      expect(sortable().option).toHaveBeenCalledWith("disabled", true);
      expect($("#action-menu").hidden).toBe(true);
      expect(titles()).toEqual(["Bravo", "Alpha", "Charlie"]);

      btn.click();
      expect(btn.textContent).toBe("Trier par statut");
      expect(localStorage.getItem("omq:sort-by-status")).toBe("false");
      expect(sortable().option).toHaveBeenLastCalledWith("disabled", false);
      expect(titles()).toEqual(["Alpha", "Bravo", "Charlie"]);
    });

    it("à statut égal, le tri par statut suit l'ordre manuel", async () => {
      localStorage.setItem("omq:sort-by-status", "true");
      await mount(sampleState({ meals: [makeMeal({ id: "a", title: "A", order: 2 }), makeMeal({ id: "b", title: "B", order: 0 }), makeMeal({ id: "c", title: "C", order: 1 })] }));
      expect(titles()).toEqual(["B", "C", "A"]);
    });

    it("le tri mémorisé est repris à l'ouverture et désactive le glisser dès le départ", async () => {
      localStorage.setItem("omq:sort-by-status", "true");
      await mount(withMeals());
      expect($("#sort-toggle-btn").textContent).toBe("Tri manuel");
      expect(sortable().opts.disabled).toBe(true);
      expect(card("a").querySelector(".drag-handle")).toBeNull();
    });

    it("l'ordre manuel suit le champ « ordre » quel que soit l'ordre de réception", async () => {
      await mount(sampleState({ meals: [makeMeal({ id: "a", title: "A", order: 2 }), makeMeal({ id: "b", title: "B", order: 0 }), makeMeal({ id: "c", title: "C", order: 1 })] }));
      expect(titles()).toEqual(["B", "C", "A"]);
    });

    describe("filtres", () => {
      const toggle = () => $("#filter-toggle-btn");
      const pill = (sel: string) => root.querySelector(sel) as HTMLElement;

      it("le panneau s'ouvre/se ferme depuis le menu (qui se ferme) et marque son état", async () => {
        await mount(withMeals());
        expect($("#filter-panel").hidden).toBe(true);
        openMenu();
        toggle().click();
        expect($("#filter-panel").hidden).toBe(false);
        expect(toggle().getAttribute("aria-pressed")).toBe("true");
        expect($("#action-menu").hidden).toBe(true);
        toggle().click();
        expect($("#filter-panel").hidden).toBe(true);
        expect(toggle().getAttribute("aria-pressed")).toBe("false");
      });

      it("un panneau ouvert se referme en quittant l'onglet des repas", async () => {
        await mount(withMeals());
        toggle().click();
        (root.querySelector('[data-tab="archive"]') as HTMLElement).click();
        expect($("#filter-panel").hidden).toBe(true);
        expect(toggle().getAttribute("aria-pressed")).toBe("false");
        (root.querySelector('[data-tab="active"]') as HTMLElement).click();
        expect(toggle().hidden).toBe(false);
      });

      it("liste les 6 statuts et 3 temps, filtre par statut, puis par temps (ET entre familles, OU dans une famille)", async () => {
        await mount(withMeals());
        expect(root.querySelectorAll(".filter-status-pill")).toHaveLength(6);
        expect(root.querySelectorAll(".filter-preptime-pill")).toHaveLength(3);
        expect($("#filter-reset-btn").hidden).toBe(true);

        pill('.filter-status-pill[data-status="validee"]').click();
        expect(titles()).toEqual(["Alpha"]);
        expect(pill('.filter-status-pill[data-status="validee"]').getAttribute("aria-pressed")).toBe("true");
        expect($("#filter-reset-btn").hidden).toBe(false);

        pill('.filter-status-pill[data-status="idee"]').click();
        expect(titles()).toEqual(["Alpha", "Bravo"]);

        pill('.filter-preptime-pill[data-preptime="long"]').click();
        expect(titles()).toEqual(["Bravo"]);
        pill('.filter-preptime-pill[data-preptime="rapide"]').click();
        expect(titles()).toEqual(["Alpha", "Bravo"]);

        pill('.filter-status-pill[data-status="validee"]').click();
        expect(pill('.filter-status-pill[data-status="validee"]').getAttribute("aria-pressed")).toBe("false");
        expect(titles()).toEqual(["Bravo"]);
      });

      it("recliquer un filtre le retire (statut comme temps de préparation)", async () => {
        await mount(withMeals());
        pill('.filter-preptime-pill[data-preptime="rapide"]').click();
        pill('.filter-preptime-pill[data-preptime="rapide"]').click();
        expect(titles()).toHaveLength(3);
        expect(pill('.filter-preptime-pill[data-preptime="rapide"]').getAttribute("aria-pressed")).toBe("false");
        expect($("#filter-reset-btn").hidden).toBe(true);
      });

      it("un repas sans temps de préparation est exclu dès qu'un filtre de temps est actif", async () => {
        await mount(withMeals());
        pill('.filter-preptime-pill[data-preptime="rapide"]').click();
        expect(titles()).toEqual(["Alpha"]);
      });

      it("réinitialiser efface tous les filtres", async () => {
        await mount(withMeals());
        pill('.filter-status-pill[data-status="validee"]').click();
        pill('.filter-preptime-pill[data-preptime="rapide"]').click();
        $("#filter-reset-btn").click();
        expect(titles()).toHaveLength(3);
        expect(root.querySelectorAll('.filter-status-pill[aria-pressed="true"], .filter-preptime-pill[aria-pressed="true"]')).toHaveLength(0);
        expect($("#filter-reset-btn").hidden).toBe(true);
      });

      it("les filtres de l'historique ne s'appliquent pas à l'historique", async () => {
        await mount(withMeals());
        pill('.filter-status-pill[data-status="validee"]').click();
        (root.querySelector('[data-tab="archive"]') as HTMLElement).click();
        expect(titles()).toEqual(["Xavier", "Yann"]);
      });
    });

    describe("statistiques de l'historique", () => {
      it("le bouton affiche/masque le panneau (état marqué) et le remplit ; vide : message", async () => {
        const c = await mount(sampleState());
        (root.querySelector('[data-tab="archive"]') as HTMLElement).click();
        const btn = $("#stats-toggle-btn");
        expect($("#stats-panel").hidden).toBe(true);
        btn.click();
        expect($("#stats-panel").hidden).toBe(false);
        expect(btn.getAttribute("aria-pressed")).toBe("true");
        expect($("#stats-panel").textContent).toBe("Aucun repas dans l'historique pour l'instant.");

        emitState(c, withMeals());
        const text = $("#stats-panel").textContent!;
        expect(text).toContain("2 repas dans l'historique.");
        expect(text).toContain("Par note");
        expect(text).toContain("😍 Quand tu veux où tu veux");
        expect(text).toContain("Par temps de préparation");
        expect(text).toContain("🕐 Normal");
        btn.click();
        expect($("#stats-panel").hidden).toBe(true);
        expect(btn.getAttribute("aria-pressed")).toBe("false");
      });

      it("« Les plus refaits » liste les repas refaits (titre échappé, ×N)", async () => {
        await mount(sampleState({ archive: [archived({ id: "1", title: "<b>Pâtes</b>" }), archived({ id: "2", title: "<b>Pâtes</b>" }), archived({ id: "3", title: "Riz" })] }));
        (root.querySelector('[data-tab="archive"]') as HTMLElement).click();
        $("#stats-toggle-btn").click();
        expect($("#stats-panel h3:last-of-type").textContent).toBe("Les plus refaits");
        expect($("#stats-panel .stats-list:last-of-type li").textContent).toBe("<b>Pâtes</b>×2");
        expect($("#stats-panel b")).toBeNull();
      });

      it("les statistiques restent masquées (non recalculées) tant que le panneau est fermé", async () => {
        const c = await mount(sampleState());
        (root.querySelector('[data-tab="archive"]') as HTMLElement).click();
        emitState(c, withMeals());
        expect($("#stats-panel").innerHTML).toBe("");
      });
    });

    describe("tout déplier / replier", () => {
      it("bascule l'état de toutes les cartes visibles, avec libellé et fermeture du menu", async () => {
        await mount(withMeals());
        const btn = $("#toggle-all-btn");
        expect(btn.hidden).toBe(false);
        expect(btn.textContent).toBe("Tout déplier");
        openMenu();
        btn.click();
        expect(btn.textContent).toBe("Tout replier");
        expect($("#action-menu").hidden).toBe(true);
        expect(root.querySelectorAll(".meal-card.expanded")).toHaveLength(3);
        btn.click();
        expect(btn.textContent).toBe("Tout déplier");
        expect(root.querySelectorAll(".meal-card.expanded")).toHaveLength(0);
      });

      it("un repas déjà déplié passe tout de même à « tout déplier » pour les autres", async () => {
        await mount(withMeals());
        expand("a");
        expect($("#toggle-all-btn").textContent).toBe("Tout déplier");
        $("#toggle-all-btn").click();
        expect(root.querySelectorAll(".meal-card.expanded")).toHaveLength(3);
      });

      it("masqué quand la liste affichée est vide", async () => {
        await mount(sampleState());
        expect($("#toggle-all-btn").hidden).toBe(true);
      });

      it("ne porte que sur les repas visibles (filtres)", async () => {
        await mount(withMeals());
        (root.querySelector('.filter-status-pill[data-status="validee"]') as HTMLElement).click();
        $("#toggle-all-btn").click();
        expect(root.querySelectorAll(".meal-card.expanded")).toHaveLength(1);
      });
    });
  });

  describe("ajout d'un repas et suggestions", () => {
    const input = () => $<HTMLInputElement>("#add-title");
    const type = (value: string) => {
      input().value = value;
      input().dispatchEvent(new Event("input"));
    };
    const suggestions = () => Array.from(root.querySelectorAll(".add-suggestion"));
    const history5 = () => [
      archived({ id: "h1", title: "Pâtes carbonara", note: "quand_tu_veux" }),
      archived({ id: "h2", title: "Pâtes pesto" }),
      archived({ id: "h3", title: "pâtes carbonara" }),
      archived({ id: "h4", title: "Riz" }),
    ];

    it("le champ limite la longueur ; l'ajout bloque l'envoi natif, recadre, vide, refocalise", async () => {
      const c = await mount();
      expect(input().maxLength).toBe(120);
      type("  Gratin  ");
      input().blur();
      const event = new Event("submit", { bubbles: true, cancelable: true });
      $("#add-form").dispatchEvent(event);
      expect(event.defaultPrevented).toBe(true);
      expect(c.send).toHaveBeenCalledWith({ type: "addMeal", id: expect.any(String), title: "Gratin" });
      expect(input().value).toBe("");
      expect(document.activeElement).toBe(input());
    });

    it("un titre vide n'envoie rien", async () => {
      const c = await mount();
      type("   ");
      $("#add-form").dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
      expect(c.send).not.toHaveBeenCalled();
    });

    it("ne notifie pas le repas qu'on vient d'ajouter soi-même", async () => {
      vi.stubGlobal("Notification", Object.assign(vi.fn(), { permission: "granted" }));
      localStorage.setItem("omq:notifications", "true");
      const c = await mount();
      emitState(c, sampleState());
      type("Gratin");
      $("#add-form").dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
      const id = (c.send.mock.calls[0][0] as { id: string }).id;
      emitState(c, sampleState({ meals: [makeMeal({ id, title: "Gratin" })] }));
      await vi.advanceTimersByTimeAsync(0);
      expect(Notification).not.toHaveBeenCalled();
    });

    it("suggestions : repas de l'historique correspondants (insensible à la casse), sans doublon de titre, 5 au plus", async () => {
      await mount(sampleState({ archive: history5() }));
      type("PÂTES");
      expect(suggestions().map((b) => b.querySelector(".add-suggestion-title")!.textContent!.trim())).toEqual(["Pâtes carbonara", "Pâtes pesto"]);
      expect($("#add-suggestions").hidden).toBe(false);
      expect(suggestions()[0].querySelector(".add-suggestion-note")!.textContent).toBe("😍 Quand tu veux où tu veux");
      expect(suggestions()[1].querySelector(".add-suggestion-note")).toBeNull();
      expect(stray("#add-suggestions, #add-suggestions li, .add-suggestion")).toEqual([]);
    });

    it("jamais plus de 5 suggestions", async () => {
      await mount(sampleState({ archive: Array.from({ length: 8 }, (_, i) => archived({ id: `h${i}`, title: `Soupe ${i}` })) }));
      type("soupe");
      expect(suggestions()).toHaveLength(5);
    });

    it("échappe les titres suggérés", async () => {
      await mount(sampleState({ archive: [archived({ id: "h1", title: "<b>x</b>" })] }));
      type("x");
      expect(root.querySelector("#add-suggestions b")).toBeNull();
    });

    it("saisie vide ou sans correspondance : suggestions masquées et vidées", async () => {
      await mount(sampleState({ archive: history5() }));
      type("pât");
      expect($("#add-suggestions").hidden).toBe(false);
      type("   ");
      expect($("#add-suggestions").hidden).toBe(true);
      expect($("#add-suggestions").innerHTML).toBe("");
      type("pât");
      type("zzz");
      expect($("#add-suggestions").hidden).toBe(true);
      expect($("#add-suggestions").innerHTML).toBe("");
    });

    it("le focus réaffiche les suggestions, Échap les masque, la perte de focus les masque après 150 ms", async () => {
      await mount(sampleState({ archive: history5() }));
      input().value = "riz";
      input().dispatchEvent(new Event("focus"));
      expect($("#add-suggestions").hidden).toBe(false);
      input().dispatchEvent(new KeyboardEvent("keydown", { key: "a" }));
      expect($("#add-suggestions").hidden).toBe(false);
      input().dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
      expect($("#add-suggestions").hidden).toBe(true);
      input().dispatchEvent(new Event("focus"));
      input().dispatchEvent(new Event("blur"));
      vi.advanceTimersByTime(149);
      expect($("#add-suggestions").hidden).toBe(false);
      vi.advanceTimersByTime(1);
      expect($("#add-suggestions").hidden).toBe(true);
    });

    it("choisir une suggestion remet le repas en liste, vide le champ, masque la liste et refocalise", async () => {
      const c = await mount(sampleState({ archive: history5() }));
      type("riz");
      input().blur();
      (suggestions()[0] as HTMLElement).click();
      expect(c.send).toHaveBeenCalledTimes(1);
      expect(c.send).toHaveBeenCalledWith({ type: "restoreMeal", id: "h4" });
      expect(input().value).toBe("");
      expect($("#add-suggestions").hidden).toBe(true);
      expect(document.activeElement).toBe(input());
    });

    it("l'ajout masque les suggestions", async () => {
      await mount(sampleState({ archive: history5() }));
      type("riz");
      $("#add-form").dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
      expect($("#add-suggestions").hidden).toBe(true);
    });
  });

  describe("cartes de repas", () => {
    const one = (overrides: Partial<Meal> = {}) => sampleState({ meals: [makeMeal({ id: "m1", title: "Pâtes", ...overrides })] });

    it("carte repliée : titre, badge emoji du statut, copier, pas de détails ; couleur par statut", async () => {
      await mount(one({ status: "validee" }));
      const c = card("m1");
      expect(c.className).toBe("meal-card");
      expect(c.getAttribute("data-status")).toBe("validee");
      expect(c.hasAttribute("data-note")).toBe(false);
      expect(c.querySelector(".meal-title")!.textContent).toBe("Pâtes");
      expect(c.querySelector(".meal-title")!.getAttribute("role")).toBe("button");
      expect(c.querySelector(".meal-title")!.getAttribute("tabindex")).toBe("0");
      const badge = c.querySelector(".meal-status-badge")!;
      expect(badge.textContent).toBe("✅");
      expect(badge.getAttribute("aria-label")).toBe("✅ Validée");
      expect(badge.getAttribute("title")).toBe("✅ Validée");
      expect(c.querySelector(".meal-details")).toBeNull();
      expect(c.querySelector('[data-action="copy-title"]')!.getAttribute("aria-label")).toBe("Copier le titre");
      expect(c.querySelector('[data-action="restore"]')).toBeNull();
      const toggle = c.querySelector('[data-action="toggle"]')!;
      expect(toggle.getAttribute("aria-expanded")).toBe("false");
      expect(toggle.getAttribute("aria-label")).toBe("Déplier");
      expect(toggle.classList.contains("drag-handle")).toBe(true);
      expect(toggle.getAttribute("title")).toBe("Glisser pour réordonner");
    });

    it("échappe titre et identifiant", async () => {
      await mount(sampleState({ meals: [makeMeal({ id: 'a"b', title: "<b>x</b>" })] }));
      expect(root.querySelector(".meal-title b")).toBeNull();
      expect((root.querySelector(".meal-card") as HTMLElement).dataset.id).toBe('a"b');
    });

    it("déplier : chevron, détails, statuts, source, temps, planification, commentaire, photos", async () => {
      await mount(one({ comment: "<i>note</i>", source: "Livre" }));
      expand("m1");
      const c = card("m1");
      expect(c.classList.contains("expanded")).toBe(true);
      const toggle = c.querySelector('[data-action="toggle"]')!;
      expect(toggle.getAttribute("aria-expanded")).toBe("true");
      expect(toggle.getAttribute("aria-label")).toBe("Réduire");
      expect(Array.from(c.querySelectorAll(".status-pill")).map((b) => [b.getAttribute("data-status"), b.getAttribute("aria-pressed")])).toEqual([
        ["idee", "true"], ["validee", "false"], ["commandee", "false"], ["rangee", "false"], ["non_complet", "false"], ["fait", "false"],
      ]);
      expect(c.querySelector(".meal-source")!.textContent!.trim()).toBe("Livre");
      expect(Array.from(c.querySelectorAll(".preptime-pill")).map((b) => b.getAttribute("data-preptime"))).toEqual(["", "rapide", "normal", "long"]);
      expect(Array.from(c.querySelectorAll(".later-pill")).map((b) => [b.getAttribute("data-later"), b.getAttribute("aria-pressed")])).toEqual([["false", "true"], ["true", "false"]]);
      expect((c.querySelector('[data-field="comment"]') as HTMLTextAreaElement).value).toBe("<i>note</i>");
      expect(c.querySelector(".meal-details i")).toBeNull();
      expect(c.querySelector(".meal-image-field")).not.toBeNull();
      expect(stray(".meal-card, .meal-details, .meal-main")).toEqual([]);
    });

    it("cliquer sur la ligne déplie/replie, mais pas sur le titre, les contrôles ni la poignée", async () => {
      await mount(one());
      const row = card("m1").querySelector(".meal-main") as HTMLElement;
      row.click();
      expect(card("m1").classList.contains("expanded")).toBe(true);
      row.click();
      expect(card("m1").classList.contains("expanded")).toBe(false);
      (card("m1").querySelector(".meal-title") as HTMLElement).click();
      (card("m1").querySelector(".meal-controls") as HTMLElement).click();
      expect(card("m1").classList.contains("expanded")).toBe(false);
      expand("m1");
      expect(card("m1").classList.contains("expanded")).toBe(true);
    });

    it("l'état déplié survit aux mises à jour reçues", async () => {
      const c = await mount(one());
      expand("m1");
      emitState(c, one({ title: "Pâtes 2", updatedAt: 2 }));
      expect(card("m1").classList.contains("expanded")).toBe(true);
      expect(card("m1").querySelector(".meal-title")!.textContent).toBe("Pâtes 2");
    });

    it("une carte inchangée est réutilisée (même nœud), une carte modifiée régénérée", async () => {
      const c = await mount(sampleState({ meals: [makeMeal({ id: "a", title: "A" }), makeMeal({ id: "b", title: "B", order: 1 })] }));
      const a = card("a");
      const b = card("b");
      emitState(c, sampleState({ meals: [makeMeal({ id: "a", title: "A" }), makeMeal({ id: "b", title: "B2", order: 1, updatedAt: 2 })] }));
      expect(card("a")).toBe(a);
      expect(card("b")).not.toBe(b);
    });

    it("le réordonnancement seul garde les cartes", async () => {
      const c = await mount(sampleState({ meals: [makeMeal({ id: "a", order: 0 }), makeMeal({ id: "b", order: 1 })] }));
      const a = card("a");
      emitState(c, sampleState({ meals: [makeMeal({ id: "a", order: 1 }), makeMeal({ id: "b", order: 0 })] }));
      expect(card("a")).toBe(a);
      expect(titles()).toEqual(["Pâtes", "Pâtes"]);
    });

    it("la carte dont un champ a le focus n'est pas écrasée par une mise à jour", async () => {
      const c = await mount(one({ comment: "avant" }));
      expand("m1");
      const area = card("m1").querySelector("textarea") as HTMLTextAreaElement;
      area.focus();
      area.value = "saisie en cours";
      emitState(c, one({ comment: "serveur", updatedAt: 5 }));
      expect(card("m1").querySelector("textarea")).toBe(area);
      expect(area.value).toBe("saisie en cours");
    });

    it("un champ hors des cartes (ajout) focalisé n'empêche pas les mises à jour", async () => {
      const c = await mount(one());
      $<HTMLInputElement>("#add-title").focus();
      emitState(c, one({ title: "Nouveau", updatedAt: 9 }));
      expect(card("m1").querySelector(".meal-title")!.textContent).toBe("Nouveau");
    });

    it("un bouton focalisé (chevron) n'empêche pas la régénération", async () => {
      const c = await mount(one());
      expand("m1");
      (card("m1").querySelector('[data-action="toggle"]') as HTMLElement).focus();
      emitState(c, one({ title: "Nouveau", updatedAt: 9 }));
      expect(card("m1").querySelector(".meal-title")!.textContent).toBe("Nouveau");
    });

    it("sections « pour la semaine » et « pour plus tard » : en-têtes, compteurs, ordre", async () => {
      await mount(
        sampleState({
          meals: [
            makeMeal({ id: "a", title: "A", order: 0, later: true }),
            makeMeal({ id: "b", title: "B", order: 1 }),
            makeMeal({ id: "c", title: "C", order: 2, later: true }),
          ],
        }),
      );
      const items = Array.from(root.querySelectorAll("#meal-list > li")).map((li) => (li.classList.contains("meal-section-header") ? `${li.getAttribute("data-section")}:${li.querySelector("h2")!.textContent}:${li.querySelector(".meal-section-count")!.textContent}` : li.querySelector(".meal-title")!.textContent));
      expect(items).toEqual(["week:📅 Pour la semaine:1", "B", "later:⏳ Pour plus tard:2", "A", "C"]);
      expect(stray("#meal-list")).toEqual([]);
    });

    it("l'historique n'a pas de sections ni de poignée de glissé", async () => {
      await mount(sampleState({ archive: [archived({ id: "x", title: "Xavier", note: "mouais" })] }));
      (root.querySelector('[data-tab="archive"]') as HTMLElement).click();
      expect(root.querySelector(".meal-section-header")).toBeNull();
      const c = card("x");
      expect(c.classList.contains("archived")).toBe(true);
      expect(c.getAttribute("data-note")).toBe("mouais");
      expect(c.hasAttribute("data-status")).toBe(false);
      expect(c.querySelector(".drag-handle")).toBeNull();
      expect(c.querySelector('[data-action="toggle"]')!.hasAttribute("title")).toBe(false);
      expect(c.querySelector(".meal-status-badge")!.textContent).toBe("😐");
      expect(c.querySelector('[data-action="restore"]')!.getAttribute("aria-label")).toBe("Remettre dans la liste");
    });

    it("historique : badge « 🎉 » sans note, pas de couleur de note ; détails sans planification, suppression définitive", async () => {
      await mount(sampleState({ archive: [archived({ id: "x", note: null })] }));
      (root.querySelector('[data-tab="archive"]') as HTMLElement).click();
      const c = card("x");
      expect(c.querySelector(".meal-status-badge")!.textContent).toBe("🎉");
      expect(c.querySelector(".meal-status-badge")!.getAttribute("aria-label")).toBe("Fait");
      expect(c.hasAttribute("data-note")).toBe(false);
      expand("x");
      expect(card("x").querySelector(".status-badge")!.textContent).toContain("🎉 Fait le ");
      expect(card("x").querySelector(".meal-planning-row")).toBeNull();
      expect(card("x").querySelector('[data-action="delete-forever"]')!.getAttribute("aria-label")).toBe("Supprimer définitivement");
      expect(card("x").querySelector('[data-action="delete"]')).toBeNull();
    });

    it("historique : la date d'archivage est la date de fin, sinon la dernière mise à jour", async () => {
      await mount(sampleState({ archive: [archived({ id: "x", doneAt: Date.UTC(2024, 0, 15, 12) }), archived({ id: "y", doneAt: null, updatedAt: Date.UTC(2023, 5, 3, 12) })] }));
      (root.querySelector('[data-tab="archive"]') as HTMLElement).click();
      expand("x");
      expand("y");
      expect(card("x").querySelector(".status-badge")!.textContent).toContain("15 janv. 2024");
      expect(card("y").querySelector(".status-badge")!.textContent).toContain("3 juin 2023");
    });
  });

  describe("actions sur un repas", () => {
    const one = (overrides: Partial<Meal> = {}) => sampleState({ meals: [makeMeal({ id: "m1", title: "Pâtes", ...overrides })] });
    const open = async (overrides: Partial<Meal> = {}) => {
      const c = await mount(one(overrides));
      expand("m1");
      return c;
    };
    const modal = () => document.querySelector(".modal-overlay") as HTMLElement | null;

    it("titre : propose le titre actuel, envoie et permet d'annuler ; vide : redessine ; inchangé : pas d'annulation", async () => {
      const c = await mount(one());
      const title = card("m1").querySelector(".meal-title")!;
      (title as HTMLElement).click();
      expect(findEdit(title).opts.value).toBe("Pâtes");
      expect(findEdit(title).opts.maxLength).toBe(120);

      findEdit(title).opts.onCommit("Lasagnes");
      expect(c.send).toHaveBeenCalledWith({ type: "updateMeal", id: "m1", title: "Lasagnes" });
      expect(toastText()).toBe("Titre modifié.");
      (document.querySelector("#list-toast button") as HTMLElement).click();
      expect(c.send).toHaveBeenLastCalledWith({ type: "updateMeal", id: "m1", title: "Pâtes" });

      document.getElementById("list-toast")?.remove();
      findEdit(title).opts.onCommit("Pâtes");
      expect(document.querySelector("#list-toast")).toBeNull();

      c.send.mockClear();
      title.replaceChildren(document.createElement("input"));
      findEdit(title).opts.onCommit("");
      expect(c.send).not.toHaveBeenCalled();
      expect(title.querySelector("input")).toBeNull();
      expect(title.textContent).toBe("Pâtes");
    });

    it("le titre s'active aussi au clavier (Entrée, Espace)", async () => {
      await mount(one());
      const title = card("m1").querySelector(".meal-title")!;
      title.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
      title.dispatchEvent(new KeyboardEvent("keydown", { key: " ", bubbles: true }));
      expect(startEditCalls).toHaveLength(2);
    });

    it("copier le titre : presse-papiers et toast", async () => {
      const writeText = vi.fn().mockResolvedValue(undefined);
      vi.stubGlobal("navigator", { ...navigator, clipboard: { writeText } });
      await mount(one());
      (card("m1").querySelector('[data-action="copy-title"]') as HTMLElement).click();
      await vi.advanceTimersByTimeAsync(0);
      expect(writeText).toHaveBeenCalledWith("Pâtes");
      expect(toastText()).toBe("Titre copié.");
    });

    describe("source", () => {
      it("texte libre, lien http(s) ou « www. » : lien sécurisé (échappé) ou texte ; vide : invite", async () => {
        await mount(sampleState({ meals: [makeMeal({ id: "a", source: "Livre <b>x</b>", order: 0 }), makeMeal({ id: "b", source: " https://x.fr/a?b=1&c=2 ", order: 1 }), makeMeal({ id: "c", source: "www.exemple.fr", order: 2 }), makeMeal({ id: "d", source: "", order: 3 })] }));
        for (const id of ["a", "b", "c", "d"]) expand(id);
        const src = (id: string) => card(id).querySelector(".meal-source")!;
        expect(src("a").textContent!.trim()).toBe("Livre <b>x</b>");
        expect(src("a").querySelector("a, b")).toBeNull();
        const b = src("b").querySelector("a")!;
        expect(b.getAttribute("href")).toBe("https://x.fr/a?b=1&c=2");
        expect(b.getAttribute("target")).toBe("_blank");
        expect(b.getAttribute("rel")).toBe("noopener noreferrer");
        expect(b.textContent).toBe(" https://x.fr/a?b=1&c=2 ");
        expect(src("b").querySelector("svg")).not.toBeNull();
        expect(src("c").querySelector("a")!.getAttribute("href")).toBe("https://www.exemple.fr");
        expect(src("d").querySelector(".placeholder")!.textContent).toBe("Ajouter une source (lien ou texte)");
      });

      it("un texte qui ne commence pas par un lien reste du texte, même s'il en contient un", async () => {
        await mount(one({ source: "voir http://x puis https://y" }));
        expand("m1");
        expect(card("m1").querySelector(".meal-source a")).toBeNull();
        expect(card("m1").querySelector(".meal-source")!.textContent!.trim()).toBe("voir http://x puis https://y");
      });

      it("modifier : propose la source actuelle et une invite, envoie, permet d'annuler ; inchangée : pas d'annulation", async () => {
        const c = await open({ source: "Livre" });
        const el = card("m1").querySelector('[data-action="edit-source"]')!;
        (el as HTMLElement).click();
        const edit = findEdit(el);
        expect(edit.opts.value).toBe("Livre");
        expect(edit.opts.placeholder).toBe("Lien ou texte libre");
        expect(edit.opts.maxLength).toBe(300);

        edit.opts.onCommit("Autre");
        expect(c.send).toHaveBeenCalledWith({ type: "updateMeal", id: "m1", source: "Autre" });
        expect(toastText()).toBe("Source modifiée.");
        (document.querySelector("#list-toast button") as HTMLElement).click();
        expect(c.send).toHaveBeenLastCalledWith({ type: "updateMeal", id: "m1", source: "Livre" });

        document.getElementById("list-toast")?.remove();
        edit.opts.onCommit("Livre");
        expect(document.querySelector("#list-toast")).toBeNull();
      });
    });

    describe("statut", () => {
      it("changer de statut : envoie, vibre (si possible), ne fait rien si c'est le statut courant", async () => {
        const vibrate = vi.fn();
        vi.stubGlobal("navigator", { ...navigator, vibrate });
        const c = await open();
        (card("m1").querySelector('.status-pill[data-status="idee"]') as HTMLElement).click();
        expect(c.send).not.toHaveBeenCalled();
        expect(vibrate).not.toHaveBeenCalled();

        (card("m1").querySelector('.status-pill[data-status="commandee"]') as HTMLElement).click();
        expect(c.send).toHaveBeenCalledWith({ type: "setMealStatus", id: "m1", status: "commandee" });
        expect(vibrate).toHaveBeenCalledWith(10);
      });

      it("sans API de vibration : aucune erreur", async () => {
        vi.stubGlobal("navigator", { userAgent: "test" });
        const c = await open();
        const errors = vi.spyOn(console, "error").mockImplementation(() => {});
        (card("m1").querySelector('.status-pill[data-status="rangee"]') as HTMLElement).click();
        expect(c.send).toHaveBeenCalledWith({ type: "setMealStatus", id: "m1", status: "rangee" });
        expect(errors).not.toHaveBeenCalled();
      });

      it("ne notifie pas son propre changement de statut", async () => {
        vi.stubGlobal("Notification", Object.assign(vi.fn(), { permission: "granted" }));
        localStorage.setItem("omq:notifications", "true");
        const c = await open();
        emitState(c, one());
        (card("m1").querySelector('.status-pill[data-status="rangee"]') as HTMLElement).click();
        emitState(c, one({ status: "rangee", updatedAt: 2 }));
        await vi.advanceTimersByTimeAsync(0);
        expect(Notification).not.toHaveBeenCalled();
      });

      it("« Fait » ouvre la modale de fin de repas, sans rien envoyer d'abord", async () => {
        const c = await open({ comment: "<b>bon</b>", note: "mouais" });
        (card("m1").querySelector('.status-pill[data-status="fait"]') as HTMLElement).click();
        expect(c.send).not.toHaveBeenCalled();
        expect(modal()!.querySelector("h2")!.textContent).toBe("Marquer « Pâtes » comme fait");
        expect(modal()!.querySelector(".modal")!.getAttribute("aria-labelledby")).toBe("mark-done-title");
        expect((modal()!.querySelector("#mark-done-comment") as HTMLTextAreaElement).value).toBe("<b>bon</b>");
        expect((modal()!.querySelector("#mark-done-comment") as HTMLTextAreaElement).maxLength).toBe(2000);
        expect(document.activeElement).toBe(modal()!.querySelector("#mark-done-comment"));
        expect(Array.from(modal()!.querySelectorAll(".note-option")).map((b) => [b.getAttribute("data-note"), b.getAttribute("aria-pressed")]).filter(([, p]) => p === "true")).toEqual([["mouais", "true"]]);
        expect(modal()!.querySelectorAll(".note-option")).toHaveLength(6);
        expect(modal()!.querySelector("#mark-done-date")).not.toBeNull();
      });

      it("la modale propose la date du jour (heure locale) et « Pas encore de note » sans note", async () => {
        vi.setSystemTime(new Date(2026, 4, 9, 23, 30));
        await open();
        (card("m1").querySelector('.status-pill[data-status="fait"]') as HTMLElement).click();
        expect((modal()!.querySelector("#mark-done-date") as HTMLInputElement).value).toBe("2026-05-09");
        const pressed = Array.from(modal()!.querySelectorAll('.note-option[aria-pressed="true"]'));
        expect(pressed.map((b) => b.getAttribute("data-note"))).toEqual([""]);
        expect(pressed[0].textContent).toBe("Pas encore de note");
      });

      it("le commentaire en cours de saisie (non encore validé) est repris par la modale", async () => {
        await open({ comment: "ancien" });
        (card("m1").querySelector("textarea") as HTMLTextAreaElement).value = "en cours";
        (card("m1").querySelector('.status-pill[data-status="fait"]') as HTMLElement).click();
        expect((modal()!.querySelector("#mark-done-comment") as HTMLTextAreaElement).value).toBe("en cours");
      });

      it("confirmer : envoie commentaire, note et statut dans l'ordre, ferme, propose d'annuler", async () => {
        const c = await open();
        (card("m1").querySelector('.status-pill[data-status="fait"]') as HTMLElement).click();
        (modal()!.querySelector('.note-option[data-note="quand_tu_veux"]') as HTMLElement).click();
        expect(modal()!.querySelector('.note-option[data-note="quand_tu_veux"]')!.getAttribute("aria-pressed")).toBe("true");
        expect(modal()!.querySelectorAll('.note-option[aria-pressed="true"]')).toHaveLength(1);
        (modal()!.querySelector("#mark-done-comment") as HTMLTextAreaElement).value = "délicieux";
        (modal()!.querySelector("#mark-done-date") as HTMLInputElement).value = "2026-02-03";

        (modal()!.querySelector("#mark-done-confirm") as HTMLElement).click();

        expect(modal()).toBeNull();
        expect(c.send.mock.calls.map(([m]) => m)).toEqual([
          { type: "updateMeal", id: "m1", comment: "délicieux" },
          { type: "setMealNote", id: "m1", note: "quand_tu_veux" },
          { type: "setMealStatus", id: "m1", status: "fait", doneAt: new Date("2026-02-03T12:00:00").getTime() },
        ]);
        expect(toastText()).toBe("Repas déplacé vers l'historique.");
        (document.querySelector("#list-toast button") as HTMLElement).click();
        expect(c.send).toHaveBeenLastCalledWith({ type: "restoreMeal", id: "m1" });
      });

      it("confirmer sans note ni date : note nulle, date du jour", async () => {
        vi.setSystemTime(new Date(2026, 4, 9, 10, 0));
        const c = await open();
        (card("m1").querySelector('.status-pill[data-status="fait"]') as HTMLElement).click();
        (modal()!.querySelector("#mark-done-date") as HTMLInputElement).value = "";
        (modal()!.querySelector("#mark-done-confirm") as HTMLElement).click();
        const calls = c.send.mock.calls.map(([m]) => m) as ClientMessage[];
        expect(calls[1]).toEqual({ type: "setMealNote", id: "m1", note: null });
        expect(calls[2]).toMatchObject({ type: "setMealStatus", id: "m1", status: "fait" });
        expect(Math.abs((calls[2] as { doneAt: number }).doneAt - new Date(2026, 4, 9, 10, 0).getTime())).toBeLessThan(5000);
      });

      it("ne notifie pas son propre passage à « fait » ni son annulation", async () => {
        vi.stubGlobal("Notification", Object.assign(vi.fn(), { permission: "granted" }));
        localStorage.setItem("omq:notifications", "true");
        const c = await open();
        emitState(c, one());
        (card("m1").querySelector('.status-pill[data-status="fait"]') as HTMLElement).click();
        (modal()!.querySelector("#mark-done-confirm") as HTMLElement).click();
        emitState(c, sampleState({ archive: [archived({ id: "m1", updatedAt: 3 })] }));
        (document.querySelector("#list-toast button") as HTMLElement).click();
        emitState(c, one({ updatedAt: 4 }));
        await vi.advanceTimersByTimeAsync(0);
        expect(Notification).not.toHaveBeenCalled();
      });

      it.each([["#mark-done-cancel"], [".modal-close"]])("%s ferme sans rien envoyer et rend le focus", async (selector) => {
        const c = await open();
        const trigger = card("m1").querySelector('.status-pill[data-status="fait"]') as HTMLElement;
        trigger.focus();
        trigger.click();
        (modal()!.querySelector(selector) as HTMLElement).click();
        expect(modal()).toBeNull();
        expect(c.send).not.toHaveBeenCalled();
        expect(document.activeElement).toBe(trigger);
      });

      it("Échap ferme une seule fois ; fond ferme, fenêtre non", async () => {
        await open();
        const pill = () => card("m1").querySelector('.status-pill[data-status="fait"]') as HTMLElement;
        pill().click();
        (modal()!.querySelector(".modal") as HTMLElement).click();
        expect(modal()).not.toBeNull();
        keydown("a");
        expect(modal()).not.toBeNull();
        modal()!.click();
        expect(modal()).toBeNull();
        pill().click();
        keydown("Escape");
        expect(modal()).toBeNull();
      });

      it("Tab reste piégé dans la modale", async () => {
        await open();
        (card("m1").querySelector('.status-pill[data-status="fait"]') as HTMLElement).click();
        const buttons = Array.from(modal()!.querySelectorAll<HTMLElement>("button, textarea, input"));
        buttons[buttons.length - 1].focus();
        const event = new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true });
        modal()!.dispatchEvent(event);
        expect(event.defaultPrevented).toBe(true);
        expect(document.activeElement).toBe(buttons[0]);
      });
    });

    describe("planification et préparation", () => {
      it("temps de préparation : envoie la valeur, « Non renseigné » efface, la valeur courante ne renvoie rien", async () => {
        const c = await open({ prepTime: "normal" });
        const pill = (v: string) => card("m1").querySelector(`.preptime-pill[data-preptime="${v}"]`) as HTMLElement;
        expect(pill("normal").getAttribute("aria-pressed")).toBe("true");
        expect(pill("").getAttribute("aria-pressed")).toBe("false");
        pill("normal").click();
        expect(c.send).not.toHaveBeenCalled();
        pill("long").click();
        expect(c.send).toHaveBeenCalledWith({ type: "setMealPrepTime", id: "m1", prepTime: "long" });
        pill("").click();
        expect(c.send).toHaveBeenLastCalledWith({ type: "setMealPrepTime", id: "m1", prepTime: null });
      });

      it("« Non renseigné » sur un repas sans temps ne renvoie rien", async () => {
        const c = await open();
        (card("m1").querySelector('.preptime-pill[data-preptime=""]') as HTMLElement).click();
        expect(c.send).not.toHaveBeenCalled();
        expect(card("m1").querySelector('.preptime-pill[data-preptime=""]')!.getAttribute("aria-pressed")).toBe("true");
      });

      it("semaine / plus tard : envoie le changement, rien si identique", async () => {
        const c = await open();
        const pill = (v: string) => card("m1").querySelector(`.later-pill[data-later="${v}"]`) as HTMLElement;
        pill("false").click();
        expect(c.send).not.toHaveBeenCalled();
        pill("true").click();
        expect(c.send).toHaveBeenCalledWith({ type: "setMealLater", id: "m1", later: true });
      });

      it("un repas « plus tard » : pastille marquée, un clic sur « semaine » l'y remet", async () => {
        const c = await open({ later: true });
        expect(card("m1").querySelector('.later-pill[data-later="true"]')!.getAttribute("aria-pressed")).toBe("true");
        (card("m1").querySelector('.later-pill[data-later="false"]') as HTMLElement).click();
        expect(c.send).toHaveBeenCalledWith({ type: "setMealLater", id: "m1", later: false });
      });

      it("jour prévu : affiché, modifié (midi local), effaçable ; champ vide = effacer", async () => {
        const planned = new Date(2026, 2, 5, 12).getTime();
        const c = await open({ plannedDate: planned });
        const date = () => card("m1").querySelector('[data-action="planned-date"]') as HTMLInputElement;
        expect(date().value).toBe("2026-03-05");
        expect(date().id).toBe("meal-planned-m1");
        date().value = "2026-04-10";
        date().dispatchEvent(new Event("change", { bubbles: true }));
        expect(c.send).toHaveBeenCalledWith({ type: "setMealPlannedDate", id: "m1", plannedDate: new Date("2026-04-10T12:00:00").getTime() });
        date().value = "";
        date().dispatchEvent(new Event("change", { bubbles: true }));
        expect(c.send).toHaveBeenLastCalledWith({ type: "setMealPlannedDate", id: "m1", plannedDate: null });
        const clear = card("m1").querySelector('[data-action="clear-planned-date"]') as HTMLElement;
        expect(clear.getAttribute("aria-label")).toBe("Retirer le jour prévu");
        clear.click();
        expect(c.send).toHaveBeenLastCalledWith({ type: "setMealPlannedDate", id: "m1", plannedDate: null });
      });

      it("sans jour prévu : champ vide et pas de bouton d'effacement", async () => {
        await open();
        expect((card("m1").querySelector('[data-action="planned-date"]') as HTMLInputElement).value).toBe("");
        expect(card("m1").querySelector('[data-action="clear-planned-date"]')).toBeNull();
      });
    });

    describe("commentaire", () => {
      it("la perte de focus envoie la valeur ; l'annulation restaure la précédente, et suit les éditions successives", async () => {
        const c = await open({ comment: "v0" });
        const area = () => card("m1").querySelector("textarea") as HTMLTextAreaElement;
        area().value = "v1";
        area().dispatchEvent(new Event("blur"));
        expect(c.send).toHaveBeenLastCalledWith({ type: "updateMeal", id: "m1", comment: "v1" });
        expect(toastText()).toBe("Commentaire modifié.");
        area().value = "v2";
        area().dispatchEvent(new Event("blur"));
        (document.querySelector("#list-toast button") as HTMLElement).click();
        expect(c.send).toHaveBeenLastCalledWith({ type: "updateMeal", id: "m1", comment: "v1" });
      });

      it("une valeur inchangée est renvoyée sans proposer d'annulation", async () => {
        const c = await open({ comment: "v0" });
        const area = card("m1").querySelector("textarea") as HTMLTextAreaElement;
        area.dispatchEvent(new Event("blur"));
        expect(c.send).toHaveBeenCalledWith({ type: "updateMeal", id: "m1", comment: "v0" });
        expect(document.querySelector("#list-toast")).toBeNull();
      });
    });

    describe("suppression et restauration", () => {
      it("supprimer un repas actif : immédiat, annulable (le repas est renvoyé tel quel)", async () => {
        const meal = makeMeal({ id: "m1", title: "Pâtes", comment: "x" });
        const c = await mount(sampleState({ meals: [meal] }));
        expand("m1");
        const del = card("m1").querySelector('[data-action="delete"]') as HTMLElement;
        expect(del.getAttribute("aria-label")).toBe("Supprimer");
        del.click();
        expect(c.send).toHaveBeenCalledWith({ type: "deleteMeal", id: "m1" });
        expect(toastText()).toBe("Repas supprimé.");
        (document.querySelector("#list-toast button") as HTMLElement).click();
        expect(c.send).toHaveBeenLastCalledWith({ type: "restoreDeletedMeal", meal });
        expect(document.querySelector("#list-toast")).toBeNull();
      });

      it("ne notifie pas la restauration d'un repas supprimé par soi", async () => {
        vi.stubGlobal("Notification", Object.assign(vi.fn(), { permission: "granted" }));
        localStorage.setItem("omq:notifications", "true");
        const c = await open();
        emitState(c, one());
        (card("m1").querySelector('[data-action="delete"]') as HTMLElement).click();
        emitState(c, sampleState());
        (document.querySelector("#list-toast button") as HTMLElement).click();
        emitState(c, one({ updatedAt: 2 }));
        await vi.advanceTimersByTimeAsync(0);
        expect(Notification).not.toHaveBeenCalled();
      });

      it("l'historique : remettre dans la liste ; suppression définitive en deux clics", async () => {
        const c = await mount(sampleState({ archive: [archived({ id: "x", title: "Xavier" })] }));
        (root.querySelector('[data-tab="archive"]') as HTMLElement).click();
        (card("x").querySelector('[data-action="restore"]') as HTMLElement).click();
        expect(c.send).toHaveBeenCalledWith({ type: "restoreMeal", id: "x" });

        expand("x");
        const forever = card("x").querySelector('[data-action="delete-forever"]') as HTMLElement;
        const call = confirmCalls.find((x) => x.button === forever)!;
        expect(call.opts.armedLabel).toBe("Confirmer la suppression définitive ?");
        call.opts.onConfirm();
        expect(c.send).toHaveBeenLastCalledWith({ type: "deleteArchivedMeal", id: "x" });
      });
    });
  });

  describe("photos", () => {
    const withImages = (images: string[] = []) => sampleState({ meals: [makeMeal({ id: "m1", title: "Pâtes", images })] });
    const open = async (images: string[] = []) => {
      const c = await mount(withImages(images));
      expand("m1");
      return c;
    };
    const input = () => card("m1").querySelector('[data-action="image-input"]') as HTMLInputElement;
    const choose = (file: File | undefined) => {
      Object.defineProperty(input(), "files", { value: file ? [file] : [], configurable: true });
      input().dispatchEvent(new Event("change"));
    };
    const png = (size = 10, type = "image/png") => {
      const f = new File(["x"], "p.png", { type });
      Object.defineProperty(f, "size", { value: size });
      return f;
    };
    const field = () => card("m1").querySelector(".meal-image-field") as HTMLElement;

    it("galerie : miniatures échappées, boutons voir/supprimer, bouton d'ajout, accept des 4 formats", async () => {
      await open(["i1", "i2"]);
      const items = Array.from(card("m1").querySelectorAll(".meal-image-item"));
      expect(items.map((i) => i.getAttribute("data-image-id"))).toEqual(["i1", "i2"]);
      expect(items[0].querySelector("img")!.getAttribute("src")).toBe("/img/ABCDEF/m1/i1");
      expect(items[0].querySelector("img")!.getAttribute("alt")).toBe("Photo de « Pâtes »");
      expect(items[0].querySelector("img")!.getAttribute("loading")).toBe("lazy");
      expect(items[0].querySelector('[data-action="remove-image"]')!.getAttribute("aria-label")).toBe("Supprimer cette photo");
      expect(card("m1").querySelector('[data-action="add-image"]')!.textContent).toContain("Ajouter une photo");
      expect(input().getAttribute("accept")).toBe("image/png,image/jpeg,image/webp,image/gif");
      expect(input().hidden).toBe(true);
      expect(card("m1").querySelector(".meal-image-loading")!.hasAttribute("hidden")).toBe(true);
      expect(stray(".meal-image-gallery, .meal-image-field")).toEqual([]);
    });

    it("à la limite, plus de bouton d'ajout", async () => {
      await open(Array.from({ length: MAX_IMAGES_PER_MEAL }, (_, i) => `i${i}`));
      expect(card("m1").querySelector('[data-action="add-image"]')).toBeNull();
      await vi.advanceTimersByTimeAsync(0);
    });

    it("« Ajouter une photo » ouvre le sélecteur de fichier", async () => {
      await open();
      const click = vi.spyOn(input(), "click").mockImplementation(() => {});
      (card("m1").querySelector('[data-action="add-image"]') as HTMLElement).click();
      expect(click).toHaveBeenCalledOnce();
    });

    it("envoie le fichier : champ inerte et indicateur visibles pendant l'envoi, puis rétablis", async () => {
      let resolve!: () => void;
      uploadMealImage.mockReturnValue(new Promise<void>((r) => (resolve = r)));
      await open(["i1"]);
      const file = png();
      choose(file);
      expect(uploadMealImage).toHaveBeenCalledWith("ABCDEF", "m1", file);
      expect(field().classList.contains("is-loading")).toBe(true);
      expect(Array.from(field().querySelectorAll("button")).every((b) => b.disabled)).toBe(true);
      expect(card("m1").querySelector<HTMLElement>(".meal-image-loading")!.hidden).toBe(false);
      expect(input().value).toBe("");
      resolve();
      await vi.advanceTimersByTimeAsync(0);
      expect(field().classList.contains("is-loading")).toBe(false);
      expect(Array.from(field().querySelectorAll("button")).some((b) => b.disabled)).toBe(false);
      expect(card("m1").querySelector<HTMLElement>(".meal-image-loading")!.hidden).toBe(true);
    });

    it("annuler la sélection n'envoie rien", async () => {
      await open();
      choose(undefined);
      expect(uploadMealImage).not.toHaveBeenCalled();
    });

    it.each(["image/png", "image/jpeg", "image/webp", "image/gif"])("accepte %s", async (type) => {
      await open();
      choose(png(10, type));
      expect(uploadMealImage).toHaveBeenCalledOnce();
    });

    it("refuse un format non supporté, une image trop lourde (limite incluse) et un repas plein", async () => {
      await open();
      choose(png(10, "image/svg+xml"));
      expect(toastText()).toBe("Format d'image non supporté (PNG, JPEG, WebP ou GIF).");
      expect(uploadMealImage).not.toHaveBeenCalled();
      choose(png(5 * 1024 * 1024 + 1));
      expect(toastText()).toBe("Image trop volumineuse (5 Mo max).");
      expect(uploadMealImage).not.toHaveBeenCalled();
      choose(png(5 * 1024 * 1024));
      expect(uploadMealImage).toHaveBeenCalledOnce();
    });

    it("un repas déjà plein de photos refuse l'envoi (collage ou sélection)", async () => {
      await open(Array.from({ length: MAX_IMAGES_PER_MEAL }, (_, i) => `i${i}`));
      choose(png());
      expect(toastText()).toBe(`Maximum ${MAX_IMAGES_PER_MEAL} photos par repas.`);
      expect(uploadMealImage).not.toHaveBeenCalled();
    });

    it("un échec d'envoi affiche le message de l'API, ou un message générique, et rétablit le champ", async () => {
      uploadMealImage.mockRejectedValue(new FakeApiError("Trop de requêtes"));
      await open();
      choose(png());
      await vi.advanceTimersByTimeAsync(0);
      expect(toastText()).toBe("Trop de requêtes");
      expect(field().classList.contains("is-loading")).toBe(false);
      uploadMealImage.mockRejectedValue(new Error("réseau"));
      choose(png());
      await vi.advanceTimersByTimeAsync(0);
      expect(toastText()).toBe("Erreur réseau, réessaie.");
    });

    it("coller une image envoie le fichier ; le reste du presse-papiers est ignoré", async () => {
      await open();
      const paste = (items: unknown[] | undefined) => {
        const event = new Event("paste", { bubbles: true, cancelable: true }) as Event & { clipboardData?: unknown };
        event.clipboardData = items ? { items } : undefined;
        card("m1").dispatchEvent(event);
        return event;
      };
      const file = png();
      const event = paste([{ kind: "string", type: "text/plain" }, { kind: "file", type: "image/png", getAsFile: () => file }]);
      expect(event.defaultPrevented).toBe(true);
      expect(uploadMealImage).toHaveBeenCalledWith("ABCDEF", "m1", file);

      uploadMealImage.mockClear();
      expect(paste([{ kind: "file", type: "application/pdf", getAsFile: () => png() }]).defaultPrevented).toBe(false);
      expect(paste([{ kind: "string", type: "image/png", getAsFile: () => png() }]).defaultPrevented).toBe(false);
      expect(paste([{ kind: "file", type: "image/png", getAsFile: () => null }]).defaultPrevented).toBe(false);
      expect(paste(undefined).defaultPrevented).toBe(false);
      expect(uploadMealImage).not.toHaveBeenCalled();
    });

    it("coller sur une carte repliée envoie aussi la photo, sans erreur", async () => {
      await mount(withImages());
      const event = new Event("paste", { bubbles: true, cancelable: true }) as Event & { clipboardData?: unknown };
      event.clipboardData = { items: [{ kind: "file", type: "image/png", getAsFile: () => png() }] };
      expect(() => card("m1").dispatchEvent(event)).not.toThrow();
      await vi.advanceTimersByTimeAsync(0);
      expect(uploadMealImage).toHaveBeenCalledOnce();
    });

    it("supprimer une photo : confirmation en deux clics, indicateur, échec signalé", async () => {
      let resolve!: () => void;
      deleteMealImage.mockReturnValue(new Promise<void>((r) => (resolve = r)));
      await open(["i1", "i2"]);
      const btn = card("m1").querySelectorAll('[data-action="remove-image"]')[1] as HTMLElement;
      const call = confirmCalls.find((x) => x.button === btn)!;
      expect(call.opts.armedLabel).toBe("Confirmer la suppression ?");
      call.opts.onConfirm();
      expect(deleteMealImage).toHaveBeenCalledWith("ABCDEF", "m1", "i2");
      expect(field().classList.contains("is-loading")).toBe(true);
      resolve();
      await vi.advanceTimersByTimeAsync(0);
      expect(field().classList.contains("is-loading")).toBe(false);

      deleteMealImage.mockRejectedValue(new FakeApiError("Introuvable"));
      call.opts.onConfirm();
      await vi.advanceTimersByTimeAsync(0);
      expect(toastText()).toBe("Introuvable");
      deleteMealImage.mockRejectedValue(new Error("réseau"));
      call.opts.onConfirm();
      await vi.advanceTimersByTimeAsync(0);
      expect(toastText()).toBe("Erreur réseau, réessaie.");
    });

    describe("visionneuse", () => {
      const lightbox = () => document.querySelector(".image-lightbox-overlay") as HTMLElement | null;
      const view = (i: number) => (card("m1").querySelectorAll('[data-action="view-image"]')[i] as HTMLElement).click();

      it("ouvre la photo cliquée en plein écran (légende accessible), sans navigation pour une seule photo", async () => {
        await open(["i1"]);
        view(0);
        expect(lightbox()!.getAttribute("role")).toBe("dialog");
        expect(lightbox()!.getAttribute("aria-modal")).toBe("true");
        expect(lightbox()!.getAttribute("aria-label")).toBe("Photo de « Pâtes »");
        expect(lightbox()!.querySelector("img")!.getAttribute("src")).toBe("/img/ABCDEF/m1/i1");
        expect(lightbox()!.querySelector(".image-lightbox-close")!.getAttribute("aria-label")).toBe("Fermer");
        expect(lightbox()!.querySelector(".image-lightbox-prev")).toBeNull();
        expect(lightbox()!.querySelector(".image-lightbox-next")).toBeNull();
        expect(lightbox()!.querySelector(".image-lightbox-counter")).toBeNull();
        expect(stray(".image-lightbox-overlay")).toEqual([]);
        expect(document.activeElement).toBe(lightbox()!.querySelector(".image-lightbox-close"));
      });

      it("plusieurs photos : démarre sur la photo cliquée, navigue en boucle (boutons, flèches), compteur, focus sur le bouton utilisé", async () => {
        await open(["i1", "i2", "i3"]);
        view(1);
        const counter = () => lightbox()!.querySelector(".image-lightbox-counter")!.textContent;
        const src = () => lightbox()!.querySelector("img")!.getAttribute("src");
        expect([src(), counter()]).toEqual(["/img/ABCDEF/m1/i2", "2 / 3"]);
        expect(lightbox()!.querySelector(".image-lightbox-prev")!.getAttribute("aria-label")).toBe("Photo précédente");
        expect(lightbox()!.querySelector(".image-lightbox-next")!.getAttribute("aria-label")).toBe("Photo suivante");

        (lightbox()!.querySelector(".image-lightbox-next") as HTMLElement).click();
        expect([src(), counter()]).toEqual(["/img/ABCDEF/m1/i3", "3 / 3"]);
        expect(document.activeElement).toBe(lightbox()!.querySelector(".image-lightbox-next"));
        (lightbox()!.querySelector(".image-lightbox-next") as HTMLElement).click();
        expect([src(), counter()]).toEqual(["/img/ABCDEF/m1/i1", "1 / 3"]);
        (lightbox()!.querySelector(".image-lightbox-prev") as HTMLElement).click();
        expect([src(), counter()]).toEqual(["/img/ABCDEF/m1/i3", "3 / 3"]);
        expect(document.activeElement).toBe(lightbox()!.querySelector(".image-lightbox-prev"));
        expect(lightbox()).not.toBeNull();

        keydown("ArrowLeft");
        expect(src()).toBe("/img/ABCDEF/m1/i2");
        keydown("ArrowRight");
        keydown("ArrowRight");
        expect(src()).toBe("/img/ABCDEF/m1/i1");
        keydown("a");
        expect(lightbox()).not.toBeNull();
        expect(src()).toBe("/img/ABCDEF/m1/i1");
        expect(stray(".image-lightbox-overlay")).toEqual([]);
      });

      it("une seule photo : les flèches ne font rien", async () => {
        await open(["i1"]);
        view(0);
        keydown("ArrowRight");
        keydown("ArrowLeft");
        expect(lightbox()!.querySelector("img")!.getAttribute("src")).toBe("/img/ABCDEF/m1/i1");
      });

      it("se ferme au clic n'importe où, sur le bouton ou Échap (une seule fois), et rend le focus", async () => {
        await open(["i1"]);
        const trigger = card("m1").querySelector('[data-action="view-image"]') as HTMLElement;
        trigger.focus();
        trigger.click();
        lightbox()!.click();
        expect(lightbox()).toBeNull();
        expect(document.activeElement).toBe(trigger);

        trigger.click();
        (lightbox()!.querySelector(".image-lightbox-close") as HTMLElement).click();
        expect(lightbox()).toBeNull();

        trigger.click();
        keydown("Escape");
        keydown("Escape");
        expect(lightbox()).toBeNull();
      });

      it("retire son écouteur clavier à la fermeture", async () => {
        await open(["i1"]);
        view(0);
        const remove = vi.spyOn(document, "removeEventListener");
        lightbox()!.click();
        expect(remove.mock.calls.map(([t]) => t)).toContain("keydown");
      });
    });
  });

  describe("planning", () => {
    const monday = (offsetWeeks = 0) => {
      const d = new Date();
      const day = d.getDay();
      d.setDate(d.getDate() + (day === 0 ? -6 : 1 - day) + 7 * offsetWeeks);
      d.setHours(0, 0, 0, 0);
      return d;
    };
    const openPlanning = async (meals: Meal[] = []) => {
      const c = await mount(sampleState({ meals }));
      (root.querySelector('[data-tab="planning"]') as HTMLElement).click();
      return c;
    };
    const label = () => root.querySelector(".planning-week-label")!.textContent;
    const fr = (d: Date) => d.toLocaleDateString("fr-FR", { day: "numeric", month: "short" });

    it("grille de 7 jours de lundi à dimanche, semaine courante, jour d'aujourd'hui marqué", async () => {
      vi.setSystemTime(new Date(2026, 4, 13, 10)); // mercredi 13 mai 2026
      await openPlanning();
      expect(label()).toBe("Semaine du 11 mai");
      const days = Array.from(root.querySelectorAll(".planning-day"));
      expect(days.map((d) => d.querySelector(".planning-day-label")!.firstChild!.textContent!.trim())).toEqual(["Lundi", "Mardi", "Mercredi", "Jeudi", "Vendredi", "Samedi", "Dimanche"]);
      expect(days.map((d) => d.classList.contains("today"))).toEqual([false, false, true, false, false, false, false]);
      expect(days[0].querySelector(".planning-day-date")!.textContent).toBe("11 mai");
      expect(days[6].querySelector(".planning-day-date")!.textContent).toBe("17 mai");
      expect(root.querySelectorAll(".planning-entry-empty")).toHaveLength(7);
      expect(root.querySelector(".planning-entry-empty")!.textContent).toBe("—");
    });

    it("un dimanche appartient à la semaine qui commence le lundi précédent", async () => {
      vi.setSystemTime(new Date(2026, 4, 17, 10)); // dimanche
      await openPlanning();
      expect(label()).toBe("Semaine du 11 mai");
      expect(root.querySelectorAll(".planning-day")[6].classList.contains("today")).toBe(true);
    });

    it("liste les repas actifs planifiés ce jour-là (titre échappé), pas les autres ni l'historique", async () => {
      vi.setSystemTime(new Date(2026, 4, 13, 10));
      const ws = new Date(2026, 4, 11).getTime();
      await openPlanning([
        makeMeal({ id: "a", title: "<b>Lundi</b>", plannedDate: ws + 12 * 3600_000 }),
        makeMeal({ id: "b", title: "Dimanche", plannedDate: new Date(2026, 4, 17, 23, 59).getTime(), order: 1 }),
        makeMeal({ id: "c", title: "Hors semaine", plannedDate: new Date(2026, 4, 18, 0, 0).getTime(), order: 2 }),
        makeMeal({ id: "d", title: "Avant", plannedDate: ws - 1, order: 3 }),
        makeMeal({ id: "e", title: "Non planifié", order: 4 }),
      ]);
      const entries = Array.from(root.querySelectorAll(".planning-entry"));
      expect(entries.map((e) => e.querySelector(".planning-entry-title")!.textContent)).toEqual(["<b>Lundi</b>", "Dimanche"]);
      expect(root.querySelector(".planning-entry b")).toBeNull();
      expect(entries[0].querySelector('[data-action="unplan"]')!.getAttribute("aria-label")).toBe("Retirer « <b>Lundi</b> » du planning");
      expect(root.querySelectorAll(".planning-entry-empty")).toHaveLength(5);
    });

    it("navigation : semaine précédente/suivante, retour à aujourd'hui", async () => {
      vi.setSystemTime(new Date(2026, 4, 13, 10));
      await openPlanning();
      const prev = root.querySelector("#planning-prev") as HTMLElement;
      const next = root.querySelector("#planning-next") as HTMLElement;
      expect(prev.getAttribute("aria-label")).toBe("Semaine précédente");
      expect(next.getAttribute("aria-label")).toBe("Semaine suivante");
      (root.querySelector("#planning-prev") as HTMLElement).click();
      expect(label()).toBe("Semaine du 4 mai");
      expect(root.querySelector(".planning-day.today")).toBeNull();
      (root.querySelector("#planning-next") as HTMLElement).click();
      (root.querySelector("#planning-next") as HTMLElement).click();
      expect(label()).toBe("Semaine du 18 mai");
      (root.querySelector("#planning-today-btn") as HTMLElement).click();
      expect(label()).toBe("Semaine du 11 mai");
      expect(root.querySelector("#planning-today-btn")!.textContent).toBe("Aujourd'hui");
    });

    it("le planning se redessine à la réception d'un état", async () => {
      vi.setSystemTime(new Date(2026, 4, 13, 10));
      const c = await openPlanning();
      emitState(c, sampleState({ meals: [makeMeal({ id: "a", title: "Nouveau", plannedDate: new Date(2026, 4, 13, 12).getTime() })] }));
      expect(root.querySelector(".planning-entry-title")!.textContent).toBe("Nouveau");
    });

    it("retirer un repas du planning envoie un jour nul", async () => {
      vi.setSystemTime(new Date(2026, 4, 13, 10));
      const c = await openPlanning([makeMeal({ id: "a", title: "A", plannedDate: new Date(2026, 4, 12, 12).getTime() }), makeMeal({ id: "b", title: "B", plannedDate: new Date(2026, 4, 14, 12).getTime(), order: 1 })]);
      (root.querySelectorAll('[data-action="unplan"]')[1] as HTMLElement).click();
      expect(c.send).toHaveBeenCalledWith({ type: "setMealPlannedDate", id: "b", plannedDate: null });
    });

    it("revenir sur l'onglet des repas réaffiche la liste", async () => {
      await openPlanning([makeMeal({ id: "a", title: "A" })]);
      (root.querySelector('[data-tab="active"]') as HTMLElement).click();
      expect($("#meal-list").hidden).toBe(false);
      expect($("#planning-view").hidden).toBe(true);
      expect(titles()).toEqual(["A"]);
      void monday;
      void fr;
    });
  });

  describe("notifications", () => {
    const stubNotification = (permission: "default" | "granted" | "denied", requestResult: "granted" | "denied" | "default" = permission) => {
      const ctor = vi.fn();
      const N = Object.assign(ctor, { permission, requestPermission: vi.fn().mockResolvedValue(requestResult) });
      vi.stubGlobal("Notification", N);
      return N;
    };
    const btn = () => $("#notif-toggle-btn");

    it("indisponible (API absente) : bouton masqué, clic sans effet", async () => {
      await mount();
      expect(btn().hidden).toBe(true);
      expect(() => btn().click()).not.toThrow();
    });

    it("état initial : libellé, état marqué, infobulle par défaut", async () => {
      stubNotification("default");
      await mount();
      expect(btn().hidden).toBe(false);
      expect(btn().textContent).toBe("Activer les notifications");
      expect(btn().getAttribute("aria-pressed")).toBe("false");
      expect(btn().title).toBe("Prévient cet appareil d'un nouveau repas ou d'un changement de statut fait par un autre appareil, tant qu'un onglet de cette liste reste ouvert.");
    });

    it("permission déjà refusée : infobulle dédiée ; clic : message, menu fermé", async () => {
      stubNotification("denied");
      await mount();
      expect(btn().title).toBe("Bloquées par le navigateur : autorise-les dans ses réglages pour ce site.");
      openMenu();
      btn().click();
      await vi.advanceTimersByTimeAsync(0);
      expect(toastText()).toBe("Notifications bloquées : autorise-les dans les réglages du navigateur pour ce site.");
      expect($("#action-menu").hidden).toBe(true);
    });

    it("activer : demande la permission, mémorise, confirme, change le libellé, ferme le menu", async () => {
      const N = stubNotification("default", "granted");
      await mount();
      openMenu();
      btn().click();
      await vi.advanceTimersByTimeAsync(0);
      expect(N.requestPermission).toHaveBeenCalledOnce();
      expect(localStorage.getItem("omq:notifications")).toBe("true");
      expect(toastText()).toBe("Notifications activées pour cette liste.");
      expect($("#action-menu").hidden).toBe(true);
    });

    it("activer avec une permission déjà accordée : pas de nouvelle demande", async () => {
      const N = stubNotification("granted");
      await mount();
      btn().click();
      await vi.advanceTimersByTimeAsync(0);
      expect(N.requestPermission).not.toHaveBeenCalled();
      expect(localStorage.getItem("omq:notifications")).toBe("true");
      expect(btn().textContent).toBe("Désactiver les notifications");
      expect(btn().getAttribute("aria-pressed")).toBe("true");
    });

    it("permission refusée à la demande : préférence fausse, message dédié", async () => {
      stubNotification("default", "denied");
      await mount();
      btn().click();
      await vi.advanceTimersByTimeAsync(0);
      expect(localStorage.getItem("omq:notifications")).toBe("false");
      expect(toastText()).toBe("Notifications refusées.");
    });

    it("désactiver : préférence fausse, libellé rétabli, menu fermé, sans nouvelle demande", async () => {
      const N = stubNotification("granted");
      localStorage.setItem("omq:notifications", "true");
      await mount();
      expect(btn().textContent).toBe("Désactiver les notifications");
      openMenu();
      btn().click();
      await vi.advanceTimersByTimeAsync(0);
      expect(localStorage.getItem("omq:notifications")).toBe("false");
      expect(btn().textContent).toBe("Activer les notifications");
      expect($("#action-menu").hidden).toBe(true);
      expect(N.requestPermission).not.toHaveBeenCalled();
    });

    it("le clic ne remonte pas (le menu ne se referme pas deux fois)", async () => {
      stubNotification("granted");
      await mount();
      const onDoc = vi.fn();
      document.addEventListener("click", onDoc);
      btn().click();
      document.removeEventListener("click", onDoc);
      expect(onDoc).not.toHaveBeenCalled();
    });

    describe("réception d'un changement fait par un autre appareil", () => {
      const setup = async () => {
        const N = stubNotification("granted");
        localStorage.setItem("omq:notifications", "true");
        const c = await mount(sampleState({ meals: [makeMeal({ id: "a", title: "A" })] }));
        return { N, c };
      };

      it("le premier état reçu par WebSocket ne notifie jamais (simple synchronisation)", async () => {
        const { N, c } = await setup();
        emitState(c, sampleState({ meals: [makeMeal({ id: "a", title: "A" }), makeMeal({ id: "b", title: "B", order: 1 })] }));
        await vi.advanceTimersByTimeAsync(0);
        expect(N).not.toHaveBeenCalled();
      });

      it("un repas ajouté ailleurs : notification avec le nom de la liste, le texte, l'icône et un tag stable", async () => {
        const { N, c } = await setup();
        emitState(c, sampleState({ meals: [makeMeal({ id: "a", title: "A" })] }));
        emitState(c, sampleState({ name: "Semaine", meals: [makeMeal({ id: "a", title: "A" }), makeMeal({ id: "b", title: "Gratin", order: 1 })] }));
        await vi.advanceTimersByTimeAsync(0);
        expect(N).toHaveBeenCalledOnce();
        expect(N).toHaveBeenCalledWith("Semaine", { body: "Gratin a été ajouté à la liste.", icon: "/icon-192.png", tag: "ABCDEF-activity" });
      });

      it("un changement de statut ailleurs : notification avec le libellé du statut", async () => {
        const { N, c } = await setup();
        emitState(c, sampleState({ meals: [makeMeal({ id: "a", title: "A" })] }));
        emitState(c, sampleState({ meals: [makeMeal({ id: "a", title: "A", status: "commandee", updatedAt: 2 })] }));
        await vi.advanceTimersByTimeAsync(0);
        expect(N).toHaveBeenCalledWith("Semaine", expect.objectContaining({ body: "A : 🛒 Commandée" }));
      });

      it("sans notifications actives (préférence fausse, permission absente), rien n'est affiché", async () => {
        const N = stubNotification("granted");
        const c = await mount(sampleState({ meals: [makeMeal({ id: "a", title: "A" })] }));
        emitState(c, sampleState({ meals: [makeMeal({ id: "a" })] }));
        emitState(c, sampleState({ meals: [makeMeal({ id: "a" }), makeMeal({ id: "b", title: "B", order: 1 })] }));
        await vi.advanceTimersByTimeAsync(0);
        expect(N).not.toHaveBeenCalled();
      });

      it("passe par le service worker quand il y en a un", async () => {
        const { N, c } = await setup();
        const showNotification = vi.fn().mockResolvedValue(undefined);
        vi.stubGlobal("navigator", { ...navigator, serviceWorker: { getRegistration: () => Promise.resolve({ showNotification }) } });
        emitState(c, sampleState({ meals: [makeMeal({ id: "a", title: "A" })] }));
        emitState(c, sampleState({ meals: [makeMeal({ id: "a", title: "A" }), makeMeal({ id: "b", title: "B", order: 1 })] }));
        await vi.advanceTimersByTimeAsync(0);
        expect(showNotification).toHaveBeenCalledWith("Semaine", expect.objectContaining({ body: "B a été ajouté à la liste." }));
        expect(N).not.toHaveBeenCalled();
      });

      it("service worker sans enregistrement, ou qui échoue : repli sur le constructeur ; un constructeur qui lève est ignoré", async () => {
        const { N, c } = await setup();
        vi.stubGlobal("navigator", { ...navigator, serviceWorker: { getRegistration: () => Promise.resolve(undefined) } });
        emitState(c, sampleState({ meals: [makeMeal({ id: "a", title: "A" })] }));
        emitState(c, sampleState({ meals: [makeMeal({ id: "a", title: "A" }), makeMeal({ id: "b", title: "B", order: 1 })] }));
        await vi.advanceTimersByTimeAsync(0);
        expect(N).toHaveBeenCalledOnce();

        vi.stubGlobal("navigator", { ...navigator, serviceWorker: { getRegistration: () => Promise.reject(new Error("sw")) } });
        emitState(c, sampleState({ meals: [makeMeal({ id: "a", title: "A" }), makeMeal({ id: "b", title: "B", order: 1 }), makeMeal({ id: "c", title: "C", order: 2 })] }));
        await vi.advanceTimersByTimeAsync(0);
        expect(N).toHaveBeenCalledTimes(2);

        N.mockImplementation(() => {
          throw new Error("Illegal constructor");
        });
        emitState(c, sampleState({ meals: [makeMeal({ id: "a", title: "A" }), makeMeal({ id: "b", title: "B", order: 1 }), makeMeal({ id: "c", title: "C", order: 2 }), makeMeal({ id: "d", title: "D", order: 3 })] }));
        await expect(vi.advanceTimersByTimeAsync(0)).resolves.not.toThrow();
      });

      it("un service worker dont showNotification échoue : repli sur le constructeur", async () => {
        const { N, c } = await setup();
        vi.stubGlobal("navigator", { ...navigator, serviceWorker: { getRegistration: () => Promise.resolve({ showNotification: () => Promise.reject(new Error("x")) }) } });
        emitState(c, sampleState({ meals: [makeMeal({ id: "a", title: "A" })] }));
        emitState(c, sampleState({ meals: [makeMeal({ id: "a", title: "A" }), makeMeal({ id: "b", title: "B", order: 1 })] }));
        await vi.advanceTimersByTimeAsync(0);
        expect(N).toHaveBeenCalledOnce();
      });
    });
  });

  describe("réordonner par glisser-déposer", () => {
    it("configure SortableJS : poignée, éléments, glissé JS, animation, désactivé selon le tri", async () => {
      await mount(sampleState({ meals: [makeMeal({ id: "a" })] }));
      const s = sortable();
      expect(s.el).toBe($("#meal-list"));
      expect(s.opts.handle).toBe(".drag-handle");
      expect(s.opts.draggable).toBe(".meal-card");
      expect(s.opts.forceFallback).toBe(true);
      expect(s.opts.disabled).toBe(false);
      expect(s.opts.animation).toBe(150);
    });

    it("pas d'animation en mode accessibilité ni si le système réduit les animations", async () => {
      document.documentElement.setAttribute("data-a11y", "");
      await mount();
      expect(sortable().opts.animation).toBe(0);
      cleanup?.();
      document.documentElement.removeAttribute("data-a11y");
      vi.stubGlobal("matchMedia", vi.fn().mockReturnValue({ matches: true }));
      document.body.innerHTML = "";
      root = document.createElement("div");
      document.body.appendChild(root);
      await mount();
      expect(sortable().opts.animation).toBe(0);
    });

    it("interroge bien la préférence « réduire les animations »", async () => {
      await mount();
      expect(matchMedia).toHaveBeenCalledWith("(prefers-reduced-motion: reduce)");
    });

    const listWith = async () => {
      const c = await mount(sampleState({ meals: [makeMeal({ id: "a", title: "A", order: 0 }), makeMeal({ id: "b", title: "B", order: 1, later: true })] }));
      return c;
    };

    it("à la dépose : envoie l'ordre des cartes (hors en-têtes)", async () => {
      const c = await listWith();
      const list = $("#meal-list");
      const b = card("b");
      list.insertBefore(b, card("a"));
      sortable().opts.onStart();
      sortable().opts.onEnd({ item: b });
      expect(c.send).toHaveBeenCalledWith({ type: "reorderMeals", orderedIds: ["b", "a"] });
    });

    it("glisser sous l'en-tête « plus tard » change de section (avant le réordonnancement)", async () => {
      const c = await listWith();
      const list = $("#meal-list");
      const a = card("a");
      list.append(a); // a passe après l'en-tête « plus tard »
      sortable().opts.onEnd({ item: a });
      expect(c.send.mock.calls.map(([m]) => m)).toEqual([
        { type: "setMealLater", id: "a", later: true },
        { type: "reorderMeals", orderedIds: ["b", "a"] },
      ]);
    });

    it("remonter au-dessus de l'en-tête « plus tard » remet le repas dans la semaine", async () => {
      const c = await listWith();
      const b = card("b");
      $("#meal-list").insertBefore(b, $(".meal-section-header[data-section='later']"));
      sortable().opts.onEnd({ item: b });
      expect(c.send).toHaveBeenNthCalledWith(1, { type: "setMealLater", id: "b", later: false });
    });

    it("rester dans sa section n'envoie pas de changement de section", async () => {
      const c = await listWith();
      sortable().opts.onEnd({ item: card("a") });
      expect(c.send.mock.calls.map(([m]) => (m as { type: string }).type)).toEqual(["reorderMeals"]);
    });

    it("un élément glissé inconnu n'envoie que l'ordre", async () => {
      const c = await listWith();
      const ghost = document.createElement("li");
      ghost.dataset.id = "inconnu";
      $("#meal-list").append(ghost);
      sortable().opts.onEnd({ item: ghost });
      expect(c.send.mock.calls.map(([m]) => (m as { type: string }).type)).toEqual(["reorderMeals"]);
    });

    it("pendant un glissé, les mises à jour reçues ne reconstruisent pas la liste ; à la dépose, elles s'appliquent", async () => {
      const c = await listWith();
      sortable().opts.onStart();
      emitState(c, sampleState({ meals: [makeMeal({ id: "a", title: "A" }), makeMeal({ id: "b", title: "B", order: 1, later: true }), makeMeal({ id: "c", title: "C", order: 2 })] }));
      expect(card("c")).toBeNull();
      sortable().opts.onEnd({ item: card("a") });
      emitState(c, sampleState({ meals: [makeMeal({ id: "a", title: "A" }), makeMeal({ id: "c", title: "C", order: 2 })] }));
      expect(card("c")).not.toBeNull();
    });
  });

  describe("toasts et nettoyage", () => {
    it("un toast disparaît au bout de 5 s ; un nouveau remplace l'ancien et ne subit pas son minuteur", async () => {
      const c = await mount();
      c.emit("error", "Un");
      expect(document.querySelector("#list-toast")!.getAttribute("role")).toBe("status");
      expect(document.querySelector("#list-toast")!.className).toBe("list-toast");
      expect(document.querySelector("#list-toast button")).toBeNull();
      vi.advanceTimersByTime(3000);
      c.emit("error", "Deux");
      expect(document.querySelectorAll("#list-toast")).toHaveLength(1);
      vi.advanceTimersByTime(3000);
      expect(toastText()).toBe("Deux");
      vi.advanceTimersByTime(1999);
      expect(toastText()).toBe("Deux");
      vi.advanceTimersByTime(1);
      expect(document.querySelector("#list-toast")).toBeNull();
    });

    it("le bouton « Annuler » exécute l'action et ferme le toast", async () => {
      const c = await mount(sampleState({ name: "Semaine" }));
      const title = $("#list-title");
      title.click();
      findEdit(title).opts.onCommit("Autre");
      const undo = document.querySelector("#list-toast button")!;
      expect(undo.textContent).toBe("Annuler");
      expect(undo.getAttribute("type")).toBe("button");
      (undo as HTMLElement).click();
      expect(c.send).toHaveBeenLastCalledWith({ type: "renameList", name: "Semaine" });
      expect(document.querySelector("#list-toast")).toBeNull();
    });

    it("le texte du toast n'est pas interprété comme du HTML", async () => {
      const c = await mount();
      c.emit("error", "<b>x</b>");
      expect(document.querySelector("#list-toast b")).toBeNull();
      expect(toastText()).toBe("<b>x</b>");
    });

    it("le nettoyage déconnecte, retire le toast et l'écouteur global", async () => {
      const c = await mount();
      c.emit("error", "x");
      const remove = vi.spyOn(document, "removeEventListener");
      cleanup!();
      cleanup = undefined;
      expect(c.disconnect).toHaveBeenCalledOnce();
      expect(document.querySelector("#list-toast")).toBeNull();
      expect(remove.mock.calls.map(([t]) => t)).toContain("click");
    });

    it("un nettoyage avant le premier rendu ne plante pas", () => {
      fetchListState.mockReturnValue(new Promise(() => {}));
      const stop = mountListView(root, "ABCDEF", navigate);
      expect(() => stop()).not.toThrow();
    });
  });

  describe("détails (mutation)", () => {
    const meals3 = () =>
      sampleState({
        meals: [makeMeal({ id: "a", title: "A", order: 0 }), makeMeal({ id: "b", title: "B", order: 1 })],
        archive: [archived({ id: "x", title: "Xavier", note: "mouais" }), archived({ id: "y", title: "Yann", prepTime: "normal", note: "quand_tu_veux" })],
      });

    it("une source http:// (non sécurisée) reste un lien", async () => {
      await mount(sampleState({ meals: [makeMeal({ id: "a", source: "http://x.fr" })] }));
      expand("a");
      expect(card("a").querySelector(".meal-source a")!.getAttribute("href")).toBe("http://x.fr");
    });

    it("aucun texte parasite dans les sélecteurs, filtres, statistiques et planning", async () => {
      await mount(meals3());
      expand("a");
      expect(stray(".status-picker, .preptime-picker, #filter-status-pills, #filter-preptime-pills, .meal-field, .meal-details, .meal-planning-row, .meal-planned-date-row, .meal-card")).toEqual([]);
      (root.querySelector('[data-tab="archive"]') as HTMLElement).click();
      $("#stats-toggle-btn").click();
      expect(stray("#stats-panel, .stats-group, .stats-list, #meal-list")).toEqual([]);
      (root.querySelector('[data-tab="planning"]') as HTMLElement).click();
      expect(stray(".planning-grid, .planning-day, .planning-entries, .planning-view, #planning-view")).toEqual([]);
    });

    it("aucun attribut ni texte parasite sur les cartes (repliée, dépliée, historique)", async () => {
      await mount(meals3());
      expect(card("a").getAttributeNames().sort()).toEqual(["class", "data-id", "data-rev", "data-status"]);
      expect(card("a").querySelector('[data-action="toggle"]')!.getAttributeNames().sort()).toEqual(["aria-expanded", "aria-label", "class", "data-action", "title", "type"]);
      expand("a");
      expect(card("a").querySelector('[data-action="planned-date"]')!.getAttributeNames().sort()).toEqual(["class", "data-action", "id", "type"]);
      (root.querySelector('[data-tab="archive"]') as HTMLElement).click();
      expect(card("x").getAttributeNames().sort()).toEqual(["class", "data-id", "data-note", "data-rev"]);
      expect(card("x").querySelector('[data-action="toggle"]')!.getAttributeNames().sort()).toEqual(["aria-expanded", "aria-label", "class", "data-action", "type"]);
      expand("x");
      expect(stray(".meal-card, .meal-details, .meal-field, .meal-details-actions, .meal-controls")).toEqual([]);
    });

    it("jour prévu : la date est la valeur du champ, absent : champ sans valeur", async () => {
      await mount(sampleState({ meals: [makeMeal({ id: "a", plannedDate: new Date(2026, 5, 2, 12).getTime() }), makeMeal({ id: "b", order: 1 })] }));
      expand("a");
      expand("b");
      expect(card("a").querySelector('[data-action="planned-date"]')!.getAttribute("value")).toBe("2026-06-02");
      expect(card("b").querySelector('[data-action="planned-date"]')!.hasAttribute("value")).toBe(false);
    });

    it("sélecteurs : états exacts (note, temps, planification, filtres)", async () => {
      await mount(sampleState({ meals: [makeMeal({ id: "a", note: "mouais", prepTime: "normal", later: true })] }));
      expand("a");
      expect(Array.from(card("a").querySelectorAll(".preptime-pill")).map((b) => b.getAttribute("aria-pressed"))).toEqual(["false", "false", "true", "false"]);
      expect(Array.from(card("a").querySelectorAll(".later-pill")).map((b) => [b.textContent, b.getAttribute("aria-pressed")])).toEqual([["📅 Pour la semaine", "false"], ["⏳ Pour plus tard", "true"]]);
      (card("a").querySelector('.status-pill[data-status="fait"]') as HTMLElement).click();
      const pressed = Array.from(document.querySelectorAll(".note-option")).map((b) => b.getAttribute("aria-pressed"));
      expect(pressed).toEqual(["false", "false", "true", "false", "false", "false"]);
      expect(stray(".note-picker, .modal, .modal-field")).toEqual([]);
    });

    it("onglets : états, cartes d'ajout et de recherche, boutons tri/filtre selon l'onglet", async () => {
      await mount(meals3());
      const tabState = () => Array.from(root.querySelectorAll(".tab-btn")).map((b) => b.getAttribute("aria-pressed"));
      const hiddenState = () => [$("#add-meal-card").hidden, $("#search-card").hidden, $("#sort-toggle-btn").hidden, $("#filter-toggle-btn").hidden];
      expect(tabState()).toEqual(["true", "false", "false"]);
      expect(hiddenState()).toEqual([false, true, false, false]);
      (root.querySelector('[data-tab="archive"]') as HTMLElement).click();
      expect(tabState()).toEqual(["false", "false", "true"]);
      expect(hiddenState()).toEqual([true, false, true, true]);
      (root.querySelector('[data-tab="planning"]') as HTMLElement).click();
      expect(tabState()).toEqual(["false", "true", "false"]);
      expect(hiddenState()).toEqual([true, true, true, true]);
      (root.querySelector('[data-tab="active"]') as HTMLElement).click();
      expect(tabState()).toEqual(["true", "false", "false"]);
      expect(hiddenState()).toEqual([false, true, false, false]);
    });

    it("le panneau de filtres reste ouvert quand on reclique l'onglet des repas", async () => {
      await mount(meals3());
      $("#filter-toggle-btn").click();
      (root.querySelector('[data-tab="active"]') as HTMLElement).click();
      expect($("#filter-panel").hidden).toBe(false);
      expect($("#filter-toggle-btn").getAttribute("aria-pressed")).toBe("true");
    });

    it("le menu repasse en aria-expanded « false » après une action", async () => {
      await mount(meals3());
      openMenu();
      $("#sort-toggle-btn").click();
      expect($("#menu-toggle-btn").getAttribute("aria-expanded")).toBe("false");
    });

    it("réinitialisation : visible avec un seul type de filtre actif, masquée sinon", async () => {
      await mount(meals3());
      (root.querySelector('.filter-preptime-pill[data-preptime="long"]') as HTMLElement).click();
      expect($("#filter-reset-btn").hidden).toBe(false);
      (root.querySelector('.filter-preptime-pill[data-preptime="long"]') as HTMLElement).click();
      expect($("#filter-reset-btn").hidden).toBe(true);
      (root.querySelector('.filter-status-pill[data-status="idee"]') as HTMLElement).click();
      expect($("#filter-reset-btn").hidden).toBe(false);
      (root.querySelector("#filter-reset-btn") as HTMLElement).click();
      expect(Array.from(root.querySelectorAll(".filter-status-pill")).every((b) => b.getAttribute("aria-pressed") === "false")).toBe(true);
    });

    it("liste vide : « tout déplier » reste « Tout déplier » et ne fait rien ; la liste est vidée du DOM", async () => {
      const c = await mount(meals3());
      expect(card("a")).not.toBeNull();
      emitState(c, sampleState());
      expect($("#meal-list").innerHTML).toBe("");
      expect($("#toggle-all-btn").textContent).toBe("Tout déplier");
      $("#toggle-all-btn").click();
      expect($("#toggle-all-btn").textContent).toBe("Tout déplier");
    });

    it("historique vide avec une recherche d'espaces : message de l'historique vide", async () => {
      await mount(sampleState());
      (root.querySelector('[data-tab="archive"]') as HTMLElement).click();
      const search = $<HTMLInputElement>("#archive-search");
      search.value = "   ";
      search.dispatchEvent(new Event("input"));
      expect($("#empty-message").textContent).toBe("Aucun repas dans l'historique pour le moment.");
    });

    it("les statistiques ne se recalculent pas hors de l'historique", async () => {
      const c = await mount(meals3());
      (root.querySelector('[data-tab="archive"]') as HTMLElement).click();
      $("#stats-toggle-btn").click();
      const before = $("#stats-panel").innerHTML;
      (root.querySelector('[data-tab="active"]') as HTMLElement).click();
      emitState(c, sampleState({ meals: meals3().meals, archive: [archived({ id: "z", title: "Zoé" })] }));
      expect($("#stats-panel").innerHTML).toBe(before);
    });

    it("notifications : actives seulement avec la permission ET la préférence", async () => {
      const N = Object.assign(vi.fn(), { permission: "default" as string, requestPermission: vi.fn() });
      vi.stubGlobal("Notification", N);
      localStorage.setItem("omq:notifications", "true");
      await mount();
      expect($("#notif-toggle-btn").textContent).toBe("Activer les notifications");
      expect($("#notif-toggle-btn").getAttribute("aria-pressed")).toBe("false");
    });

    it("le menu de notifications ne ferme pas le panneau de partage ouvert (clic isolé dans le menu)", async () => {
      vi.stubGlobal("Notification", Object.assign(vi.fn(), { permission: "granted", requestPermission: vi.fn() }));
      await mount();
      openMenu();
      $("#btn-share").click();
      expect($("#share-panel").hidden).toBe(false);
    });

    it("lien figé reçu : réécrit l'URL sans le paramètre", async () => {
      const payload = { name: "Reçue", meals: [makeMeal({ id: "x", title: "Importé" })], archive: [] };
      history.replaceState({}, "", `/l/ABCDEF?import=${encodeURIComponent(encodeSnapshotToParam(payload))}`);
      const replace = vi.spyOn(history, "replaceState");
      await mount();
      expect(replace).toHaveBeenCalledWith({}, "", "/l/ABCDEF");
    });

    it("restaurer depuis l'historique ou une suggestion ne notifie pas son propre repas", async () => {
      vi.stubGlobal("Notification", Object.assign(vi.fn(), { permission: "granted" }));
      localStorage.setItem("omq:notifications", "true");
      const c = await mount(sampleState({ archive: [archived({ id: "x", title: "Xavier" }), archived({ id: "y", title: "Yann" })] }));
      emitState(c, sampleState({ archive: [archived({ id: "x", title: "Xavier" }), archived({ id: "y", title: "Yann" })] }));
      (root.querySelector('[data-tab="archive"]') as HTMLElement).click();
      (card("x").querySelector('[data-action="restore"]') as HTMLElement).click();
      emitState(c, sampleState({ meals: [makeMeal({ id: "x", title: "Xavier" })], archive: [archived({ id: "y", title: "Yann" })] }));
      (root.querySelector('[data-tab="active"]') as HTMLElement).click();
      const input = $<HTMLInputElement>("#add-title");
      input.value = "yann";
      input.dispatchEvent(new Event("input"));
      (root.querySelector(".add-suggestion") as HTMLElement).click();
      emitState(c, sampleState({ meals: [makeMeal({ id: "x", title: "Xavier" }), makeMeal({ id: "y", title: "Yann", order: 1 })] }));
      await vi.advanceTimersByTimeAsync(0);
      expect(Notification).not.toHaveBeenCalled();
    });

    it("effacer le jour prévu envoie un jour nul", async () => {
      const c = await mount(sampleState({ meals: [makeMeal({ id: "a", plannedDate: new Date(2026, 5, 2, 12).getTime() })] }));
      expand("a");
      c.send.mockClear();
      (card("a").querySelector('[data-action="clear-planned-date"]') as HTMLElement).click();
      expect(c.send.mock.calls).toEqual([[{ type: "setMealPlannedDate", id: "a", plannedDate: null }]]);
    });

    it("un repas actif n'a pas de suppression définitive ; les suggestions gardent le focus", async () => {
      await mount(meals3());
      expand("a");
      expect(confirmCalls.filter((x) => x.button.getAttribute("data-action") === "delete-forever")).toHaveLength(0);
    });

    it("un jour prévu à minuit pile appartient à ce jour", async () => {
      vi.setSystemTime(new Date(2026, 4, 13, 10));
      const c = await mount(sampleState({ meals: [makeMeal({ id: "a", title: "Minuit", plannedDate: new Date(2026, 4, 11, 0, 0).getTime() })] }));
      void c;
      (root.querySelector('[data-tab="planning"]') as HTMLElement).click();
      expect(root.querySelector(".planning-entry-title")!.textContent).toBe("Minuit");
    });

    it("lien figé : l'URL du QR pointe vers la racine, sous-chemin de déploiement compris", async () => {
      vi.stubEnv("BASE_URL", "/omq/");
      vi.resetModules();
      const { mountListView: mountWithBase } = await import("./list");
      fetchListState.mockResolvedValue(sampleState());
      cleanup = mountWithBase(root, "ABCDEF", navigate);
      await vi.advanceTimersByTimeAsync(0);
      $("#btn-snapshot-link").click();
      await vi.advanceTimersByTimeAsync(0);
      const url = renderQrSvg.mock.calls[renderQrSvg.mock.calls.length - 1][0] as string;
      expect(new URL(url).pathname).toBe("/omq/");
      vi.unstubAllEnvs();
    });

    it("la visionneuse : fermeture rend le focus (import) et retire son écouteur clavier", async () => {
      await mount(meals3());
      const remove = vi.spyOn(document, "removeEventListener");
      openMenu();
      const trigger = $("#btn-import");
      parseImportFile.mockResolvedValue({ name: "", meals: [], archive: [] });
      trigger.focus();
      const input = $("#import-file-input") as HTMLInputElement;
      Object.defineProperty(input, "files", { value: [new File(["x"], "a.json")], configurable: true });
      input.dispatchEvent(new Event("change"));
      await vi.advanceTimersByTimeAsync(0);
      (document.querySelector(".modal-close") as HTMLElement).click();
      expect(document.activeElement).toBe(trigger);
      expect(remove.mock.calls.map(([t]) => t)).toContain("keydown");
    });

    it("la modale « fait » retire son écouteur clavier à la fermeture", async () => {
      await mount(meals3());
      expand("a");
      const remove = vi.spyOn(document, "removeEventListener");
      (card("a").querySelector('.status-pill[data-status="fait"]') as HTMLElement).click();
      (document.querySelector("#mark-done-cancel") as HTMLElement).click();
      expect(remove.mock.calls.map(([t]) => t)).toContain("keydown");
    });
  });

  describe("derniers détails (mutation)", () => {
    const statsOf = async (archive: Meal[]) => {
      await mount(sampleState({ archive }));
      (root.querySelector('[data-tab="archive"]') as HTMLElement).click();
      $("#stats-toggle-btn").click();
    };

    it("statistiques sans notes : seuls temps et plus refaits ; sans texte parasite, listes de plusieurs lignes", async () => {
      await statsOf([
        archived({ id: "1", title: "A", prepTime: "rapide" }),
        archived({ id: "2", title: "A", prepTime: "long" }),
        archived({ id: "3", title: "B", prepTime: "long" }),
        archived({ id: "4", title: "B", prepTime: "rapide" }),
      ]);
      expect(Array.from(root.querySelectorAll("#stats-panel h3")).map((h) => h.textContent)).toEqual(["Par temps de préparation", "Les plus refaits"]);
      expect(stray("#stats-panel, .stats-group, .stats-list")).toEqual([]);
      expect(root.querySelectorAll("#stats-panel .stats-list li")).toHaveLength(4);
    });

    it("statistiques sans temps : seules notes ; sans texte parasite", async () => {
      await statsOf([archived({ id: "1", title: "A", note: "mouais" }), archived({ id: "2", title: "B", note: "quand_tu_veux" })]);
      expect(Array.from(root.querySelectorAll("#stats-panel h3")).map((h) => h.textContent)).toEqual(["Par note"]);
      expect(stray("#stats-panel, .stats-group, .stats-list")).toEqual([]);
    });

    it("planning : plusieurs repas le même jour, sans texte parasite", async () => {
      vi.setSystemTime(new Date(2026, 4, 13, 10));
      await mount(sampleState({ meals: [makeMeal({ id: "a", title: "A", plannedDate: new Date(2026, 4, 13, 12).getTime() }), makeMeal({ id: "b", title: "B", order: 1, plannedDate: new Date(2026, 4, 13, 13).getTime() })] }));
      (root.querySelector('[data-tab="planning"]') as HTMLElement).click();
      expect(root.querySelectorAll(".planning-entry")).toHaveLength(2);
      expect(stray(".planning-entries, .planning-day, .planning-grid")).toEqual([]);
    });

    it("modale « fait » : les autres notes repassent à « false » exactement", async () => {
      await mount(sampleState({ meals: [makeMeal({ id: "a", note: "mouais" })] }));
      expand("a");
      (card("a").querySelector('.status-pill[data-status="fait"]') as HTMLElement).click();
      (document.querySelector('.note-option[data-note="quand_tu_veux"]') as HTMLElement).click();
      const states = Array.from(document.querySelectorAll(".note-option")).map((b) => b.getAttribute("aria-pressed"));
      expect(states).toEqual(["false", "false", "false", "false", "false", "true"]);
    });

    it("import : la fermeture rend le focus à l'élément qui l'avait avant l'ouverture", async () => {
      await mount(sampleState());
      openMenu();
      const trigger = $("#btn-import");
      parseImportFile.mockResolvedValue({ name: "", meals: [], archive: [] });
      trigger.focus();
      const input = $("#import-file-input") as HTMLInputElement;
      Object.defineProperty(input, "files", { value: [new File(["x"], "a.json")], configurable: true });
      input.dispatchEvent(new Event("change"));
      await vi.advanceTimersByTimeAsync(0);
      (document.querySelector("#import-cancel") as HTMLElement).focus();
      expect(document.activeElement).not.toBe(trigger);
      (document.querySelector("#import-cancel") as HTMLElement).click();
      expect(document.activeElement).toBe(trigger);
    });

    it("photos à la limite : sans texte parasite ; cartes actives et historique sans attribut ni texte parasite", async () => {
      await mount(sampleState({ meals: [makeMeal({ id: "a", images: Array.from({ length: MAX_IMAGES_PER_MEAL }, (_, i) => `i${i}`) })], archive: [archived({ id: "x", note: null })] }));
      expand("a");
      expect(stray(".meal-image-field, .meal-image-gallery, .meal-controls, .meal-main")).toEqual([]);
      (root.querySelector('[data-tab="archive"]') as HTMLElement).click();
      expect(card("x").getAttributeNames().sort()).toEqual(["class", "data-id", "data-rev"]);
    });

    it("suggestions : requête recadrée, et le champ garde le focus (sans nouvel évènement) après un choix ou un ajout", async () => {
      const c = await mount(sampleState({ archive: [archived({ id: "h1", title: "Riz" })] }));
      const input = $<HTMLInputElement>("#add-title");
      input.focus();
      input.value = "  riz ";
      input.dispatchEvent(new Event("input"));
      expect(root.querySelectorAll(".add-suggestion")).toHaveLength(1);
      (root.querySelector(".add-suggestion") as HTMLElement).click();
      expect($("#add-suggestions").hidden).toBe(true);
      expect(c.send).toHaveBeenCalledWith({ type: "restoreMeal", id: "h1" });

      input.value = "";
      input.dispatchEvent(new Event("input"));
      input.value = "riz";
      input.dispatchEvent(new Event("input"));
      expect($("#add-suggestions").hidden).toBe(false);
      $("#add-form").dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
      expect($("#add-suggestions").hidden).toBe(true);
    });
  });
});

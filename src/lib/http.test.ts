// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, createList, deleteMealImage, fetchListState, mealImageUrl, uploadMealImage } from "./http";
import type { ListState } from "../../shared/types";

const sampleState: ListState = { code: "ABCDEF", name: "Semaine", meals: [], archive: [], createdAt: 0, updatedAt: 0 };

afterEach(() => {
  vi.unstubAllGlobals();
});

const failing = (status: number, body: unknown) => ({ ok: false, status, json: () => (body instanceof Error ? Promise.reject(body) : Promise.resolve(body)) });

describe("createList", () => {
  it("poste le nom et renvoie la liste créée", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve(sampleState) });
    vi.stubGlobal("fetch", fetchMock);
    await expect(createList("Semaine")).resolves.toEqual(sampleState);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/lists",
      expect.objectContaining({ method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: "Semaine" }) }),
    );
  });

  it("erreur ApiError : message du serveur, sinon message par défaut", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(failing(429, { error: "Trop de listes" })));
    const err = await createList("x").catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err.message).toBe("Trop de listes");

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(failing(500, {})));
    await expect(createList("x")).rejects.toThrow("Impossible de créer la liste.");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(failing(500, new Error("pas du json"))));
    await expect(createList("x")).rejects.toThrow("Impossible de créer la liste.");
  });
});

describe("fetchListState", () => {
  it("renvoie l'état, avec le code encodé dans l'URL", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, json: () => Promise.resolve(sampleState) });
    vi.stubGlobal("fetch", fetchMock);
    await expect(fetchListState("A B/C")).resolves.toEqual(sampleState);
    expect(fetchMock).toHaveBeenCalledWith("/api/lists/A%20B%2FC");
  });

  it("renvoie null pour un code inconnu (404)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 404 }));
    await expect(fetchListState("ZZZZZZ")).resolves.toBeNull();
  });

  it("autre échec : ApiError avec le message du serveur, sinon « Erreur réseau. »", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(failing(429, { error: "Doucement" })));
    const err = await fetchListState("A").catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err.message).toBe("Doucement");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(failing(500, {})));
    await expect(fetchListState("A")).rejects.toThrow("Erreur réseau.");
  });
});

describe("mealImageUrl", () => {
  it("construit l'URL permanente de la photo, encodée", () => {
    expect(mealImageUrl("ABCDEF", "m1", "img-1")).toBe("/api/lists/ABCDEF/meals/m1/images/img-1");
    expect(mealImageUrl("A B", "m/1", "i d")).toBe("/api/lists/A%20B/meals/m%2F1/images/i%20d");
  });
});

describe("uploadMealImage", () => {
  it("envoie le fichier en POST avec son content-type", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetchMock);
    const file = new Blob(["x"], { type: "image/png" });
    await uploadMealImage("ABCDEF", "m1", file);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/lists/ABCDEF/meals/m1/images",
      expect.objectContaining({ method: "POST", headers: { "content-type": "image/png" }, body: file }),
    );
  });

  it("échec : ApiError (message du serveur, sinon par défaut)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(failing(413, { error: "Trop gros" })));
    const err = await uploadMealImage("A", "m", new Blob(["x"])).catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err.message).toBe("Trop gros");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(failing(500, {})));
    await expect(uploadMealImage("A", "m", new Blob(["x"]))).rejects.toThrow("Impossible d'envoyer l'image.");
  });
});

describe("deleteMealImage", () => {
  it("envoie un DELETE sur la photo", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetchMock);
    await deleteMealImage("ABCDEF", "m1", "img-1");
    expect(fetchMock).toHaveBeenCalledWith("/api/lists/ABCDEF/meals/m1/images/img-1", { method: "DELETE" });
  });

  it("échec : ApiError (message du serveur, sinon par défaut)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(failing(404, { error: "Introuvable" })));
    const err = await deleteMealImage("A", "m", "i").catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err.message).toBe("Introuvable");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(failing(500, {})));
    await expect(deleteMealImage("A", "m", "i")).rejects.toThrow("Impossible de supprimer l'image.");
  });
});

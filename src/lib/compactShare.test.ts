import { describe, it, expect } from "vitest";
import * as LZString from "lz-string";
import { encodeSnapshotToParam, decodeSnapshotFromParam } from "./compactShare";
import type { Meal } from "../../shared/types";
import { MAX_TITLE_LENGTH, MAX_SOURCE_LENGTH, MAX_COMMENT_LENGTH, MAX_LIST_NAME_LENGTH } from "../../shared/types";
import type { ImportPayload } from "./importExport";

function makeMeal(overrides: Partial<Meal> = {}): Meal {
  return {
    id: "m",
    title: "Repas",
    status: "idee",
    note: null,
    source: "",
    comment: "",
    order: 0,
    createdAt: 111,
    updatedAt: 222,
    doneAt: null,
    images: [],
    prepTime: null,
    plannedDate: null,
    ...overrides,
  };
}

describe("encodeSnapshotToParam / decodeSnapshotFromParam", () => {
  it("fait un aller-retour fidèle sur les champs transportés (hors id/order/images)", () => {
    const payload: ImportPayload = {
      name: "Ma liste",
      meals: [
        makeMeal({
          title: "Tartiflette",
          status: "validee",
          note: "quand_tu_veux",
          source: "https://exemple.fr",
          comment: "Un commentaire",
          createdAt: 1000,
          updatedAt: 2000,
          doneAt: 3000,
          prepTime: "rapide",
          plannedDate: 4000,
          images: ["ignoré"],
        }),
      ],
      archive: [makeMeal({ title: "Raclette", status: "fait" })],
    };
    const decoded = decodeSnapshotFromParam(encodeSnapshotToParam(payload));
    expect(decoded).not.toBeNull();
    expect(decoded!.name).toBe("Ma liste");
    expect(decoded!.meals).toHaveLength(1);
    const meal = decoded!.meals[0];
    expect(meal.title).toBe("Tartiflette");
    expect(meal.status).toBe("validee");
    expect(meal.note).toBe("quand_tu_veux");
    expect(meal.source).toBe("https://exemple.fr");
    expect(meal.comment).toBe("Un commentaire");
    expect(meal.createdAt).toBe(1000);
    expect(meal.updatedAt).toBe(2000);
    expect(meal.doneAt).toBe(3000);
    expect(meal.prepTime).toBe("rapide");
    expect(meal.plannedDate).toBe(4000);
    // Jamais transportées : régénérées/vidées au décodage.
    expect(meal.id).toBe("");
    expect(meal.images).toEqual([]);
    expect(decoded!.archive).toHaveLength(1);
    expect(decoded!.archive[0].title).toBe("Raclette");
  });

  it("omet les champs optionnels par défaut/vides, retombant sur des valeurs neutres au décodage", () => {
    const payload: ImportPayload = { name: "L", meals: [makeMeal()], archive: [] };
    const decoded = decodeSnapshotFromParam(encodeSnapshotToParam(payload))!;
    const meal = decoded.meals[0];
    expect(meal.note).toBeNull();
    expect(meal.source).toBe("");
    expect(meal.comment).toBe("");
    expect(meal.doneAt).toBeNull();
    expect(meal.prepTime).toBeNull();
    expect(meal.plannedDate).toBeNull();
  });

  it("retombe sur idee/valeurs par défaut si le JSON décompressé contient des champs invalides", () => {
    const json = JSON.stringify({
      n: "L",
      m: [{ t: "Repas", s: "statut-invalide", n: "note-invalide", o: 1, c: null, cr: "x", u: "x", d: "x", p: "invalide", pd: "x" }],
      a: [],
    });
    // Réencode "à la main" un JSON invalide (plutôt que de passer par
    // encodeSnapshotToParam, qui ne produit jamais de champs invalides) pour
    // exercer la revalidation du décodage face à un lien altéré/forgé.
    const param = LZString.compressToEncodedURIComponent(json);
    const decoded = decodeSnapshotFromParam(param)!;
    const meal = decoded.meals[0];
    expect(meal.status).toBe("idee");
    expect(meal.note).toBeNull();
    expect(meal.source).toBe("");
    expect(meal.comment).toBe("");
    expect(typeof meal.createdAt).toBe("number");
    expect(typeof meal.updatedAt).toBe("number");
    expect(meal.doneAt).toBeNull();
    expect(meal.prepTime).toBeNull();
    expect(meal.plannedDate).toBeNull();
  });

  it("tronque un titre décodé trop long à MAX_TITLE_LENGTH", () => {
    const json = JSON.stringify({ n: "L", m: [{ t: "T".repeat(MAX_TITLE_LENGTH + 10), s: "idee", cr: 1, u: 1 }], a: [] });
    const param = LZString.compressToEncodedURIComponent(json);
    const decoded = decodeSnapshotFromParam(param)!;
    expect(decoded.meals[0].title).toHaveLength(MAX_TITLE_LENGTH);
  });

  it("tronque une source/un commentaire décodés trop longs", () => {
    const json = JSON.stringify({
      n: "L",
      m: [{ t: "T", s: "idee", o: "O".repeat(MAX_SOURCE_LENGTH + 10), c: "C".repeat(MAX_COMMENT_LENGTH + 10), cr: 1, u: 1 }],
      a: [],
    });
    const param = LZString.compressToEncodedURIComponent(json);
    const decoded = decodeSnapshotFromParam(param)!;
    expect(decoded.meals[0].source).toHaveLength(MAX_SOURCE_LENGTH);
    expect(decoded.meals[0].comment).toHaveLength(MAX_COMMENT_LENGTH);
  });

  it("tronque le nom décodé trop long à MAX_LIST_NAME_LENGTH", () => {
    const json = JSON.stringify({ n: "N".repeat(MAX_LIST_NAME_LENGTH + 10), m: [], a: [] });
    const param = LZString.compressToEncodedURIComponent(json);
    const decoded = decodeSnapshotFromParam(param)!;
    expect(decoded.name).toHaveLength(MAX_LIST_NAME_LENGTH);
  });

  it("retombe sur une chaîne vide si le nom décodé n'est pas une chaîne", () => {
    const json = JSON.stringify({ n: 42, m: [], a: [] });
    const param = LZString.compressToEncodedURIComponent(json);
    const decoded = decodeSnapshotFromParam(param)!;
    expect(decoded.name).toBe("");
  });

  it("retombe sur un titre vide si le titre décodé n'est pas une chaîne", () => {
    const json = JSON.stringify({ n: "L", m: [{ t: 42, s: "idee", cr: 1, u: 1 }], a: [] });
    const param = LZString.compressToEncodedURIComponent(json);
    const decoded = decodeSnapshotFromParam(param)!;
    expect(decoded.meals[0].title).toBe("");
  });
});

describe("decodeSnapshotFromParam: entrées invalides", () => {
  it("renvoie null pour une chaîne vide", () => {
    expect(decodeSnapshotFromParam("")).toBeNull();
  });

  it("renvoie null si la décompression échoue (paramètre corrompu)", () => {
    expect(decodeSnapshotFromParam("!!!pas-un-param-lz-string-valide!!!")).toBeNull();
  });

  it("renvoie null si le JSON décompressé n'est pas un objet ou lève au parsing", () => {
    const param = LZString.compressToEncodedURIComponent("pas du JSON");
    expect(decodeSnapshotFromParam(param)).toBeNull();
  });

  it("renvoie null si `m` n'est pas un tableau", () => {
    const param = LZString.compressToEncodedURIComponent(JSON.stringify({ n: "L", m: "pas un tableau", a: [] }));
    expect(decodeSnapshotFromParam(param)).toBeNull();
  });

  it("renvoie null si `a` n'est pas un tableau", () => {
    const param = LZString.compressToEncodedURIComponent(JSON.stringify({ n: "L", m: [], a: "pas un tableau" }));
    expect(decodeSnapshotFromParam(param)).toBeNull();
  });
});

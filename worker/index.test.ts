import { describe, it, expect, vi } from "vitest";
import worker from "./index";

type Env = Parameters<typeof worker.fetch>[1];
type IncomingRequest = Parameters<typeof worker.fetch>[0];
type FetchArg = string | Request;
type FakeHandler = (code: string, input: FetchArg, init?: RequestInit) => Promise<Response> | Response;

// workers-types attend une `Request<CfProperties>` entrante (avec les champs
// propres à Cloudflare), alors qu'on fabrique une `Request` sortante simple :
// même objet à l'exécution, types incompatibles — ce helper fait le pont.
function req(url: string, init?: RequestInit): IncomingRequest {
  return new Request(url, init) as unknown as IncomingRequest;
}

async function readJson(res: Response): Promise<Record<string, unknown>> {
  return (await res.json()) as Record<string, unknown>;
}

function makeNamespace(handler: FakeHandler): Env["MEAL_ROOM"] {
  const namespace = {
    idFromName: (name: string) => name,
    get: (id: string) => ({ fetch: (input: FetchArg, init?: RequestInit) => handler(id, input, init) }),
    idFromString: (id: string) => id,
    newUniqueId: () => "unique",
    jurisdiction: () => namespace,
  };
  return namespace as unknown as Env["MEAL_ROOM"];
}

const pathOf = (input: FetchArg): string => new URL(typeof input === "string" ? input : input.url).pathname;

interface FakeR2Object {
  body: BodyInit;
  httpMetadata?: { contentType?: string };
}

function makeBucket(initial: Record<string, FakeR2Object> = {}) {
  const store = { ...initial };
  const bucket = {
    get: async (key: string) => store[key] ?? null,
    put: async (key: string, bytes: ArrayBuffer, opts?: { httpMetadata?: { contentType?: string } }) => {
      store[key] = { body: bytes, httpMetadata: opts?.httpMetadata };
    },
    delete: async (key: string) => {
      delete store[key];
    },
  };
  return { bucket: bucket as unknown as Env["MEAL_IMAGES"], store };
}

function limiter(success = true) {
  const limit = vi.fn(async () => ({ success }));
  return { limiter: { limit } as unknown as Env["READ_LIST_RATE_LIMITER"], limit };
}

function makeEnv(
  handler: FakeHandler,
  opts: {
    assetsFetch?: (request: Request) => Promise<Response> | Response;
    bucket?: Env["MEAL_IMAGES"];
    create?: Env["CREATE_LIST_RATE_LIMITER"];
    read?: Env["READ_LIST_RATE_LIMITER"];
    imageWrite?: Env["IMAGE_WRITE_RATE_LIMITER"];
  } = {},
): Env {
  return {
    MEAL_ROOM: makeNamespace(handler),
    ASSETS: { fetch: opts.assetsFetch ?? (() => new Response("asset", { status: 200 })) },
    MEAL_IMAGES: opts.bucket ?? makeBucket().bucket,
    CREATE_LIST_RATE_LIMITER: opts.create ?? limiter().limiter,
    READ_LIST_RATE_LIMITER: opts.read ?? limiter().limiter,
    IMAGE_WRITE_RATE_LIMITER: opts.imageWrite ?? limiter().limiter,
  } as unknown as Env;
}

const emptyState = (code: string) => ({ code, name: "Ma liste", meals: [], archive: [], createdAt: 0, updatedAt: 0 });
const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, PUT, DELETE, OPTIONS",
  "access-control-allow-headers": "content-type",
};

describe("CORS (préflight)", () => {
  it("répond 204 avec les en-têtes CORS à OPTIONS /api/...", async () => {
    const res = await worker.fetch(req("https://app.example/api/lists", { method: "OPTIONS" }), makeEnv(() => new Response("x")));
    expect(res.status).toBe(204);
    for (const [k, v] of Object.entries(CORS)) expect(res.headers.get(k)).toBe(v);
    expect(await res.text()).toBe("");
  });

  it("ne traite pas OPTIONS hors de /api/ (assets)", async () => {
    const res = await worker.fetch(req("https://app.example/page", { method: "OPTIONS" }), makeEnv(() => new Response("x")));
    expect(await res.text()).toBe("asset");
  });
});

describe("POST /api/lists (création)", () => {
  const free: FakeHandler = (code, input) => {
    if (pathOf(input) === "/state") return new Response("not found", { status: 404 });
    if (pathOf(input) === "/init") return Response.json(emptyState(code));
    throw new Error(`unexpected path ${pathOf(input)}`);
  };

  it("crée une liste : code de 6 caractères lisibles, nom transmis, JSON + CORS", async () => {
    const seen: Array<{ code: string; path: string; init?: RequestInit }> = [];
    const handler: FakeHandler = (code, input, init) => {
      seen.push({ code, path: pathOf(input), init });
      return free(code, input, init);
    };
    const res = await worker.fetch(req("https://app.example/api/lists", { method: "POST", body: JSON.stringify({ name: "Ma liste" }) }), makeEnv(handler));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/json");
    for (const [k, v] of Object.entries(CORS)) expect(res.headers.get(k)).toBe(v);
    const body = await readJson(res);
    expect(body.code).toMatch(/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$/);

    const init = seen.find((s) => s.path === "/init")!;
    expect(init.code).toBe(body.code);
    expect(init.init?.method).toBe("POST");
    expect(init.init?.headers).toEqual({ "content-type": "application/json" });
    expect(JSON.parse(init.init!.body as string)).toEqual({ code: body.code, name: "Ma liste" });
  });

  it("tolère un corps absent ou invalide", async () => {
    for (const body of [undefined, "pas du json"]) {
      const res = await worker.fetch(req("https://app.example/api/lists", { method: "POST", body }), makeEnv(free));
      expect(res.status).toBe(200);
    }
  });

  it("réessaie avec un autre code si le premier est déjà pris, jusqu'à 5 essais", async () => {
    const tried: string[] = [];
    const handler: FakeHandler = (code, input) => {
      if (pathOf(input) === "/state") {
        tried.push(code);
        return tried.length < 3 ? new Response("{}", { status: 200 }) : new Response("nf", { status: 404 });
      }
      return Response.json(emptyState(code));
    };
    const res = await worker.fetch(req("https://app.example/api/lists", { method: "POST" }), makeEnv(handler));
    expect(res.status).toBe(200);
    expect(tried).toHaveLength(3);
    expect(new Set(tried).size).toBeGreaterThan(1);
    expect((await readJson(res)).code).toBe(tried[2]);
  });

  it("5 collisions de suite : 503 avec message, sans rien créer", async () => {
    let inits = 0;
    let states = 0;
    const handler: FakeHandler = (code, input) => {
      if (pathOf(input) === "/state") {
        states++;
        return new Response("{}", { status: 200 });
      }
      inits++;
      return Response.json(emptyState(code));
    };
    const res = await worker.fetch(req("https://app.example/api/lists", { method: "POST" }), makeEnv(handler));
    expect(res.status).toBe(503);
    expect((await readJson(res)).error).toBe("Impossible de générer un code de liste unique, réessaie.");
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
    expect(states).toBe(5);
    expect(inits).toBe(0);
  });

  it("limite le débit par IP quand l'en-tête existe : 429 si dépassé, sinon passe avec la clé IP", async () => {
    const blocked = limiter(false);
    const res = await worker.fetch(req("https://app.example/api/lists", { method: "POST", headers: { "CF-Connecting-IP": "1.2.3.4" } }), makeEnv(free, { create: blocked.limiter }));
    expect(res.status).toBe(429);
    expect((await readJson(res)).error).toBe("Trop de listes créées récemment, réessaie dans une minute.");
    expect(blocked.limit).toHaveBeenCalledWith({ key: "1.2.3.4" });

    const ok = limiter(true);
    const res2 = await worker.fetch(req("https://app.example/api/lists", { method: "POST", headers: { "CF-Connecting-IP": "1.2.3.4" } }), makeEnv(free, { create: ok.limiter }));
    expect(res2.status).toBe(200);
    expect(ok.limit).toHaveBeenCalledOnce();
  });

  it("sans en-tête IP, aucun limiteur n'est consulté", async () => {
    const l = limiter(false);
    const res = await worker.fetch(req("https://app.example/api/lists", { method: "POST" }), makeEnv(free, { create: l.limiter }));
    expect(res.status).toBe(200);
    expect(l.limit).not.toHaveBeenCalled();
  });
});

describe("GET /api/lists/:code", () => {
  it("renvoie l'état de la liste (code normalisé en majuscules, JSON + CORS)", async () => {
    const seen: string[] = [];
    const handler: FakeHandler = (code, input) => {
      seen.push(`${code}${pathOf(input)}`);
      return Response.json(emptyState(code));
    };
    const res = await worker.fetch(req("https://app.example/api/lists/abc123"), makeEnv(handler));
    expect(res.status).toBe(200);
    expect(seen).toEqual(["ABC123/state"]);
    expect(res.headers.get("content-type")).toBe("application/json");
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
  });

  it("transmet le statut de la liste (404 inconnue)", async () => {
    const res = await worker.fetch(req("https://app.example/api/lists/ABC123"), makeEnv(() => new Response("{}", { status: 404 })));
    expect(res.status).toBe(404);
  });

  it("accepte des codes de 4 à 10 caractères, pas plus ni moins", async () => {
    const env = makeEnv((code) => Response.json(emptyState(code)));
    expect((await worker.fetch(req("https://app.example/api/lists/ABCD"), env)).status).toBe(200);
    expect((await worker.fetch(req("https://app.example/api/lists/ABCDEFGHIJ"), env)).status).toBe(200);
    expect((await worker.fetch(req("https://app.example/api/lists/ABC"), env)).status).toBe(404);
    expect((await worker.fetch(req("https://app.example/api/lists/ABCDEFGHIJK"), env)).status).toBe(404);
  });

  it("limite le débit par IP : 429 avec message si dépassé", async () => {
    const l = limiter(false);
    const res = await worker.fetch(req("https://app.example/api/lists/ABC123", { headers: { "CF-Connecting-IP": "9.9.9.9" } }), makeEnv(() => new Response("{}"), { read: l.limiter }));
    expect(res.status).toBe(429);
    expect((await readJson(res)).error).toBe("Trop de tentatives, réessaie dans une minute.");
    expect(l.limit).toHaveBeenCalledWith({ key: "9.9.9.9" });
  });

  it("une autre méthode que GET sur la liste retombe sur 404 API", async () => {
    const res = await worker.fetch(req("https://app.example/api/lists/ABC123", { method: "DELETE" }), makeEnv(() => new Response("{}")));
    expect(res.status).toBe(404);
  });
});

describe("WebSocket /api/lists/:code/ws", () => {
  it("transmet la requête telle quelle à la salle, sans CORS", async () => {
    const forwarded: Request[] = [];
    const handler: FakeHandler = (_code, input) => {
      forwarded.push(input as Request);
      return new Response("ws", { status: 200 });
    };
    const request = req("https://app.example/api/lists/abc123/ws", { headers: { upgrade: "websocket" } });
    const res = await worker.fetch(request, makeEnv(handler));
    expect(forwarded).toHaveLength(1);
    expect(forwarded[0]).toBe(request);
    expect(await res.text()).toBe("ws");
  });

  it("limite aussi le débit par IP", async () => {
    const l = limiter(false);
    const res = await worker.fetch(req("https://app.example/api/lists/ABC123/ws", { headers: { "CF-Connecting-IP": "1.1.1.1" } }), makeEnv(() => new Response("ws"), { read: l.limiter }));
    expect(res.status).toBe(429);
  });
});

describe("images : POST /api/lists/:code/meals/:id/images", () => {
  const url = "https://app.example/api/lists/abc123/meals/m1/images";
  const post = (body: BodyInit, headers: Record<string, string> = { "content-type": "image/png" }) => req(url, { method: "POST", body, headers });
  const applyHandler = (seen: Array<{ code: string; path: string; body?: unknown }>): FakeHandler => (code, input, init) => {
    seen.push({ code, path: pathOf(input), body: init?.body ? JSON.parse(init.body as string) : undefined });
    return Response.json(emptyState(code));
  };

  it("stocke l'image dans R2 (clé à 3 segments, type conservé) et l'applique à la liste", async () => {
    const { bucket, store } = makeBucket();
    const seen: Array<{ code: string; path: string; body?: unknown }> = [];
    const res = await worker.fetch(post(new Uint8Array([1, 2, 3])), makeEnv(applyHandler(seen), { bucket }));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/json");
    const keys = Object.keys(store);
    expect(keys).toHaveLength(1);
    expect(keys[0]).toMatch(/^meals\/ABC123\/m1\/[0-9a-f-]{36}$/);
    expect(store[keys[0]].httpMetadata).toEqual({ contentType: "image/png" });
    const imageId = keys[0].split("/")[3];
    expect(seen).toEqual([{ code: "ABC123", path: "/apply", body: { type: "addMealImage", id: "m1", imageId } }]);
  });

  it("accepte les 4 formats d'image, refuse les autres (415)", async () => {
    for (const type of ["image/png", "image/jpeg", "image/webp", "image/gif"]) {
      const res = await worker.fetch(post(new Uint8Array([1]), { "content-type": type }), makeEnv(applyHandler([])));
      expect(res.status).toBe(200);
    }
    for (const type of ["image/svg+xml", "text/html", ""]) {
      const res = await worker.fetch(post(new Uint8Array([1]), type ? { "content-type": type } : {}), makeEnv(applyHandler([])));
      expect(res.status).toBe(415);
      expect((await readJson(res)).error).toBe("Format d'image non supporté.");
    }
  });

  it("refuse une image déclarée trop grosse (413) sans la lire, et une image réellement trop grosse", async () => {
    const tooBig = 5 * 1024 * 1024 + 1;
    const { bucket, store } = makeBucket();
    const declared = await worker.fetch(post(new Uint8Array([1]), { "content-type": "image/png", "content-length": String(tooBig) }), makeEnv(applyHandler([]), { bucket }));
    expect(declared.status).toBe(413);
    expect((await readJson(declared)).error).toBe("Image trop volumineuse (5 Mo max).");

    const real = await worker.fetch(post(new Uint8Array(tooBig)), makeEnv(applyHandler([]), { bucket }));
    expect(real.status).toBe(413);
    expect(Object.keys(store)).toHaveLength(0);
  });

  it("accepte une image d'exactement 5 Mo, déclarée ou non", async () => {
    const exact = 5 * 1024 * 1024;
    const { bucket, store } = makeBucket();
    const res = await worker.fetch(post(new Uint8Array(exact), { "content-type": "image/png", "content-length": String(exact) }), makeEnv(applyHandler([]), { bucket }));
    expect(res.status).toBe(200);
    expect(Object.keys(store)).toHaveLength(1);
  });

  it("limite le débit d'écriture par IP : 429, rien n'est stocké", async () => {
    const l = limiter(false);
    const { bucket, store } = makeBucket();
    const res = await worker.fetch(
      req(url, { method: "POST", body: new Uint8Array([1]), headers: { "content-type": "image/png", "CF-Connecting-IP": "5.5.5.5" } }),
      makeEnv(applyHandler([]), { bucket, imageWrite: l.limiter }),
    );
    expect(res.status).toBe(429);
    expect((await readJson(res)).error).toBe("Trop de tentatives, réessaie dans une minute.");
    expect(l.limit).toHaveBeenCalledWith({ key: "5.5.5.5" });
    expect(Object.keys(store)).toHaveLength(0);
  });
});

describe("images : /api/lists/:code/meals/:id/images/:imageId", () => {
  const imageUrl = "https://app.example/api/lists/abc123/meals/m1/images/img-1";

  it("GET sert l'image avec son type, un cache long immuable, nosniff et CORS", async () => {
    const { bucket } = makeBucket({ "meals/ABC123/m1/img-1": { body: "octets", httpMetadata: { contentType: "image/png" } } });
    const res = await worker.fetch(req(imageUrl), makeEnv(() => new Response("{}"), { bucket }));
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("octets");
    expect(res.headers.get("content-type")).toBe("image/png");
    expect(res.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
  });

  it("GET sans type enregistré : application/octet-stream ; absente : 404", async () => {
    const { bucket } = makeBucket({ "meals/ABC123/m1/img-1": { body: "x" } });
    const res = await worker.fetch(req(imageUrl), makeEnv(() => new Response("{}"), { bucket }));
    expect(res.headers.get("content-type")).toBe("application/octet-stream");
    const missing = await worker.fetch(req("https://app.example/api/lists/abc123/meals/m1/images/autre"), makeEnv(() => new Response("{}"), { bucket }));
    expect(missing.status).toBe(404);
    expect(missing.headers.get("access-control-allow-origin")).toBe("*");
  });

  it("une image historique (id = id du repas) est lue à son ancienne clé à 2 segments", async () => {
    const { bucket } = makeBucket({ "meals/ABC123/m1": { body: "ancienne", httpMetadata: { contentType: "image/jpeg" } } });
    const res = await worker.fetch(req("https://app.example/api/lists/abc123/meals/m1/images/m1"), makeEnv(() => new Response("{}"), { bucket }));
    expect(await res.text()).toBe("ancienne");
  });

  it("GET limite le débit de lecture par IP", async () => {
    const l = limiter(false);
    const res = await worker.fetch(req(imageUrl, { headers: { "CF-Connecting-IP": "2.2.2.2" } }), makeEnv(() => new Response("{}"), { read: l.limiter }));
    expect(res.status).toBe(429);
    expect(l.limit).toHaveBeenCalledWith({ key: "2.2.2.2" });
  });

  it("DELETE retire l'objet R2 et l'image de la liste", async () => {
    const { bucket, store } = makeBucket({ "meals/ABC123/m1/img-1": { body: "x" }, "meals/ABC123/m1/img-2": { body: "y" } });
    const seen: Array<{ code: string; path: string; body: unknown }> = [];
    const handler: FakeHandler = (code, input, init) => {
      seen.push({ code, path: pathOf(input), body: JSON.parse(init!.body as string) });
      return Response.json(emptyState(code));
    };
    const res = await worker.fetch(req(imageUrl, { method: "DELETE" }), makeEnv(handler, { bucket }));
    expect(res.status).toBe(200);
    expect(Object.keys(store)).toEqual(["meals/ABC123/m1/img-2"]);
    expect(seen).toEqual([{ code: "ABC123", path: "/apply", body: { type: "removeMealImage", id: "m1", imageId: "img-1" } }]);
  });

  it("DELETE limite le débit d'écriture par IP, sans rien supprimer", async () => {
    const l = limiter(false);
    const { bucket, store } = makeBucket({ "meals/ABC123/m1/img-1": { body: "x" } });
    const res = await worker.fetch(req(imageUrl, { method: "DELETE", headers: { "CF-Connecting-IP": "3.3.3.3" } }), makeEnv(() => new Response("{}"), { bucket, imageWrite: l.limiter }));
    expect(res.status).toBe(429);
    expect(l.limit).toHaveBeenCalledWith({ key: "3.3.3.3" });
    expect(Object.keys(store)).toHaveLength(1);
  });

  it("une autre méthode : 405 avec CORS", async () => {
    const res = await worker.fetch(req(imageUrl, { method: "PUT" }), makeEnv(() => new Response("{}")));
    expect(res.status).toBe(405);
    expect(await res.text()).toBe("Method not allowed");
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
  });

  it("POST sur une route à image précise n'est pas une création : 405", async () => {
    const res = await worker.fetch(req(imageUrl, { method: "POST" }), makeEnv(() => new Response("{}")));
    expect(res.status).toBe(405);
  });
});

describe("routes restantes", () => {
  it("une route /api/ inconnue : 404 avec CORS", async () => {
    const res = await worker.fetch(req("https://app.example/api/inconnu"), makeEnv(() => new Response("{}")));
    expect(res.status).toBe(404);
    expect(await res.text()).toBe("Not found");
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
  });

  it("les identifiants de repas et d'image invalides ne matchent pas les routes d'images", async () => {
    const env = makeEnv(() => new Response("{}"));
    const bad = await worker.fetch(req(`https://app.example/api/lists/abc123/meals/${"a".repeat(65)}/images`, { method: "POST", body: "x", headers: { "content-type": "image/png" } }), env);
    expect(bad.status).toBe(404);
    const bad2 = await worker.fetch(req(`https://app.example/api/lists/abc123/meals/m1/images/${"a".repeat(65)}`), env);
    expect(bad2.status).toBe(404);
  });

  it("tout le reste est servi par les assets statiques", async () => {
    const assets = vi.fn(async () => new Response("page"));
    const res = await worker.fetch(req("https://app.example/l/ABC123"), makeEnv(() => new Response("{}"), { assetsFetch: assets }));
    expect(await res.text()).toBe("page");
    expect(assets).toHaveBeenCalledOnce();
  });
});

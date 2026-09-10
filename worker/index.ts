import { MealRoom } from "./mealRoom";

export { MealRoom };

interface Env {
  MEAL_ROOM: DurableObjectNamespace<MealRoom>;
  ASSETS: Fetcher;
  CREATE_LIST_RATE_LIMITER: RateLimit;
}

// Ambiguous characters (0/O, 1/I) are excluded so codes are easy to read aloud
// or copy from a screen.
const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function generateCode(length = 6): string {
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  let out = "";
  for (let i = 0; i < length; i++) {
    out += CODE_CHARS[bytes[i] % CODE_CHARS.length];
  }
  return out;
}

function normalizeCode(code: string): string {
  return code.trim().toUpperCase();
}

// Autorise l'appel depuis une origine différente (client servi par GitHub
// Pages, Worker sur un domaine *.workers.dev distinct) : sans ces en-têtes,
// le navigateur bloquerait les requêtes JSON avant même qu'elles partent.
// Sans objet pour la connexion WebSocket (jamais soumise au CORS/preflight
// par les navigateurs), donc pas ajoutés sur cette route.
const CORS_HEADERS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, OPTIONS",
  "access-control-allow-headers": "content-type",
};

async function jsonPassthrough(res: Response): Promise<Response> {
  return new Response(res.body, {
    status: res.status,
    headers: { "content-type": "application/json", ...CORS_HEADERS },
  });
}

function jsonError(message: string, status: number): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { "content-type": "application/json", ...CORS_HEADERS },
  });
}

export default {
  async fetch(request, env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname.startsWith("/api/") && request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    if (url.pathname === "/api/lists" && request.method === "POST") {
      // Pas d'authentification pour créer une liste : sans ça, un script
      // pourrait en créer en boucle (coût de stockage, Durable Objects
      // orphelines). L'IP n'identifie pas la personne de façon fiable (NAT,
      // proxy, IPv6 tournant), juste de quoi limiter le débit d'un même
      // point d'origine. Cet en-tête n'existe qu'une fois passé par le réseau
      // Cloudflare (absent en dev local et dans les tests e2e) : pas de
      // valeur de repli qui regrouperait tout le monde sous une même clé,
      // ce qui bloquerait tout le monde à la moindre rafale légitime.
      const ip = request.headers.get("CF-Connecting-IP");
      if (ip) {
        const { success } = await env.CREATE_LIST_RATE_LIMITER.limit({ key: ip });
        if (!success) {
          return jsonError("Trop de listes créées récemment, réessaie dans une minute.", 429);
        }
      }

      const body = await request
        .json<{ name?: string }>()
        .catch(() => ({}) as { name?: string });

      let code = generateCode();
      let codeIsFree = false;
      for (let attempt = 0; attempt < 5; attempt++) {
        const stub = env.MEAL_ROOM.get(env.MEAL_ROOM.idFromName(code));
        const existing = await stub.fetch("https://list.internal/state");
        if (existing.status === 404) {
          codeIsFree = true;
          break;
        }
        code = generateCode();
      }
      // Ne devrait jamais arriver (33^6 codes possibles) : évite de renvoyer
      // par erreur la liste de quelqu'un d'autre si les 5 tentatives ont
      // toutes collisionné, plutôt que de continuer avec un code qui n'est
      // pas réellement libre.
      if (!codeIsFree) {
        return jsonError("Impossible de générer un code de liste unique, réessaie.", 503);
      }

      const stub = env.MEAL_ROOM.get(env.MEAL_ROOM.idFromName(code));
      const res = await stub.fetch("https://list.internal/init", {
        method: "POST",
        body: JSON.stringify({ code, name: body.name }),
        headers: { "content-type": "application/json" },
      });
      return jsonPassthrough(res);
    }

    const listMatch = url.pathname.match(/^\/api\/lists\/([A-Za-z0-9]{4,10})(\/ws)?$/);
    if (listMatch) {
      const code = normalizeCode(listMatch[1]);
      const isWs = Boolean(listMatch[2]);
      const stub = env.MEAL_ROOM.get(env.MEAL_ROOM.idFromName(code));

      if (isWs) {
        // Forward the original request untouched: the WebSocket upgrade
        // handshake relies on headers the runtime attaches internally.
        return stub.fetch(request);
      }

      if (request.method === "GET") {
        const res = await stub.fetch("https://list.internal/state");
        return jsonPassthrough(res);
      }
    }

    if (url.pathname.startsWith("/api/")) {
      return new Response("Not found", { status: 404, headers: CORS_HEADERS });
    }

    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;

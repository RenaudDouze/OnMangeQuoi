import { MealRoom } from "./mealRoom";
import { ALLOWED_IMAGE_TYPES, MAX_IMAGE_BYTES } from "../shared/types";

export { MealRoom };

interface Env {
  MEAL_ROOM: DurableObjectNamespace<MealRoom>;
  ASSETS: Fetcher;
  CREATE_LIST_RATE_LIMITER: RateLimit;
  READ_LIST_RATE_LIMITER: RateLimit;
  IMAGE_WRITE_RATE_LIMITER: RateLimit;
  MEAL_IMAGES: R2Bucket;
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

// Avant les photos multiples, une image vivait à la clé 2 segments
// `meals/<code>/<mealId>` (une seule par repas). La migration (voir
// migrateMealImages dans worker/reducer.ts) réutilise l'id du repas comme id
// de cette image plutôt que de la copier vers une nouvelle clé — ce helper
// reconnaît ce cas particulier (imageId === mealId) et retrouve l'objet à son
// ancien emplacement, sans déplacement de données R2.
function mealImageKey(code: string, mealId: string, imageId: string): string {
  if (imageId === mealId) return `meals/${code}/${mealId}`;
  return `meals/${code}/${mealId}/${imageId}`;
}

// Autorise l'appel depuis une origine différente (client servi par GitHub
// Pages, Worker sur un domaine *.workers.dev distinct) : sans ces en-têtes,
// le navigateur bloquerait les requêtes JSON avant même qu'elles partent.
// Sans objet pour la connexion WebSocket (jamais soumise au CORS/preflight
// par les navigateurs), donc pas ajoutés sur cette route.
const CORS_HEADERS = {
  "access-control-allow-origin": "*",
  // PUT/DELETE : ajoutés pour la route image (voir plus bas). Sans eux, le
  // préflight CORS autorise la requête mais le navigateur bloque ensuite la
  // vraie requête PUT/DELETE en cross-origin (échec silencieux côté fetch,
  // sans réponse HTTP à lire — d'où un simple "Erreur réseau" côté client).
  "access-control-allow-methods": "GET, POST, PUT, DELETE, OPTIONS",
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
      // Même logique que pour la création (voir plus haut) : lire l'état
      // d'une liste ou s'y connecter ne demande pas d'authentification, donc
      // limiter le débit par IP dissuade un script d'essayer des codes en
      // boucle pour en deviner un valide.
      const ip = request.headers.get("CF-Connecting-IP");
      if (ip) {
        const { success } = await env.READ_LIST_RATE_LIMITER.limit({ key: ip });
        if (!success) {
          return jsonError("Trop de tentatives, réessaie dans une minute.", 429);
        }
      }

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

    // Liste des photos d'un repas : POST pour en envoyer une nouvelle (id
    // généré côté serveur).
    const imagesMatch = url.pathname.match(/^\/api\/lists\/([A-Za-z0-9]{4,10})\/meals\/([A-Za-z0-9_-]{1,64})\/images$/);
    if (imagesMatch && request.method === "POST") {
      const code = normalizeCode(imagesMatch[1]);
      const mealId = imagesMatch[2];

      const ip = request.headers.get("CF-Connecting-IP");
      if (ip) {
        const { success } = await env.IMAGE_WRITE_RATE_LIMITER.limit({ key: ip });
        if (!success) {
          return jsonError("Trop de tentatives, réessaie dans une minute.", 429);
        }
      }

      const contentType = request.headers.get("content-type") ?? "";
      if (!(ALLOWED_IMAGE_TYPES as readonly string[]).includes(contentType)) {
        return jsonError("Format d'image non supporté.", 415);
      }
      // Vérifie d'abord l'en-tête (rejet rapide sans lire le corps), puis
      // la taille réelle une fois lue : l'en-tête n'est qu'une déclaration
      // du client, pas une garantie.
      const declaredLength = Number(request.headers.get("content-length") ?? "0");
      if (declaredLength > MAX_IMAGE_BYTES) {
        return jsonError("Image trop volumineuse (5 Mo max).", 413);
      }
      const bytes = await request.arrayBuffer();
      if (bytes.byteLength > MAX_IMAGE_BYTES) {
        return jsonError("Image trop volumineuse (5 Mo max).", 413);
      }

      // Un id frais et permanent, jamais réutilisé pour un contenu différent
      // (voir Meal.images dans shared/types.ts) : plus besoin de numéro de
      // version pour invalider le cache navigateur.
      const imageId = crypto.randomUUID();
      const key = mealImageKey(code, mealId, imageId);
      await env.MEAL_IMAGES.put(key, bytes, { httpMetadata: { contentType } });

      const stub = env.MEAL_ROOM.get(env.MEAL_ROOM.idFromName(code));
      const res = await stub.fetch("https://list.internal/apply", {
        method: "POST",
        body: JSON.stringify({ type: "addMealImage", id: mealId, imageId }),
        headers: { "content-type": "application/json" },
      });
      return jsonPassthrough(res);
    }

    // Une photo précise : GET pour la servir, DELETE pour la retirer.
    const imageMatch = url.pathname.match(
      /^\/api\/lists\/([A-Za-z0-9]{4,10})\/meals\/([A-Za-z0-9_-]{1,64})\/images\/([A-Za-z0-9_-]{1,64})$/,
    );
    if (imageMatch) {
      const code = normalizeCode(imageMatch[1]);
      const mealId = imageMatch[2];
      const imageId = imageMatch[3];
      const key = mealImageKey(code, mealId, imageId);

      if (request.method === "GET") {
        // Pas de limiteur dédié à la lecture d'image : réutilise celui de la
        // lecture de liste ci-dessus (même resource, même logique d'abus).
        const ip = request.headers.get("CF-Connecting-IP");
        if (ip) {
          const { success } = await env.READ_LIST_RATE_LIMITER.limit({ key: ip });
          if (!success) {
            return jsonError("Trop de tentatives, réessaie dans une minute.", 429);
          }
        }

        const object = await env.MEAL_IMAGES.get(key);
        if (!object) return new Response("Not found", { status: 404, headers: CORS_HEADERS });
        return new Response(object.body, {
          headers: {
            "content-type": object.httpMetadata?.contentType ?? "application/octet-stream",
            // Un id d'image est permanent : l'objet à cette URL ne change
            // jamais de contenu, un cache long est donc toujours sûr.
            "cache-control": "public, max-age=31536000, immutable",
            // Empêche le navigateur de réinterpréter le fichier au-delà du
            // content-type déclaré (déjà validé à l'upload, voir plus haut).
            "x-content-type-options": "nosniff",
            ...CORS_HEADERS,
          },
        });
      }

      if (request.method === "DELETE") {
        const ip = request.headers.get("CF-Connecting-IP");
        if (ip) {
          const { success } = await env.IMAGE_WRITE_RATE_LIMITER.limit({ key: ip });
          if (!success) {
            return jsonError("Trop de tentatives, réessaie dans une minute.", 429);
          }
        }

        await env.MEAL_IMAGES.delete(key);
        const stub = env.MEAL_ROOM.get(env.MEAL_ROOM.idFromName(code));
        const res = await stub.fetch("https://list.internal/apply", {
          method: "POST",
          body: JSON.stringify({ type: "removeMealImage", id: mealId, imageId }),
          headers: { "content-type": "application/json" },
        });
        return jsonPassthrough(res);
      }

      return new Response("Method not allowed", { status: 405, headers: CORS_HEADERS });
    }

    if (url.pathname.startsWith("/api/")) {
      return new Response("Not found", { status: 404, headers: CORS_HEADERS });
    }

    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;

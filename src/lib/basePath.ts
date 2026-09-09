// L'app est servie à la racine du domaine (base "/") sur Cloudflare Workers.
// import.meta.env.BASE_URL reflète cette base (toujours terminée par "/"),
// et ces deux fonctions gardent le routeur et les liens de partage corrects
// même si un jour l'app est servie depuis un sous-chemin.
const BASE_PATH = import.meta.env.BASE_URL as string;

/** Préfixe un chemin absolu de l'app (ex: "/l/ABCDEF") par le sous-chemin de déploiement. */
export function appPath(path: string): string {
  return path === "/" ? BASE_PATH : BASE_PATH.slice(0, -1) + path;
}

/** L'équivalent de location.pathname, débarrassé du sous-chemin de déploiement. */
export function routePath(): string {
  const { pathname } = location;
  return pathname.startsWith(BASE_PATH) ? pathname.slice(BASE_PATH.length - 1) : pathname;
}

// Déploiement mono-origine (Cloudflare Workers sert aussi le client) : les
// chemins /api/... restent relatifs, ce qui suffit dans tous les cas visés
// par ce projet.
export function apiUrl(path: string): string {
  return path;
}

export function wsUrl(path: string): string {
  const proto = location.protocol === "https:" ? "wss:" : "ws:";
  return `${proto}//${location.host}${path}`;
}

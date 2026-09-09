import { defineConfig } from "vite";
import { cloudflare } from "@cloudflare/vite-plugin";

// "/" sur Cloudflare Workers (servi à la racine du domaine) ; sous-chemin du
// dépôt (ex: "/OnMangeQuoi/") sur GitHub Pages, où l'app est servie depuis un
// dépôt de projet plutôt qu'un domaine dédié — voir VITE_BASE_PATH dans
// .github/workflows/pages.yml et src/lib/basePath.ts pour le routeur.
const base = process.env.VITE_BASE_PATH || "/";

export default defineConfig({
  base,
  plugins: [cloudflare()],
});

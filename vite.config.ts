import { defineConfig } from "vite";
import { cloudflare } from "@cloudflare/vite-plugin";
import { VitePWA } from "vite-plugin-pwa";

// "/" sur Cloudflare Workers (servi à la racine du domaine) ; sous-chemin du
// dépôt (ex: "/OnMangeQuoi/") sur GitHub Pages, où l'app est servie depuis un
// dépôt de projet plutôt qu'un domaine dédié — voir VITE_BASE_PATH dans
// .github/workflows/pages.yml et src/lib/basePath.ts pour le routeur.
const base = process.env.VITE_BASE_PATH || "/";

export default defineConfig({
  base,
  plugins: [
    cloudflare(),
    // VitePWA isn't aware of @cloudflare/vite-plugin's separate worker
    // build environment, so it also drops registerSW.js/manifest.webmanifest
    // next to the compiled Worker script (dist/<name>/) in addition to
    // dist/client/ where they belong. Harmless: wrangler deploy only reads
    // index.js (the `main` field) and the dist/client assets directory from
    // that folder, never those two stray files, and neither ends up bundled
    // inside index.js itself.
    VitePWA({
      registerType: "autoUpdate",
      manifest: {
        name: "OnMangeQuoi",
        short_name: "OnMangeQuoi",
        description: "Liste de repas partagée, synchronisée en temps réel.",
        lang: "fr",
        start_url: base,
        scope: base,
        display: "standalone",
        background_color: "#faf6f2",
        theme_color: "#c9622c",
        icons: [
          { src: "icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "icon-512.png", sizes: "512x512", type: "image/png" },
          { src: "icon-512-maskable.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
      },
      workbox: {
        // L'app est une SPA à une seule route ; le reste (API, WebSocket)
        // ne doit jamais être servi depuis le cache.
        navigateFallbackDenylist: [/^\/api\//],
      },
    }),
  ],
});

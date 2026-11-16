import { defineConfig, devices } from "@playwright/test";
import { existsSync } from "node:fs";

// This sandbox pre-installs Chromium outside Playwright's own cache; CI
// installs its own via `playwright install --with-deps chromium`, so only
// override the executable when the local one is actually present.
const localChromium = "/opt/pw-browsers/chromium";
const executablePath = existsSync(localChromium) ? localChromium : undefined;

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["html", { open: "never" }]] : "list",
  use: {
    baseURL: "http://127.0.0.1:5173",
    trace: "on-first-retry",
    // Les limiteurs de débit du Worker (wrangler.json → ratelimits) sont
    // indexés par CF-Connecting-IP et restent actifs sous `vite dev`, où
    // toutes les requêtes partagent la même IP locale : la suite crée plus
    // de 30 listes, au-delà de CREATE_LIST_RATE_LIMITER (30/min), et les
    // dernières créations recevaient une 429 selon la vitesse du runner.
    // En local, l'en-tête envoyé par le navigateur est transmis tel quel au
    // Worker (en production, Cloudflare l'écrase toujours) : ce fichier est
    // réévalué dans chaque processus worker de Playwright, donc chacun reçoit
    // sa propre IP fictive et son propre quota, sans toucher au code ni à la
    // limite réelle.
    extraHTTPHeaders: {
      "CF-Connecting-IP": `10.${Math.floor(Math.random() * 256)}.${Math.floor(Math.random() * 256)}.${Math.floor(Math.random() * 254) + 1}`,
    },
  },
  webServer: [{
    // --host 127.0.0.1 is load-bearing, not cosmetic: without it Vite binds
    // to whatever `localhost` resolves to, and on GitHub Actions' runners
    // that's IPv6-only (`::1`). The dev server then never opens an IPv4
    // socket, so Playwright's probes against 127.0.0.1 below got
    // ECONNREFUSED forever even though Vite had already printed "ready" on
    // localhost:5173.
    command: "npm run dev -- --port 5173 --strictPort --host 127.0.0.1",
    url: "http://127.0.0.1:5173",
    reuseExistingServer: !process.env.CI,
    // Cold `npm run dev` (Vite + the Cloudflare Worker environment via
    // workerd) can take a while on shared CI runners.
    timeout: 120_000,
  },
  {
    // Build de production servi tel quel : le service worker n'existe pas sous
    // `vite dev`, donc le test hors ligne (PWA-05) ne peut pas s'y faire.
    command: "npm run build && npm run preview -- --port 4173 --strictPort --host 127.0.0.1",
    url: "http://127.0.0.1:4173",
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  }],
  projects: [
    {
      name: "chromium",
      testIgnore: "offline.spec.ts",
      use: {
        ...devices["Desktop Chrome"],
        ...(executablePath ? { launchOptions: { executablePath } } : {}),
      },
    },
    {
      name: "offline",
      testMatch: "offline.spec.ts",
      use: {
        ...devices["Desktop Chrome"],
        baseURL: "http://127.0.0.1:4173",
        ...(executablePath ? { launchOptions: { executablePath } } : {}),
      },
    },
  ],
});

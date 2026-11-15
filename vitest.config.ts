import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      // Voir worker/test/cloudflareWorkersShim.ts.
      "cloudflare:workers": path.resolve(import.meta.dirname, "worker/test/cloudflareWorkersShim.ts"),
    },
  },
  test: {
    environment: "node",
    globals: true,
    include: ["shared/**/*.test.ts", "worker/**/*.test.ts", "src/**/*.test.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "html", "lcov"],
      // Tout shared/, worker/ et src/ (logique pure sous node, vues et
      // composants DOM sous jsdom : chaque fichier de test déclare son
      // environnement via `@vitest-environment`). Exclus : shared/types.ts
      // (types seuls) et worker/mealRoom.ts (couche Durable Object — stockage,
      // WebSocket — qui demanderait un vrai runtime Workers pour être testée
      // utilement ; exercée par les tests e2e, toute sa logique métier vivant
      // dans reducer.ts, entièrement testé).
      include: ["shared/**/*.ts", "worker/**/*.ts", "src/**/*.ts"],
      exclude: ["**/*.test.ts", "shared/types.ts", "worker/mealRoom.ts", "worker/test/**"],
      thresholds: {
        lines: 100,
        branches: 100,
        functions: 100,
        statements: 100,
      },
    },
  },
});

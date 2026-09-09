import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    globals: true,
    include: ["shared/**/*.test.ts", "worker/**/*.test.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "html", "lcov"],
      // Comme dans KoiKiManke : seule la logique pure (reducer.ts, shared/)
      // est unit-testée. worker/mealRoom.ts (stockage, WebSocket) n'est
      // qu'une fine couche Durable Object sans logique propre — toute sa
      // logique métier vit dans reducer.ts, entièrement testé.
      include: ["shared/**/*.ts", "worker/reducer.ts"],
      exclude: ["**/*.test.ts", "shared/types.ts"],
      thresholds: {
        lines: 100,
        branches: 100,
        functions: 100,
        statements: 100,
      },
    },
  },
});

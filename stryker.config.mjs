// Chaque module est associé aux seuls fichiers de test capables de tuer ses
// mutants : la CI lance un job par module (variable MUTATE, voir
// .github/scripts/mutation-matrix.mjs) et le runner « command » ne relance que
// ces tests-là pour chaque mutant, au lieu de toute la suite. Un fichier trop
// long (src/views/list.ts) est découpé en plages de lignes (`fichier:début-fin`),
// un job chacune.
//
// Exclus, comme de la couverture (vitest.config.ts) : shared/types.ts (types
// seuls) et worker/mealRoom.ts (couche Durable Object, couverte par l'e2e).
export const targets = {
  'worker/index.ts': ['worker/index.test.ts'],
  'worker/reducer.ts': ['worker/reducer.test.ts'],
  'src/lib/accessibilityPreference.ts': ['src/lib/accessibilityPreference.test.ts'],
  'src/lib/basePath.ts': ['src/lib/basePath.test.ts'],
  'src/lib/compactShare.ts': ['src/lib/compactShare.test.ts'],
  'src/lib/confirmClick.ts': ['src/lib/confirmClick.test.ts'],
  'src/lib/dom.ts': ['src/lib/dom.test.ts'],
  'src/lib/editable.ts': ['src/lib/editable.test.ts'],
  'src/lib/historyStats.ts': ['src/lib/historyStats.test.ts'],
  'src/lib/http.ts': ['src/lib/http.test.ts'],
  'src/lib/icons.ts': ['src/lib/icons.test.ts'],
  'src/lib/id.ts': ['src/lib/id.test.ts'],
  'src/lib/importExport.ts': ['src/lib/importExport.test.ts'],
  'src/lib/notificationDiff.ts': ['src/lib/notificationDiff.test.ts'],
  'src/lib/notificationPreference.ts': ['src/lib/notificationPreference.test.ts'],
  'src/lib/qr.ts': ['src/lib/qr.test.ts'],
  'src/lib/sortPreference.ts': ['src/lib/sortPreference.test.ts'],
  'src/lib/storage.ts': ['src/lib/storage.test.ts'],
  'src/lib/updatePrompt.ts': ['src/lib/updatePrompt.test.ts'],
  'src/lib/syncWorker.ts': ['src/lib/syncWorker.test.ts'],
  'src/lib/theme.ts': ['src/lib/theme.test.ts'],
  'src/lib/ws.ts': ['src/lib/ws.test.ts'],
  'src/components/pwaBanner.ts': ['src/components/pwaBanner.test.ts'],
  'src/main.ts': ['src/main.test.ts'],
  'src/views/home.ts': ['src/views/home.test.ts'],
  'src/views/list.ts:1-170': ['src/views/list.test.ts'],
  'src/views/list.ts:171-340': ['src/views/list.test.ts'],
  'src/views/list.ts:341-510': ['src/views/list.test.ts'],
  'src/views/list.ts:511-680': ['src/views/list.test.ts'],
  'src/views/list.ts:681-850': ['src/views/list.test.ts'],
  'src/views/list.ts:851-1020': ['src/views/list.test.ts'],
  'src/views/list.ts:1021-1190': ['src/views/list.test.ts'],
  'src/views/list.ts:1191-1360': ['src/views/list.test.ts'],
  'src/views/list.ts:1361-1530': ['src/views/list.test.ts'],
  'src/views/list.ts:1531-1700': ['src/views/list.test.ts'],
  'src/views/list.ts:1701-1803': ['src/views/list.test.ts'],
};

const selected = process.env.MUTATE ? process.env.MUTATE.split(",") : Object.keys(targets);
for (const file of selected) {
  if (!targets[file]) throw new Error(`MUTATE : module inconnu ${file}`);
}
const tests = [...new Set(selected.flatMap((file) => targets[file]))];

// @ts-check
/** @type {import('@stryker-mutator/api/core').PartialStrykerOptions} */
export default {
  packageManager: "npm",
  // Le plugin officiel @stryker-mutator/vitest-runner (pilote vitest via son
  // API programmatique) ne rejoue en pratique aucun test contre le code muté
  // avec vitest 5 (testsCompleted: 0 dans le rapport JSON pour tout mutant
  // non "statique", quel que soit coverageAnalysis) : chaque mutant survit
  // par défaut, faute de test réellement exécuté contre lui — un score
  // proche de 0 % qui ne reflète en rien la qualité réelle des tests. Le
  // testRunner "command" (relance `vitest run` en sous-processus par mutant,
  // sans dépendre d'aucune API interne de vitest) fonctionne correctement.
  testRunner: "command",
  commandRunner: { command: `npx vitest run ${tests.join(" ")}` },
  reporters: ["progress", "clear-text", "html"],
  // Le testRunner "command" ne peut pas faire d'analyse de couverture fine
  // (il ne fait que lancer une commande et lire son code de sortie).
  coverageAnalysis: "off",
  mutate: selected,
  // Par défaut, Stryker réécrit tsconfig.json (extends/references) pour le
  // bac à sable, via `ts.parseConfigFileTextToJson` — une fonction retirée
  // dans TypeScript 7, ce qui fait planter Stryker avant même de lancer un
  // test : pointer vers un fichier volontairement inexistant fait sauter
  // cette réécriture (aucune vérification de type par Stryker ici).
  tsconfigFile: "tsconfig.stryker-unused.json",
  thresholds: {
    high: 100,
    low: 100,
    break: 100,
  },
};

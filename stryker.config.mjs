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
  // testRunner "command" (relance `npm test` en sous-processus par mutant,
  // ne dépend d'aucune API interne de vitest) fonctionne correctement.
  testRunner: "command",
  commandRunner: {
    command: "npx vitest run worker/reducer.test.ts",
  },
  reporters: ["progress", "clear-text", "html"],
  // Le testRunner "command" ne peut pas faire d'analyse de couverture fine
  // (il ne fait que lancer une commande et lire son code de sortie) :
  // chaque mutant relance donc tout worker/reducer.test.ts.
  coverageAnalysis: "off",
  // Seule la logique pure est unit-testée (voir vitest.config.ts et
  // CLAUDE.md) : muter autre chose que reducer.ts n'aurait aucun test à
  // tuer les mutants, donc un score de mutation illisible.
  mutate: ["worker/reducer.ts"],
  // Par défaut, Stryker réécrit tsconfig.json (extends/references) pour le
  // bac à sable, via `ts.parseConfigFileTextToJson` — une fonction retirée
  // dans TypeScript 7 (voir la version dans package.json), ce qui fait
  // planter Stryker avant même de lancer un test. On ne mute que
  // reducer.ts sans vérification de type par Stryker (juste vitest), donc
  // aucun tsconfig n'est réellement nécessaire ici : pointer vers un
  // fichier volontairement inexistant fait sauter cette réécriture (Stryker
  // l'ignore silencieusement quand le fichier ne fait pas partie du projet).
  tsconfigFile: "tsconfig.stryker-unused.json",
  thresholds: {
    high: 100,
    low: 90,
    break: 95,
  },
};

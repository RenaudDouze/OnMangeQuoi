# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev             # vite dev — front + Worker + Durable Object run together via workerd
npm run build           # typecheck then vite build (client + worker bundles)
npm run lint             # oxlint --deny-warnings
npm run typecheck        # tsc --noEmit against tsconfig.worker.json AND tsconfig.client.json separately
npm run test             # vitest run (shared/**/*.test.ts, worker/**/*.test.ts only)
npm run test:coverage    # same, with the 100% coverage gate below
npm run test:mutation    # stryker run — mutation testing on all tested code (see "Mutation testing")
npm run test:e2e         # playwright test, against a real `vite dev` server
npm run deploy           # build + wrangler deploy (manual; CI normally does this)
```

Single test runs:

```bash
npx vitest run -t "nom du test"        # by test name, substring match
npx vitest run worker/reducer.test.ts   # by file
npx playwright test -g "nom du test"    # e2e, by test name
npx playwright test e2e/sync.spec.ts    # e2e, by file
```

`npm run typecheck` runs **two separate** `tsc` invocations (`tsconfig.worker.json` for `worker/` + `shared/`, `tsconfig.client.json` for `src/` + `shared/`) because the two environments have different global types (`@cloudflare/workers-types` vs `DOM`) that would otherwise conflict.

Before pushing, always run lint, typecheck, test:coverage, test:mutation, and test:e2e — CI runs them as independent jobs and any one failing blocks the Cloudflare/Pages deploy (see below). Before an e2e run, clear rate-limiter state left over from a previous run: `rm -rf .wrangler/state/v3/ratelimit` (see "Local dev quirks").

## Architecture

Real-time shared meal-planning lists, hosted entirely on Cloudflare (Workers + Durable Objects + R2), with a vanilla-TypeScript frontend (no framework). Optionally mirrored to GitHub Pages. No accounts: a list is identified only by a 6-character code.

### Three layers, one source of truth

- `shared/types.ts` — `Meal`, `ListState`, `ClientMessage`, `ServerMessage`, and the length/size limits enforced on both ends.
- `worker/reducer.ts` — pure function `applyMessage(state, msg)` mutating a `ListState` in place. This is the **entire business logic** of the app (add/edit/delete a meal, change status, archive on "fait", reorder, note, image presence). It has no I/O and is the only thing unit-tested (see Testing below).
- `worker/mealRoom.ts` — a Durable Object (`MealRoom`, one instance per list code) that is a thin shell around the reducer: holds the current `ListState` in memory + `ctx.storage`, accepts WebSocket connections (`ctx.acceptWebSocket`, hibernation-capable), and has one job on any mutation: `applyMessage` → persist → broadcast the new full state to every connected socket. There is no diffing — every mutation rebroadcasts the entire `ListState`.
- `worker/index.ts` — the actual `fetch` handler: routes `/api/lists`, `/api/lists/:code(/ws)`, `/api/lists/:code/meals/:id/images(/:imageId)`, rate-limits, and otherwise falls through to `env.ASSETS` (the built SPA). It talks to the Durable Object only via `stub.fetch(...)` with synthetic `https://list.internal/...` URLs — the DO's own `fetch` routes by HTTP method/headers, not by pathname, **except** for `/apply` (see Image uploads below), so keep that in mind if you add a new internal route there.

### No optimistic updates — client is a pure reflection of server state

The client **never** mutates its local `ListState` in response to user action. `src/lib/ws.ts` (`ListConnection`) sends a `ClientMessage` and does nothing else; the UI only changes when the server echoes back a `ServerMessage` of type `"state"` (auto-reconnect with exponential backoff, and messages sent while disconnected are queued and flushed on reconnect). This is deliberate and has ripple effects worth knowing before touching `src/views/list.ts`:

- `renderMeals()` fully rebuilds the meal list from whatever `ListState` last arrived — there's no client-side notion of "this edit is pending."
- `reconcileMealList()` special-cases the one meal card whose text input/textarea currently has focus (`focusedMealId`) and reuses its existing DOM node untouched, so a state update arriving while someone is mid-keystroke doesn't blow away unsaved input. Any new editable field added to a meal card needs to be covered by this same freeze, or typing into it while another device is also editing the list will lose keystrokes.
- Drag-and-drop reordering (SortableJS, `forceFallback: true` — needed for touch, since this is a mobile-first PWA) mutates the real DOM nodes during the drag; a `dragging` flag makes `renderMeals()` a no-op mid-drag so an incoming broadcast can't fight the gesture. The reorder is only sent to the server on drop, and the server's echo is what settles the final order.
- Image upload/delete go over plain HTTP (`POST /api/lists/:code/meals/:id/images`, `DELETE /api/lists/:code/meals/:id/images/:imageId`, not WebSocket — see below) but follow the same rule: the fetch call reports only success/failure, the thumbnail only appears once the resulting state broadcast arrives. This is why the upload UI needs its own loading indicator (`wireMealImage`'s `setLoading`) — without it, the round-trip looks like nothing happened.

### Image uploads (R2), and the `/apply` internal route

A meal can carry several photos: `Meal.images` is an ordered array of permanent, immutable image ids (each never reused for different content once created, so no cache-busting version number is needed — a long, immutable cache header is always safe). Each lives in the `MEAL_IMAGES` R2 bucket at `meals/<code>/<mealId>/<imageId>`. `worker/index.ts`'s `mealImageKey()` special-cases `imageId === mealId` to resolve to the old 2-segment key `meals/<code>/<mealId>` — the layout used before multi-photo support, when a meal only ever had one image, overwritten on replace. `worker/reducer.ts`'s `migrateMealImages()` (called from `mealRoom.ts`'s `ensureLoaded()`, idempotent, only persists if something actually changed) converts an old `hasImage`/`imageVersion` meal to the new shape by reusing the meal's own id as the migrated image's id — so the migration never has to copy the R2 object to a new key.

Because the mutation is triggered from `worker/index.ts` (which has the R2 binding) rather than from a WebSocket message, `worker/index.ts` writes to R2 first (generating a fresh `imageId` via `crypto.randomUUID()` on upload) and then calls `stub.fetch("https://list.internal/apply", { method: "POST", body: JSON.stringify({type: "addMealImage" | "removeMealImage", ...}) })` — a dedicated route in `mealRoom.ts` that runs the exact same `applyMessage` → persist → broadcast pipeline as a real WebSocket message. Both message types are rejected by the reducer unless replayed internally (`internal` flag) — never trust a client-supplied claim that an upload/delete already happened. Follow this pattern (write side effect, then replay a `ClientMessage` through `/apply`) for any future mutation that has to originate from an HTTP route rather than the socket.

### Two deploy targets, one Worker

- **Cloudflare Workers** (`deploy.yml`): the canonical deployment — Worker serves both the API/WebSocket and the static SPA (`env.ASSETS`), single origin.
- **GitHub Pages** (`pages.yml`): a second, static-only copy of the client, built with `VITE_SYNC_WORKER_URL` pointing at the Cloudflare Worker's URL and `VITE_BASE_PATH=/OnMangeQuoi/` (project pages are served from a subpath). `src/lib/basePath.ts` and `src/lib/syncWorker.ts` are the two places that branch on these build-time env vars to make routing and API/WS URLs work from either origin.
- Because Pages and Workers are different origins, every worker route needs correct CORS headers (`CORS_HEADERS` in `worker/index.ts`) — including `Access-Control-Allow-Methods` for every HTTP method actually used. A cross-origin `PUT`/`DELETE` whose method isn't listed there fails silently in the browser (no HTTP response at all, just a generic network error client-side) even though everything works fine same-origin in local dev — this exact bug has happened once already when the image routes were added.
- `deploy.yml` runs `wrangler r2 bucket create` (idempotent, ignores "already exists") before `wrangler deploy`, because unlike the Durable Object binding or rate limiters, an R2 bucket referenced in `wrangler.json` is not auto-provisioned. R2 must also be enabled once on the Cloudflare account itself (dashboard, one-time, not fixable from code) before that step can succeed at all.
- Both deploy workflows trigger via `workflow_run` off of `CI` succeeding on `main` (never on a raw push), so a red CI job blocks both deploys.

### Rate limiting

Three Cloudflare native rate limiters (`wrangler.json` → `ratelimits`), all keyed by `CF-Connecting-IP` and all no-ops when that header is absent: `CREATE_LIST_RATE_LIMITER` (creating lists), `READ_LIST_RATE_LIMITER` (fetching/connecting to a list, and serving images), `IMAGE_WRITE_RATE_LIMITER` (image upload/delete). There is no auth, so this is the only abuse control; if you add a new mutating route, add rate limiting to it too.

### Testing split

Everything under `shared/`, `worker/` and `src/` is unit-tested (Vitest, `vitest.config.ts`) at an enforced 100% line/branch/function/statement coverage — pure logic under `node`, views and DOM glue under `jsdom` (each test file declares `// @vitest-environment jsdom`; views mock their collaborators — `ws`, `http`, `sortablejs`, `editable`, `confirmClick`, `importExport`, `qr` — with `vi.mock`). The only exclusions are `shared/types.ts` (types) and `worker/mealRoom.ts` (the Durable Object shell: storage and WebSocket hibernation would need a real Workers runtime; all its logic lives in the fully-tested `reducer.ts`), which the Playwright e2e suite exercises against a real `vite dev` instance. `worker/index.ts` is tested with fake `MEAL_ROOM`/`MEAL_IMAGES`/rate-limiter bindings (`worker/index.test.ts`, with `cloudflare:workers` aliased to `worker/test/cloudflareWorkersShim.ts`).

### Mutation testing

100% coverage only proves every line *ran* during the test suite, not that the assertions would catch a real regression — `npm run test:mutation` (Stryker, `stryker.config.mjs`) checks the latter by mutating the same perimeter as the coverage and requiring a failing test for every mutant (`high`/`low`/`break` thresholds all at 100). `targets` (top of the config) maps each module to the only test files run per mutant; CI runs one job per module (matrix from `.github/scripts/mutation-matrix.mjs`, aggregated by the required check "Mutation testing (logique pure)"), and `src/views/list.ts` (~1800 lines) is split into line ranges (`'src/views/list.ts:1-170'`…, labelled `…@1-170` in artifact names — `/` and `:` are forbidden there); extend the last range if the file grows. `MUTATE=worker/reducer.ts npm run test:mutation` mutates a single module. A new module must be added to `targets` with its test file.

Uses `testRunner: "command"` (re-invokes `vitest run <test files>` per mutant) rather than the official `@stryker-mutator/vitest-runner` plugin, which runs ~no test per mutant under Vitest 5, and a non-existent `tsconfigFile` (Stryker's tsconfig preprocessor calls an API removed in TypeScript 7).

An *equivalent* mutant (the mutated code behaves identically) is fixed by simplifying the code, never by lowering the threshold: remove a redundant guard, a dead default, a `?.` on a never-null value, a `.trim()` on a `type=url` input, a `clearTimeout` made redundant by the cleanup. Pitfalls: a selector whose class a mutant changes silently matches nothing (assert exact attributes/structure); stray text a mutant injects into an HTML template only shows by inspecting text nodes or exact attribute lists; jsdom doesn't fire `blur` on removal or normalise like a browser, so some real-browser guards (e.g. an inline editor's "done" lock) need an explicit simulated event.

### Local dev quirks

- `CF-Connecting-IP` **is** present locally (with a consistent value) under `wrangler dev`/the Vite Cloudflare plugin, unlike a naive assumption that it's a production-only header — so the rate limiters are live in local dev and e2e runs too, and their state persists on disk across dev-server restarts (`.wrangler/state/v3/ratelimit/`). Delete that directory before an e2e run if you hit spurious 429s.
- Vite's dev server answers CORS preflight (`OPTIONS`) requests with its own default headers before the request ever reaches the Worker's `fetch` handler, which can mask bugs in the Worker's own `CORS_HEADERS` (this is exactly how the cross-origin PUT/DELETE bug above shipped without being caught locally or in e2e — both are same-origin, so no real preflight ever happens in either).
- GitHub Actions steps are pinned to full commit SHAs with the version as a trailing comment (`uses: owner/action@<sha> # v7`) rather than floating tags, so Dependabot can still bump them.
- CI (`ci.yml`) pins Node 24 (bundled npm 11), and every job starts with `npm ci`, which fails outright if `package-lock.json` doesn't list every optional platform-specific dependency (e.g. `@oxlint/binding-<platform>`) — an older local npm (npm 10, bundled with Node 22) doesn't always write out the full set when running plain `npm install`/`npm update`, so a lockfile that looks fine locally can fail `npm ci` in CI on every job at once. After touching dependencies, run `npx --yes npm@11 install` (or otherwise match CI's npm major version) and verify with `npx --yes npm@11 ci` before pushing, rather than trusting a lockfile generated by a different npm major version.

### Preferences (theme, accessibility)

Both `src/lib/theme.ts` and `src/lib/a11y.ts` follow the same shape: a value persisted to `localStorage`, applied by setting/removing an attribute on `document.documentElement` (`data-theme`, `data-a11y`), with every actual consequence expressed in `style.css` selectors keyed off that attribute — never in JS beyond the toggle itself. Follow this pattern for any new global, persisted UI preference.

## Documentation, versioning and architecture rules

- `doc/` holds the stable truth for humans and agents: `architecture.md` (executable dependency rules), `codage.md` (conventions), `improvement.md` (backlog).
- `npm run lint` also runs dependency-cruiser (`.dependency-cruiser.cjs`): no cycles, no orphan files, one-way layer dependencies. Document an exception next to the rule, never loosen it globally.
- Commits follow Conventional Commits (`type(scope): subject`); enable the hook with `git config core.hooksPath .githooks`. The version is derived from the commits by semantic-release (`release.yml`): never edit a version number or a changelog by hand.

## PWA: updates and offline

- `registerType: "prompt"` (`vite.config.ts`): a new version is announced, never applied silently. `src/lib/updatePrompt.ts` (pure, dependencies injected) wires `registerSW` to `showUpdateBanner` (`src/components/pwaBanner.ts`); the page reloads only when the user clicks "Recharger".
- `watchOffline()` shows an offline banner while `navigator.onLine` is false.
- `e2e/offline.spec.ts` runs in the `offline` Playwright project against `npm run build && npm run preview` (port 4173): `vite dev` registers no service worker, so offline behaviour can only be tested on the production build.
- `virtual:pwa-register` only exists in a Vite build: Vitest aliases it to `src/test/pwaRegisterShim.ts`.

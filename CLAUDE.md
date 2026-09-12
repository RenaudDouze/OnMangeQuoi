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

Before pushing, always run lint, typecheck, test:coverage, and test:e2e — CI runs them as independent jobs and any one failing blocks the Cloudflare/Pages deploy (see below). Before an e2e run, clear rate-limiter state left over from a previous run: `rm -rf .wrangler/state/v3/ratelimit` (see "Local dev quirks").

## Architecture

Real-time shared meal-planning lists, hosted entirely on Cloudflare (Workers + Durable Objects + R2), with a vanilla-TypeScript frontend (no framework). Optionally mirrored to GitHub Pages. No accounts: a list is identified only by a 6-character code.

### Three layers, one source of truth

- `shared/types.ts` — `Meal`, `ListState`, `ClientMessage`, `ServerMessage`, and the length/size limits enforced on both ends.
- `worker/reducer.ts` — pure function `applyMessage(state, msg)` mutating a `ListState` in place. This is the **entire business logic** of the app (add/edit/delete a meal, change status, archive on "fait", reorder, note, image presence). It has no I/O and is the only thing unit-tested (see Testing below).
- `worker/mealRoom.ts` — a Durable Object (`MealRoom`, one instance per list code) that is a thin shell around the reducer: holds the current `ListState` in memory + `ctx.storage`, accepts WebSocket connections (`ctx.acceptWebSocket`, hibernation-capable), and has one job on any mutation: `applyMessage` → persist → broadcast the new full state to every connected socket. There is no diffing — every mutation rebroadcasts the entire `ListState`.
- `worker/index.ts` — the actual `fetch` handler: routes `/api/lists`, `/api/lists/:code(/ws)`, `/api/lists/:code/meals/:id/image`, rate-limits, and otherwise falls through to `env.ASSETS` (the built SPA). It talks to the Durable Object only via `stub.fetch(...)` with synthetic `https://list.internal/...` URLs — the DO's own `fetch` routes by HTTP method/headers, not by pathname, **except** for `/apply` (see Image uploads below), so keep that in mind if you add a new internal route there.

### No optimistic updates — client is a pure reflection of server state

The client **never** mutates its local `ListState` in response to user action. `src/lib/ws.ts` (`ListConnection`) sends a `ClientMessage` and does nothing else; the UI only changes when the server echoes back a `ServerMessage` of type `"state"` (auto-reconnect with exponential backoff, and messages sent while disconnected are queued and flushed on reconnect). This is deliberate and has ripple effects worth knowing before touching `src/views/list.ts`:

- `renderMeals()` fully rebuilds the meal list from whatever `ListState` last arrived — there's no client-side notion of "this edit is pending."
- `reconcileMealList()` special-cases the one meal card whose text input/textarea currently has focus (`focusedMealId`) and reuses its existing DOM node untouched, so a state update arriving while someone is mid-keystroke doesn't blow away unsaved input. Any new editable field added to a meal card needs to be covered by this same freeze, or typing into it while another device is also editing the list will lose keystrokes.
- Drag-and-drop reordering (SortableJS, `forceFallback: true` — needed for touch, since this is a mobile-first PWA) mutates the real DOM nodes during the drag; a `dragging` flag makes `renderMeals()` a no-op mid-drag so an incoming broadcast can't fight the gesture. The reorder is only sent to the server on drop, and the server's echo is what settles the final order.
- Image upload/delete go over plain HTTP (`PUT`/`DELETE /api/lists/:code/meals/:id/image`, not WebSocket — see below) but follow the same rule: the fetch call reports only success/failure, the thumbnail only appears once the resulting state broadcast arrives. This is why the upload UI needs its own loading indicator (`wireMealImage`'s `setLoading`) — without it, the round-trip looks like nothing happened.

### Image uploads (R2), and the `/apply` internal route

Meal images live in an R2 bucket (`MEAL_IMAGES`, one key per meal: `meals/<code>/<mealId>`, overwritten on replace — never versioned as separate objects). A `Meal` only carries `hasImage` + `imageVersion` (the latter is a cache-busting counter baked into the served URL as `?v=N`, incremented on every upload *and* delete).

Because the mutation is triggered from `worker/index.ts` (which has the R2 binding) rather than from a WebSocket message, `worker/index.ts` writes to R2 first and then calls `stub.fetch("https://list.internal/apply", { method: "POST", body: JSON.stringify({type: "setMealImage", ...}) })` — a dedicated route in `mealRoom.ts` that runs the exact same `applyMessage` → persist → broadcast pipeline as a real WebSocket message. Follow this pattern (write side effect, then replay a `ClientMessage` through `/apply`) for any future mutation that has to originate from an HTTP route rather than the socket.

### Two deploy targets, one Worker

- **Cloudflare Workers** (`deploy.yml`): the canonical deployment — Worker serves both the API/WebSocket and the static SPA (`env.ASSETS`), single origin.
- **GitHub Pages** (`pages.yml`): a second, static-only copy of the client, built with `VITE_SYNC_WORKER_URL` pointing at the Cloudflare Worker's URL and `VITE_BASE_PATH=/OnMangeQuoi/` (project pages are served from a subpath). `src/lib/basePath.ts` and `src/lib/syncWorker.ts` are the two places that branch on these build-time env vars to make routing and API/WS URLs work from either origin.
- Because Pages and Workers are different origins, every worker route needs correct CORS headers (`CORS_HEADERS` in `worker/index.ts`) — including `Access-Control-Allow-Methods` for every HTTP method actually used. A cross-origin `PUT`/`DELETE` whose method isn't listed there fails silently in the browser (no HTTP response at all, just a generic network error client-side) even though everything works fine same-origin in local dev — this exact bug has happened once already when the image routes were added.
- `deploy.yml` runs `wrangler r2 bucket create` (idempotent, ignores "already exists") before `wrangler deploy`, because unlike the Durable Object binding or rate limiters, an R2 bucket referenced in `wrangler.json` is not auto-provisioned. R2 must also be enabled once on the Cloudflare account itself (dashboard, one-time, not fixable from code) before that step can succeed at all.
- Both deploy workflows trigger via `workflow_run` off of `CI` succeeding on `main` (never on a raw push), so a red CI job blocks both deploys.

### Rate limiting

Three Cloudflare native rate limiters (`wrangler.json` → `ratelimits`), all keyed by `CF-Connecting-IP` and all no-ops when that header is absent: `CREATE_LIST_RATE_LIMITER` (creating lists), `READ_LIST_RATE_LIMITER` (fetching/connecting to a list, and serving images), `IMAGE_WRITE_RATE_LIMITER` (image upload/delete). There is no auth, so this is the only abuse control; if you add a new mutating route, add rate limiting to it too.

### Testing split

Only `shared/**/*.ts` and `worker/reducer.ts` are unit-tested (Vitest, `vitest.config.ts`), at an enforced 100% line/branch/function/statement coverage. `worker/mealRoom.ts` and `worker/index.ts` (the Durable Object shell and the HTTP routing/rate-limiting/R2 glue) are deliberately **not** unit-tested — they're thin I/O layers with no branching logic of their own, and are instead exercised through the Playwright e2e suite (`e2e/`), which runs against a real `vite dev` (Worker + Durable Object + R2, all locally emulated by `workerd`/miniflare — no real Cloudflare account needed for this). If you add real logic to either file, prefer moving it into `reducer.ts` (or another pure, unit-testable function) rather than growing an untested branch there.

### Local dev quirks

- `CF-Connecting-IP` **is** present locally (with a consistent value) under `wrangler dev`/the Vite Cloudflare plugin, unlike a naive assumption that it's a production-only header — so the rate limiters are live in local dev and e2e runs too, and their state persists on disk across dev-server restarts (`.wrangler/state/v3/ratelimit/`). Delete that directory before an e2e run if you hit spurious 429s.
- Vite's dev server answers CORS preflight (`OPTIONS`) requests with its own default headers before the request ever reaches the Worker's `fetch` handler, which can mask bugs in the Worker's own `CORS_HEADERS` (this is exactly how the cross-origin PUT/DELETE bug above shipped without being caught locally or in e2e — both are same-origin, so no real preflight ever happens in either).
- GitHub Actions steps are pinned to full commit SHAs with the version as a trailing comment (`uses: owner/action@<sha> # v7`) rather than floating tags, so Dependabot can still bump them.

### Preferences (theme, accessibility)

Both `src/lib/theme.ts` and `src/lib/a11y.ts` follow the same shape: a value persisted to `localStorage`, applied by setting/removing an attribute on `document.documentElement` (`data-theme`, `data-a11y`), with every actual consequence expressed in `style.css` selectors keyed off that attribute — never in JS beyond the toggle itself. Follow this pattern for any new global, persisted UI preference.

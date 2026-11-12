# VYRA

**Live:** [https://vyra-five-chi.vercel.app](https://vyra-five-chi.vercel.app) · **API:** [https://vyra-api-wpc0.onrender.com/api/health](https://vyra-api-wpc0.onrender.com/api/health) · **Repo:** [github.com/kayalvizhij-2008-it/VYRA](https://github.com/kayalvizhij-2008-it/VYRA)

> The Render instance is currently the **free 512 MB plan with an ephemeral filesystem**, because the Render account has no payment method. The API, Chromium binary detection, CORS and the frontend connection are live, but production browser runs need the **Standard (2 GB) plan** and a **1 GB disk mounted at `/data`** (`render.yaml`). No provider key is configured on the deployed API, so a run returns a clear `provider_not_configured` error until one is added in Render's environment.

**Autonomous browser intelligence — a premium control surface for the open-source [`browser-use`](https://github.com/browser-use/browser-use) engine.**

VYRA is an independent interface, not a reimplementation. Every run is handed to the real `browser-use` 1.0.2 agent, which drives a real Chrome/Chromium/Edge browser through a persistent Python REPL and raw Chrome DevTools Protocol. There is no Playwright mock, no scripted demo, no fabricated browser view.

---

## What is real, and what is not

| Real | Detail |
| --- | --- |
| Agent execution | `browser_use.Agent(task, llm=..., browser=...).run(...)` with the pinned upstream package |
| Live events | The engine's own `browser_use` logger, one INFO line per model step, persisted as timeline events |
| Screenshots | Only the images the agent actually captures under its workspace, copied into the run store |
| Result, steps, usage, cost | Taken from the engine's `RunResult` (`final_result()`, `usage`, `cost_usd`, `status`) |
| Cancellation | Cancels the live asyncio task inside the run's event loop; the browser is closed by the agent |
| Persistence | SQLite run store, event log, screenshots and templates on the server |

**Not present by design:** a simulated browser canvas, fake step generation, client-side API keys, or a second automation engine. When no model provider is configured, the UI says so and refuses to start a run — it never fakes success.

---

## Requirements

- Windows 10/11 (these instructions use PowerShell; the code is cross-platform)
- Python **3.11+** (validated on 3.13)
- Node.js **20+** and npm
- Google Chrome, Chromium, or Microsoft Edge for local browser runs
- At least one model provider credential (OpenAI, Anthropic, Google, Browser Use, or any OpenAI-compatible endpoint)

---

## Setup

From the project root:

```powershell
cd "C:\Users\dhurg\Desktop\Browser Automation Agent"

# 1. Python environment (the upstream engine is installed editable, untouched)
py -3.13 -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
python -m pip install -e .\upstream\browser-use
python -m pip install -r .\server\requirements.txt

# 2. Server configuration
Copy-Item .\server\.env.example .\server\.env
notepad .\server\.env      # add ONE provider key; save

# 3. Frontend dependencies
cd .\web
npm install
cd ..
```

### Run in development (two terminals)

```powershell
# Terminal 1 — API on http://127.0.0.1:8787
.\.venv\Scripts\python -m uvicorn vyra.app:app --app-dir server --host 127.0.0.1 --port 8787

# Terminal 2 — Vite on http://localhost:5173 (proxies /api to the API)
cd .\web
npm run dev
```

Open **http://localhost:5173**.

### Build and serve from one port

```powershell
cd .\web
npm run build
cd ..
.\.venv\Scripts\python -m uvicorn vyra.app:app --app-dir server --host 127.0.0.1 --port 8787
```

The API serves `web/dist` at **http://127.0.0.1:8787**.

### Tests

```powershell
.\.venv\Scripts\python -m pytest server\tests -q
```

The suite stubs the run launcher and capability detection; it covers run submission, high-impact confirmation, provider/browser/domain validation, cancellation conflicts, retries, event persistence, templating, redaction, and screenshot serving. It does not launch a browser or call a model.

```powershell
cd .\web; npm run typecheck
npm run build
```

---

## Environment variables

Only the **names** are listed. Values stay in `server/.env` (git-ignored) and are never returned by the API.

| Variable | Purpose |
| --- | --- |
| `BROWSER_USE_API_KEY` | Browser Use gateway models and optional cloud browser (billed) |
| `OPENAI_API_KEY` | OpenAI models |
| `ANTHROPIC_API_KEY` | Anthropic models |
| `GOOGLE_API_KEY` | Google Gemini models |
| `VYRA_OPENAI_BASE_URL` | OpenAI-compatible endpoint URL |
| `VYRA_OPENAI_API_KEY` | OpenAI-compatible endpoint key |
| `VYRA_COMPATIBLE_MODEL` | Default model id for the compatible endpoint |
| `VYRA_OPENAI_MODEL` / `VYRA_ANTHROPIC_MODEL` / `VYRA_GOOGLE_MODEL` | Default model ids |
| `VYRA_MAX_ACTIVE_RUNS` | Concurrent run limit (default 2) |
| `VYRA_DEFAULT_MAX_STEPS` | Default step budget (default 60) |
| `VYRA_DEFAULT_TIMEOUT_S` | Default loop timeout (default 600) |
| `VYRA_DEFAULT_HEADLESS` | Default headless flag (`true`/`false`) |
| `VYRA_DATA_DIR` | Optional data directory (default `./data`) |

The server now loads `server/.env` automatically (real process environment variables win). A provider is shown as *ready* only when its credential is present; the New Automation composer always opens, lets you pick any provider, and only unlocks **Run automation** once the selected provider has a server-side key. No key is ever sent to or stored by the browser.

OpenRouter and other OpenAI-compatible gateways use the **OpenAI-compatible endpoint** provider: set `VYRA_OPENAI_BASE_URL` (for example `https://openrouter.ai/api/v1`), `VYRA_OPENAI_API_KEY` and `VYRA_COMPATIBLE_MODEL`.

### Production configuration

| Side | Variable | Value |
| --- | --- | --- |
| Vercel | `VITE_API_BASE_URL` | Public Render API origin, e.g. `https://vyra-api.onrender.com` (build-time) |
| Render | `VYRA_DATA_DIR` | `/data` (mount a persistent disk there) |
| Render | `VYRA_CORS_ORIGINS` | Comma-separated frontend origins, e.g. `https://vyra.vercel.app` |
| Render | `OPENAI_API_KEY` / `ANTHROPIC_API_KEY` / `GOOGLE_API_KEY` / `BROWSER_USE_API_KEY` | At least one provider key |

The backend image builds Chromium from Debian packages and launches it through browser-use/CDP. A Render disk requires a paid instance, and Chromium needs more than the 512 MB free instance: use at least the **Standard (2 GB)** plan. The blueprint in `render.yaml` encodes that configuration. CORS is restricted to the origins listed in `VYRA_CORS_ORIGINS` (plus localhost for development); `*.vercel.app` origins are accepted by default for this frontend. The Vercel project also rewrites `/api/*` to the Render origin, so the browser never calls localhost in production.

---

## Pages

- **Overview** — live control-plane state, four 3D flip statistic cards (active, completed, needs attention, reported spend) with real drill-down detail, setup checklist, recent runs, seeded prompts.
- **New automation** — mission composer with provider/model selection, browser mode, domain guardrails, step/timeout budgets, template save, and an explicit acknowledgement for high-impact verbs.
- **Run history** — status filters with true totals, debounced search, sorting (newest/oldest/longest), “load more” paging to 200 runs, skeleton loading and retry.
- **Run detail** — live-ish timeline (1.2 s polling while active), engine screenshots, final result, usage and reported cost, immutable configuration, cancel/re-run.
- **Browsers** — detected engines with re-check and last-checked time, session modes, lifecycle and the attached-Chrome warning.
- **Integrations** — configured providers, copy-ready environment variable names, local/cloud browsers, and eight capabilities verified against the pinned engine source.
- **Settings & safety** — local interface preferences (animations, background motion, default headless), server environment presence (names only), runtime/commit/attribution, safety posture and data location.

Every control either works or is visibly disabled with an explanation. There are no decorative toggles.

---

## Architecture

```
upstream/browser-use/     pinned MIT engine (do not rewrite)
server/
  vyra/config.py          capability detection, provider/browser factories, redaction
  vyra/db.py              SQLite schema, run/event/screenshot/template store
  vyra/runner.py          thread + asyncio loop per run, log handler, screenshot watcher
  vyra/app.py             FastAPI routes, validation, SSE stream, static SPA
  tests/                  pytest suite
web/
  src/components/FibreArc.tsx   supplied WebGL component, adapted (see below)
  src/pages/                    eight routes
  src/lib/                      typed API client and setup context
data/                     run store, workspaces, screenshots (git-ignored)
```

### Run lifecycle

1. `POST /api/runs` validates provider credentials, browser availability, domain patterns, step limits and risk acknowledgement, then inserts a `queued` run.
2. A daemon thread starts its own asyncio loop, constructs one `Agent` and one `Browser`, and calls `agent.run(max_steps, timeout)`.
3. A logging handler attached to `browser_use` (filtered to that thread) persists each step line. A watcher copies new screenshots from `<workspace>/.browser-use/screenshots/`.
4. The `RunResult` is stored as `completed`, `timeout`, `max_steps` or `failed`. Cancellation stores `cancelled`.
5. On server start, any run left `running`/`queued` by a crash is marked failed rather than pretending it is alive.

### Full-page 3D background

`SceneBackground.tsx` is mounted once in the app shell, above every route, and persists across navigation. It layers two WebGL canvases behind the interface:

1. **Glitter Cascade** (`GlitterCascade.tsx`) — the supplied component, with every shader preserved verbatim: four parallax flake layers, glint stars, haze, pointer proximity response, film grain and adaptive resolution. Only unused Background-template card/text helpers were removed, and pointer listeners were moved to the window so the layer can stay `pointer-events: none` without losing its interaction. It runs on its original preset configuration (violet/lavender/warm haze, pink glints); shaders are unchanged.
2. **Fibre Arc** (`FibreArc.tsx`) — screened over the cascade so both remain visible. The original GLSL, strand math, mirrored bundle and uniforms are preserved. Changes: responsive sizing (`minWidth: 1200` / `minHeight: 800` removed), a 3.2 MP raster budget for full-screen use, DPR cap, pause on hidden tab and offscreen, static frame for `prefers-reduced-motion`, full listener cleanup, shader/program/buffer deletion plus `WEBGL_lose_context`, context-loss fallback, a CSS gradient fallback when WebGL is unavailable, and `aria-hidden` / `pointer-events: none`.

A translucent scrim and glass page headers/cards sit above the scene for contrast. Every page — Overview, New Automation, Run History, Run Detail, Browsers, Integrations, Settings and 404 — uses the same persistent layer rather than a per-page decoration.

### Interface system

The product uses a deep charcoal/violet system with lavender and warm sand accents, Sora/Inter typography, glass panels and one persistent WebGL scene.

- Accessible 3D flip cards for the real run statistics (click, Enter or Space; hidden faces are untabbable; links only active on the visible face).
- IntersectionObserver scroll reveals with stagger on Overview, Browsers, Integrations and Settings; content reveals immediately under reduced motion.
- 340 ms route transitions keyed by pathname, with scroll restoration, plus an error boundary per route.
- Skeleton loading for runs, history, browsers and run detail; explicit loading, empty, retry and success states throughout.
- Local preferences in Settings (interface animations, background motion, default headless) persisted to `localStorage`; the OS reduced-motion setting always wins.
- Search clearing, sorting, paging, copy-to-clipboard for env variable names, and disabled/loading states on every async action.

---

## Safety & limitations

- **The engine runs Python.** `browser-use` writes and executes Python cells as your OS user. Treat every task as code execution, not as a sandboxed click bot.
- **Domain rules are guards, not sandboxes.** Allowed/prohibited domains constrain browser helpers and main-frame navigation; they do not filter subresources or model-written Python.
- **Attached Chrome is a shared, unauthenticated session.** Its remote-debugging port has no authentication and exposes your logged-in accounts. Use only on a trusted machine.
- **Screenshots appear only when the agent takes them.** The UI states this instead of rendering a synthetic live view. Current URL/title are not shown unless the engine emits them.
- **Cost is provider-reported.** `cost_usd` comes from the engine's `genai-prices` calculation; cloud browser hours are billed separately by Browser Use.
- **This API is local and unauthenticated.** It binds `127.0.0.1` by default. Do not expose it to a network without adding authentication and TLS.
- **Live updates use 1.2 s polling**, not WebSocket push. The API also exposes an SSE endpoint (`/api/runs/{id}/events/stream`).
- **No provider key was configured in this workspace**, so a real end-to-end live run could not be executed here; the setup states are the honest result. Add a key and restart to run.

---

## License & attribution

VYRA is an independent interface and is not affiliated with or endorsed by Browser Use. The execution engine is [`browser-use`](https://github.com/browser-use/browser-use), MIT licensed; its license is retained at `upstream/browser-use/LICENSE`. Provider names and trademarks belong to their owners. VYRA adds no telemetry.

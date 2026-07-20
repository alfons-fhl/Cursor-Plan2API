# 🚀 Cursor-Plan2API

> **✅ Hermes Agent compatible** · **✅ OpenCode compatible** · **✅ Claude Code compatible** · **✅ OpenAI API compatible**
>
> **Use your [Cursor.ai](https://cursor.com) subscription as an OpenAI-compatible API** — locally, on your machine.

**Run [Hermes Agent](https://github.com/NousResearch/hermes-agent) or OpenCode with your Cursor subscription** — no official Dashboard `CURSOR_API_KEY`, no third-party bridge.

| Client | Status | What you get |
|--------|--------|--------------|
| **Hermes Agent** | **✅ Supported** | OpenRouter-style tool loop — Hermes Agent runs tools locally |
| **[OpenCode](https://opencode.ai)** | **✅ Supported** | Full agent mode — files & shell on your machine |
| **Claude Code** | **✅ Supported** | Anthropic Messages API (`POST /v1/messages`) |
| OpenAI SDK / LangChain / n8n | ✅ Supported | Standard `/v1/chat/completions` and `/v1/responses` |

```text
┌────────────┐    POST /v1/chat/completions    ┌──────────────────┐   agent CLI   ┌────────────┐
│Hermes Agent│         ─────────────►          │ Cursor-Plan2API  │   ───────►    │   Cursor   │
│  OpenCode  │         ◄─────────────          │  localhost:8787  │   ◄───────    │composer-2.5│
└────────────┘        OpenAI JSON / SSE        └──────────────────┘               └────────────┘
```

[![Node](https://img.shields.io/badge/node-%3E%3D20-brightgreen)]()
[![CI](https://github.com/alfons-fhl/Cursor-Plan2API/actions/workflows/ci.yml/badge.svg)]()
[![License](https://img.shields.io/badge/license-MIT-blue)]()
[![OpenAI API](https://img.shields.io/badge/OpenAI%20API-compatible-412991)]()
[![Hermes Agent](https://img.shields.io/badge/Hermes%20Agent-compatible-7C3AED)]()
[![Model Matrix](https://img.shields.io/badge/model%20matrix-179%2F179%20passed-brightgreen)]()

---

## 🎯 Recommended models (always use these three)

These are the **primary models** for Hermes Agent, OpenCode, and API clients:

| Model ID | Name | When to use |
|----------|------|-------------|
| `composer-2.5` | **Composer 2.5** | Default — best balance of quality and speed |
| `composer-2.5-fast` | **Composer 2.5 Fast** | Faster responses, good for chat & tool loops |
| `auto` | **Auto** | Let Cursor pick the model automatically |

```bash
# Hermes Agent
hermes -z "Hello" -m composer-2.5
hermes -z "Quick task" -m composer-2.5-fast
hermes -z "Route me" -m auto

# OpenCode (/models)
cursor-plan2api/composer-2.5
cursor-plan2api/composer-2.5-fast
cursor-plan2api/auto
```

`GET /v1/models` returns the three recommended models first, then the full merged catalog. See [Model catalog & `/v1/models`](#-model-catalog--v1models) for details.

---

## 📖 What is this?

**Cursor-Plan2API** is a local HTTP proxy that turns your **Cursor CLI subscription** (`agent login`) into an **OpenAI-compatible REST API** on `http://127.0.0.1:8787/v1`.

### ✨ Features

| Feature | Description |
|---------|-------------|
| 🤖 **Hermes Agent compatible** | OpenRouter-style `tool_calls` — Hermes Agent executes tools locally |
| 🧩 **OpenCode-compatible** | Agent mode + workspace headers — real file/shell execution |
| 💬 **Chat Completions** | Streaming & non-streaming, real token usage from CLI |
| 🧾 **Responses API** | `POST /v1/responses` for Cursor IDE & newer OpenAI SDK clients |
| 👁️ **Vision / Multimodal** | Base64 `image_url` parts saved to temp files and passed to CLI |
| 🧠 **Reasoning passthrough** | `reasoning_content` SSE deltas from CLI thinking blocks |
| 🐳 **Docker** | `Dockerfile` + `docker-compose.yml` with `~/.cursor` auth mount |
| ⚡ **Agent pool** | Optional warm CLI slots (`CURSOR_PLAN2API_AGENT_POOL=1`) |
| 🔧 **Tool Calling** | OpenAI `tool_calls` + streaming deltas |
| 🧠 **Embeddings** | Semantic vectors via `all-MiniLM-L6-v2` |
| 🎨 **Image Generation** | Native Cursor `generateImageToolCall` |
| 📊 **Usage API** | Live subscription usage from `api2.cursor.sh` |
| ⚡ **Plan Fast-Path** | Plan mode ~2× faster (ask + planning prompt) |
| 🔁 **Session Resume** | Reuse Cursor CLI sessions on large multi-turn prompts |
| 🔒 **Optional Auth** | Local bearer token for the proxy |
| 📋 **Model Catalog** | ~189 Cursor model IDs for OpenCode `/models` and other clients |
| 🔄 **429 Retry** | Automatic retry on rate limits |
| 🌐 **CORS** | Browser clients supported |
| 🖥️ **Daemon** | `start` / `stop` / `status` in the background |
| 📨 **Anthropic Messages** | `POST /v1/messages` for Claude Code & Anthropic clients |
| 🗜️ **Context compression** | `MAX_HISTORY_TOKENS` + `minimal` / `default` / `aggressive` levels |
| 💾 **Session persistence** | SQLite at `~/.cursor-plan2api/sessions.db` survives restarts |
| 🔑 **Dashboard API key bridge** | Optional `CURSOR_API_KEY` for usage API on non-macOS |
| 🌐 **Outbound HTTP proxy** | `HTTP_PROXY` / `HTTPS_PROXY` for usage API and vision downloads |
| 🔧 **Tool parameter fixer** | `file_path→path`, smart quotes, tolerant JSON parse |
| 🔁 **Auto-continue** | Resume truncated outputs (`AUTO_CONTINUE_MAX`) |
| 📋 **JSON mode** | `response_format: { type: "json_object" }` |
| 📈 **Stream usage** | `stream_options.include_usage` in final SSE chunk |
| 🛠️ **Admin dashboard** | `GET /admin` with live stats (`/admin/stats`) + SSE log tail |
| 🎮 **Web playground** | `GET /playground` — chat UI with model picker & streaming |
| 📄 **OpenAPI 3.1** | `GET /openapi.json`, `GET /docs/openapi.yaml` |
| 🔄 **Multi-profile rotation** | Round-robin / LRU across multiple `agent login` sessions |
| 🗜️ **Compact tool schemas** | `CURSOR_PLAN2API_COMPACT_TOOLS` for large tool arrays |
| 💰 **Cost estimates** | Per-model `estimated_cost_usd` in `/v1/usage` |
| 📄 **config.yaml** | Optional yaml config merged with env vars |
| 🚀 **Service templates** | systemd + launchd deploy examples |

---

## 📋 Prerequisites

- **Node.js** ≥ 20
- **Cursor CLI** installed & logged in (`agent login`)
- **Cursor.ai subscription** (Pro / Business / etc.)

```bash
curl https://cursor.com/install -fsS | bash
agent login
agent status
```

---

## ⚡ Quick Start

### Install from npm (v0.3.1)

```bash
npm install -g cursor-plan2api@0.3.1
cursor-plan2api
```

**Publishing** (maintainers):

```bash
npm version patch          # bump package.json (currently v0.3.1)
npm run build
npm publish --dry-run      # verify dist/, docs/, examples/, README
npm login                  # one-time npm auth
npm publish --access public
```

The package ships `dist/`, `docs/openapi.yaml`, `examples/`, and `README.md` only (`files` whitelist in `package.json`). `prepublishOnly` runs `npm run build` automatically.

Or run without global install:

```bash
npx cursor-plan2api
```

### Install from source

```bash
npm install
npm run build
cursor-plan2api
```

```bash
curl http://127.0.0.1:8787/health
curl http://127.0.0.1:8787/v1/models
```

---

## 🤖 Hermes Agent (Cursor subscription)

> **Primary use case:** Run [Hermes Agent](https://github.com/NousResearch/hermes-agent) on your **Cursor.ai subscription** via this local gateway.

### 1. Start the gateway

```bash
cursor-plan2api
```

### 2. Configure Hermes Agent

`~/.hermes/config.yaml` (see also [`examples/hermes-config.yaml`](examples/hermes-config.yaml)):

```yaml
model:
  provider: custom
  default: composer-2.5
  base_url: http://127.0.0.1:8787/v1
```

`~/.hermes/.env`:

```bash
OPENAI_API_KEY=not-needed
```

### 3. Run Hermes Agent

```bash
hermes -z "Hello, are you connected?" -m composer-2.5
hermes -z "Fast turn" -m composer-2.5-fast
hermes -z "Auto route" -m auto
```

### Hermes Agent tool modes

| `CURSOR_PLAN2API_CLIENT_COMPAT` | Behavior |
|----------------------------------|----------|
| `openrouter` (default) | Ask mode — model returns `tool_calls`, **Hermes Agent runs tools** |
| `delegate` | Agent mode — **Cursor executes** files/shell directly |

```bash
# Default: OpenRouter-style (Hermes Agent tool loop)
cursor-plan2api

# Optional: Cursor executes file/shell work
CURSOR_PLAN2API_CLIENT_COMPAT=delegate cursor-plan2api
```

---

## 🧩 OpenCode (Cursor subscription)

> **Primary use case:** Use [OpenCode](https://opencode.ai) with **Composer 2.5** via your Cursor subscription.

### Config

**Global:** `~/.config/opencode/opencode.jsonc`  
**Project:** [`opencode.jsonc`](opencode.jsonc) in this repo

Preconfigured provider `cursor-plan2api` with three **recommended** models:

- `cursor-plan2api/composer-2.5`
- `cursor-plan2api/composer-2.5-fast`
- `cursor-plan2api/auto`

OpenCode and other clients that call `GET /v1/models` also see the **full model catalog** (~189 ids) — Claude, Codex, Grok, Fable, and more. Use `/models` in OpenCode to pick any listed id (for example `cursor-plan2api/claude-sonnet-5-thinking-high`).

Headers sent automatically:

| Header | Value | Purpose |
|--------|-------|---------|
| `X-Cursor-Mode` | `agent` | File/shell execution on your machine |
| `X-Cursor-Workspace` | your home dir | Where files are created |
| `X-Plan2API-Client` | `opencode` | OpenCode identity & prompts |

### Usage

```bash
cursor-plan2api          # start gateway
opencode                 # pick model via /models
```

```bash
opencode run -m cursor-plan2api/composer-2.5 "Your task"
opencode run -m cursor-plan2api/composer-2.5-fast "Quick task"
opencode run -m cursor-plan2api/auto "Auto route"
```

> **Note:** ~15–20s per turn is normal without the agent pool. Enable `CURSOR_PLAN2API_AGENT_POOL=1` to keep warm CLI slots and reduce cold-start latency.

---

## 📨 Claude Code / Anthropic Messages API

> Use Claude Code or other Anthropic clients against your **Cursor subscription** via `POST /v1/messages`.

```bash
# Non-streaming
curl -s http://127.0.0.1:8787/v1/messages \
  -H "Content-Type: application/json" \
  -d '{"model":"composer-2.5","max_tokens":1024,"messages":[{"role":"user","content":"Hi"}]}'

# Streaming (Anthropic SSE events)
curl -sN http://127.0.0.1:8787/v1/messages \
  -H "Content-Type: application/json" \
  -d '{"model":"composer-2.5","max_tokens":1024,"stream":true,"messages":[{"role":"user","content":"Hi"}]}'
```

| Feature | Support |
|---------|---------|
| `tool_use` / `tool_result` blocks | Mapped to OpenAI `tool_calls` internally |
| Streaming | `message_start`, `content_block_start`, `content_block_delta`, `content_block_stop`, `message_delta`, `message_stop` |
| Vision | Base64 `image` content blocks (same temp-file path as chat) |
| Thinking models | `thinking` blocks when CLI emits thinking output |
| `thinking` budget param | `{"type":"enabled","budget_tokens":10000}` on `POST /v1/messages` |

Point Claude Code at `http://127.0.0.1:8787` with any API key when `CURSOR_PLAN2API_API_KEY` is unset.

---

## 📋 Model catalog & `/v1/models`

### Why the catalog exists

The Cursor CLI often exposes only a small subset of models (typically the three Composer ids). Clients such as **OpenCode** populate their model picker from `GET /v1/models`. Without a catalog, you would see only `composer-2.5`, `composer-2.5-fast`, and `auto` even though your Cursor subscription supports many more models.

Cursor-Plan2API ships a built-in catalog (`src/cursor/catalog.ts`, synced from `agent --list-models`) and merges it with live CLI output so clients get the full list.

### Merge behavior

`GET /v1/models` builds one list from three sources. **Later sources win on id conflicts** (display names from the higher-priority source are kept):

| Priority | Source | Description |
|----------|--------|-------------|
| 1 (highest) | **Live CLI** | Models returned by `agent --list-models` at request time |
| 2 | **Extras** | `CURSOR_PLAN2API_EXTRA_MODELS` — ids not yet in CLI or catalog |
| 3 (lowest) | **Built-in catalog** | ~189 known Cursor model ids (fallback) |

Recommended models (`composer-2.5`, `composer-2.5-fast`, `auto`) are always sorted to the top. The response also includes embedding model ids and a `recommended` array.

```bash
curl http://127.0.0.1:8787/v1/models | jq '.data | length'   # full count
curl http://127.0.0.1:8787/v1/models | jq '.recommended'     # top picks
```

### Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `CURSOR_PLAN2API_INCLUDE_MODEL_CATALOG` | `true` | Include the built-in catalog in `/v1/models` |
| `CURSOR_PLAN2API_EXTRA_MODELS` | — | Comma-separated extra models: `id` or `id=Display Name` |

**Disable the catalog** (CLI models only — smaller list):

```bash
CURSOR_PLAN2API_INCLUDE_MODEL_CATALOG=false cursor-plan2api
```

**Add models** before they appear in CLI or catalog (useful for new Cursor releases):

```bash
CURSOR_PLAN2API_EXTRA_MODELS="cursor-grok-4.5-high=Grok 4.5,claude-opus-4-8-thinking-high" cursor-plan2api
```

### Fable models and data policy

Models whose id contains `fable` (for example `claude-fable-5-thinking-max`) require **Cursor data retention policy acceptance** in the Cursor app. If you have not accepted the policy, chat requests return a data-policy error. Either accept the policy in Cursor settings or skip Fable models in tests with `--skip-fable`.

### Verification status

The model matrix test suite (`npm run test:models`) was run against the full catalog in **ask + non-stream** mode:

| Result | Count |
|--------|-------|
| **Total combinations** | 179 / 179 passed |
| Real chat responses | 42 |
| Skipped as OK (`usage_limit`) | 137 |

`usage_limit` / spend-cap responses are treated as success — the model id is valid and reachable; only the subscription quota blocked a full reply.

---

## 🔌 Other clients

### 🐍 OpenAI Python SDK

```python
from openai import OpenAI

client = OpenAI(base_url="http://127.0.0.1:8787/v1", api_key="not-needed")

for model in ("composer-2.5", "composer-2.5-fast", "auto"):
    r = client.chat.completions.create(
        model=model,
        messages=[{"role": "user", "content": f"Reply with only: {model}"}],
    )
    print(model, "→", r.choices[0].message.content)
```

### 📡 cURL

```bash
curl http://127.0.0.1:8787/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{"model":"composer-2.5-fast","messages":[{"role":"user","content":"Hi"}]}'
```

---

## 📚 API Reference

Base URL: `http://127.0.0.1:8787`

### All endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/health`, `/v1/health` | Health check, CLI version, recommended models |
| `GET` | `/v1/models` | OpenAI-compatible model list (~189 ids + live CLI merge) |
| `GET` | `/v1/usage` | Live subscription usage + per-model `estimated_cost_usd` |
| `POST` | `/v1/chat/completions` | Chat completions (streaming & non-streaming, tools, vision) |
| `POST` | `/v1/messages` | Anthropic Messages API (Claude Code) |
| `POST` | `/v1/responses` | OpenAI Responses API |
| `POST` | `/v1/embeddings` | Semantic embeddings (`semantic` or `local` provider) |
| `POST` | `/v1/images/generations` | Image generation via Cursor `generateImageToolCall` |
| `GET` | `/admin` | HTML dashboard — stats cards + live request log |
| `GET` | `/admin/stats` | JSON dashboard stats (auth, sessions, pool, usage summary) |
| `GET` | `/admin/logs` | JSON request log (`?limit=100`) |
| `GET` | `/admin/logs/stream` | SSE stream of new requests |
| `GET` | `/playground` | Browser chat UI (model picker + stream toggle) |
| `GET` | `/openapi.json` | OpenAPI 3.1 spec (JSON) |
| `GET` | `/docs/openapi.yaml` | OpenAPI 3.1 spec (YAML) |
| `GET` | `/docs` | Redirect to `/docs/openapi.yaml` |

OpenAPI source: [`docs/openapi.yaml`](docs/openapi.yaml). Interactive playground: `http://127.0.0.1:8787/playground`.

### `GET /health`

Returns status, CLI version, `recommended_models`, session settings.

### `GET /v1/models`

Returns OpenAI-compatible model objects. Merges **live CLI** + **extras** + **built-in catalog** (priority: CLI → extras → catalog). Recommended models are listed first; response includes `recommended` and `data` arrays.

See [Model catalog & `/v1/models`](#-model-catalog--v1models) for merge rules, env vars, and Fable data-policy notes.

### `POST /v1/chat/completions`

| Parameter | Type | Description |
|-----------|------|-------------|
| `model` | string | `composer-2.5` (default), `composer-2.5-fast`, `auto`, … |
| `messages` | array | OpenAI message format |
| `stream` | boolean | `true` → SSE |
| `tools` | array | OpenAI function tools (Hermes Agent) |
| `mode` | string | `ask` \| `plan` \| `agent` |
| `reasoning_effort` | string | Emit `reasoning_content` / thinking deltas when set |

### `POST /v1/messages`

Anthropic Messages API compatible endpoint for Claude Code and other Anthropic clients.

```bash
curl -s http://127.0.0.1:8787/v1/messages \
  -H "Content-Type: application/json" \
  -d '{"model":"composer-2.5","max_tokens":1024,"messages":[{"role":"user","content":"Hi"}]}'
```

Supports `stream: true` (Anthropic SSE: `message_start`, `content_block_delta`, `content_block_stop`, `message_delta`, `message_stop`). Tool use blocks map to OpenAI `tool_calls` internally.

### OpenAPI & playground

| Endpoint | Description |
|----------|-------------|
| `GET /openapi.json` | OpenAPI 3.1 spec (JSON) |
| `GET /docs/openapi.yaml` | OpenAPI 3.1 spec (YAML) |
| `GET /docs` | Redirect to `/docs/openapi.yaml` |
| `GET /playground` | Browser chat UI (model picker + stream toggle) |

Open `http://127.0.0.1:8787/playground` after starting the gateway. Pick a model, toggle streaming, and send messages without curl.

### Vision / multimodal notes

The Cursor CLI does not accept raw base64 image bytes on the command line. Cursor-Plan2API decodes `image_url` / Anthropic `image` blocks to **temp files** and injects file paths into the prompt (up to **1 MB** per image, PNG/JPEG/GIF/WebP/BMP/HEIC).

- Multiple images per message are supported (unique temp filenames).
- `https://` image URLs are downloaded (max 1 MB, 15s timeout, MIME validated).
- Vision prompt injection tells the model to read paths directly.
- Temp dirs are removed after each request via `cleanup()`.

Native CLI image attachment flags are not exposed yet; file-path prompting is the supported path today.

### `POST /v1/responses`

OpenAI Responses API compatible endpoint. Maps `input` and `instructions` to the same Cursor CLI runner as chat completions.

```bash
curl -s http://127.0.0.1:8787/v1/responses \
  -H "Content-Type: application/json" \
  -d '{"model":"composer-2.5","input":"Say hello"}'
```

Supports `stream: true` (SSE events: `response.created`, `response.output_text.delta`, `response.completed`).

### `GET /v1/usage`

Returns live Cursor subscription usage from `api2.cursor.sh`. Each model entry includes token counts, request counts, and `estimated_cost_usd` (approximate; Composer subscription models show `$0`).

```bash
curl http://127.0.0.1:8787/v1/usage | jq '.estimated_cost_usd_total, .models'
```

### Admin dashboard & request logs

| Endpoint | Description |
|----------|-------------|
| `GET /admin` | HTML dashboard — stats cards + live request log table |
| `GET /admin/stats` | JSON stats: auth bridge, CLI version, cached sessions, agent pool, compression level, usage summary |
| `GET /playground` | HTML chat playground |
| `GET /admin/logs` | JSON log (`?limit=100`, default 100) |
| `GET /admin/logs/stream` | SSE stream of new requests |

Open `http://127.0.0.1:8787/admin` in a browser. The page fetches `/admin/stats` on load and tails `/admin/logs/stream` for new requests.

```bash
curl http://127.0.0.1:8787/admin/stats | jq '.auth_label, .cached_sessions, .usage_summary'
```

When `CURSOR_PLAN2API_API_KEY` is set, pass `Authorization: Bearer <key>` on API requests; the admin page uses the same origin.

Enable request capture with `CURSOR_PLAN2API_VERBOSE=true` (or `verbose: true` in config).

### Other endpoints

- `POST /v1/embeddings` — semantic embeddings (`semantic` or `local` provider)
- `POST /v1/images/generations` — image generation via Cursor `generateImageToolCall`

### Chat completions extras

| Parameter | Type | Description |
|-----------|------|-------------|
| `response_format` | object | `{ "type": "json_object" }` or `json_schema` for structured output |
| `stream_options` | object | `{ "include_usage": true }` adds `usage` to final SSE chunk |

---

## 🎛️ Request Headers

| Header | Values | Description |
|--------|--------|-------------|
| `Authorization` | `Bearer <token>` | When `CURSOR_PLAN2API_API_KEY` is set |
| `X-Cursor-Mode` | `ask` \| `plan` \| `agent` | CLI execution mode |
| `X-Cursor-Workspace` | path | Workspace for agent mode |
| `X-Plan2API-Client` | `opencode` | Client-specific prompts (OpenCode) |
| `X-Plan2API-Session` | string | Stable session key for resume |

---

## 🧭 Execution Modes

| Mode | Behavior | Best for |
|------|----------|----------|
| `ask` | LLM-only | **Hermes Agent** (client runs tools) |
| `plan` | Structured plan (fast-path) | Architecture, roadmaps |
| `agent` | Full agent — files & shell | **OpenCode**, delegate mode |

---

## ⚙️ Configuration

Configuration merges three layers: **defaults** → **config.yaml** → **environment variables** (env wins on conflict).

### Config file (`config.yaml`)

Copy [`examples/config.yaml`](examples/config.yaml) to `~/.cursor-plan2api/config.yaml` or `./config.yaml`:

```yaml
host: 127.0.0.1
port: 8787
default_model: composer-2.5
mode: ask
client_compat: openrouter

# Context & continuation
max_history_tokens: 80000
compression_level: default   # minimal | default | aggressive
auto_continue_max: 3

# Session resume (persisted to SQLite)
session_resume: true
session_resume_min_chars: 12000
# session_db_path: ~/.cursor-plan2api/sessions.db

# Optional Dashboard API key for /v1/usage on Linux/Windows
# cursor_api_key: your-dashboard-key

# Outbound proxy for usage API and https:// vision downloads
# http_proxy: http://127.0.0.1:8080
# https_proxy: http://127.0.0.1:8080

# Model catalog
include_model_catalog: true
# extra_models:
#   - id: custom-model
#     name: Custom Model

# Performance
agent_pool: false
agent_pool_size: 2
warmup_on_start: true

# Optional local API key
# api_key: your-secret-key
verbose: false
```

### Environment variables

#### Core

| Variable | Default | Description |
|----------|---------|-------------|
| `CURSOR_PLAN2API_HOST` | `127.0.0.1` | Bind address |
| `CURSOR_PLAN2API_PORT` | `8787` | Port |
| `CURSOR_PLAN2API_DEFAULT_MODEL` | `composer-2.5` | Default model |
| `CURSOR_PLAN2API_MODE` | `ask` | Default CLI mode (`ask` \| `plan` \| `agent`) |
| `CURSOR_PLAN2API_CLIENT_COMPAT` | `openrouter` | `openrouter` (Hermes tool loop) or `delegate` (Cursor executes) |
| `CURSOR_PLAN2API_API_KEY` | — | Optional bearer token for all endpoints |
| `CURSOR_PLAN2API_VERBOSE` | `false` | Log requests to admin UI ring buffer |

#### Session & context

| Variable | Default | Description |
|----------|---------|-------------|
| `CURSOR_PLAN2API_SESSION_RESUME` | `true` | Cursor CLI `--resume` for long conversations |
| `CURSOR_PLAN2API_SESSION_RESUME_MIN_CHARS` | `12000` | Min prompt size before resume kicks in |
| `CURSOR_PLAN2API_SESSION_TTL_MS` | `3600000` | Session store TTL (1 hour) |
| `CURSOR_PLAN2API_SESSION_DB_PATH` | `~/.cursor-plan2api/sessions.db` | SQLite path — sessions survive gateway restarts |
| `CURSOR_PLAN2API_MAX_HISTORY_TOKENS` | `80000` | Context compression budget (head+tail truncation) |
| `CURSOR_PLAN2API_COMPRESSION_LEVEL` | `default` | `minimal` (loose), `default`, or `aggressive` (tight) |
| `CURSOR_PLAN2API_AUTO_CONTINUE_MAX` | `3` | Auto-continue retries on truncated output |
| `CURSOR_PLAN2API_COMPACT_TOOLS` | `false` | Compact tool schemas in prompts |
| `CURSOR_PLAN2API_PROFILE_ROTATION` | `none` | `round-robin`, `lru`, or `none` |
| `CURSOR_PLAN2API_PROFILES` | — | JSON array or `name:bin:workspace` tuples |
| `CURSOR_PLAN2API_CURSOR_API_KEY` | — | Dashboard API key (alias: `CURSOR_API_KEY`) for `/v1/usage` |
| `HTTP_PROXY` / `HTTPS_PROXY` | — | Outbound proxy for usage API and `https://` vision downloads |

**Compression levels** (`CURSOR_PLAN2API_COMPRESSION_LEVEL`):

| Level | Effect |
|-------|--------|
| `minimal` | 1.25× token budget, keeps more turns and tool results |
| `default` | Balanced head+tail truncation |
| `aggressive` | 0.6× budget, tighter truncation for very long histories |

**Cursor SDK bridge** — Chat execution always uses the Cursor CLI (`agent login`). Optionally set `CURSOR_API_KEY` (or `cursor_api_key` in config) to enable Dashboard API auth for `GET /v1/usage` and the admin stats panel on Linux/Windows where macOS Keychain is unavailable. Both auth sources can coexist (`cli-subscription+dashboard-api-key`).

#### Model catalog

| Variable | Default | Description |
|----------|---------|-------------|
| `CURSOR_PLAN2API_INCLUDE_MODEL_CATALOG` | `true` | Merge built-in ~189 model catalog into `/v1/models` |
| `CURSOR_PLAN2API_EXTRA_MODELS` | — | Additional models (`id` or `id=Name`, comma-separated) |

#### Performance & CLI

| Variable | Default | Description |
|----------|---------|-------------|
| `CURSOR_PLAN2API_AGENT_POOL` | `false` | Keep warm CLI slots between requests |
| `CURSOR_PLAN2API_AGENT_POOL_SIZE` | `2` | Number of warm slots when pool enabled |
| `CURSOR_PLAN2API_WARMUP_ON_START` | `true` | Warm agent binary on start |
| `CURSOR_PLAN2API_MAX_CONCURRENT` | `4` | Max parallel CLI requests |
| `CURSOR_PLAN2API_TIMEOUT_MS` | `300000` | Per-request CLI timeout (5 min) |
| `CURSOR_PLAN2API_RATE_LIMIT_RETRIES` | `3` | Retries on HTTP 429 from Cursor |
| `CURSOR_PLAN2API_RATE_LIMIT_DELAY_MS` | `2000` | Delay between 429 retries |
| `CURSOR_PLAN2API_PLAN_FAST` | `true` | Plan mode fast-path (~2× faster) |

#### Embeddings & images

| Variable | Default | Description |
|----------|---------|-------------|
| `CURSOR_PLAN2API_EMBEDDING_PROVIDER` | `semantic` | `semantic` (Xenova) or `local` (hash-based) |
| `CURSOR_PLAN2API_EMBEDDING_MODEL` | `Xenova/all-MiniLM-L6-v2` | Semantic embedding model |
| `CURSOR_PLAN2API_EMBEDDING_DIMS` | `384` | Embedding vector dimensions |
| `CURSOR_PLAN2API_IMAGE_MODEL` | `composer-2.5` | Default model for image generation |

#### Other

| Variable | Default | Description |
|----------|---------|-------------|
| `CURSOR_PLAN2API_CORS` | `true` | Enable CORS headers |
| `CURSOR_PLAN2API_HEALTH_PUBLIC` | `false` | Expose detailed health without API key |

#### CLI internals

| Variable | Default | Description |
|----------|---------|-------------|
| `CURSOR_PLAN2API_AGENT_BIN` | `agent` | Path to Cursor CLI binary |
| `CURSOR_PLAN2API_CHAT_ONLY` | `true` | Restrict agent to chat workspace |
| `CURSOR_PLAN2API_STDIN` | `true` | Send prompts via stdin (large prompts) |
| `CURSOR_PLAN2API_TRUST` | `true` | Pass `--trust` to agent |
| `CURSOR_PLAN2API_FORCE` | `true` | Pass `--force` to agent |

Full schema: [`src/config.ts`](src/config.ts).

---

## 🚀 Always-on install (systemd / launchd)

### Linux (systemd)

```bash
sudo cp -r . /opt/cursor-plan2api
cd /opt/cursor-plan2api && npm install && npm run build
sudo cp deploy/systemd/cursor-plan2api.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now cursor-plan2api@$(whoami)
```

### macOS (launchd)

```bash
sudo cp -r . /opt/cursor-plan2api
cd /opt/cursor-plan2api && npm install && npm run build
sudo cp deploy/launchd/com.cursor.plan2api.plist /Library/LaunchDaemons/
sudo launchctl load /Library/LaunchDaemons/com.cursor.plan2api.plist
```

Adjust paths in the unit files if you install elsewhere.

---

## 🐳 Docker

Run on a server or NAS with Cursor CLI auth mounted from the host:

```bash
# Log in on the host first
agent login

# Build and start
docker compose up -d --build

curl http://127.0.0.1:8787/health
```

`docker-compose.yml` mounts `${HOME}/.cursor` read-only for CLI subscription auth. Set `CURSOR_PLAN2API_AGENT_POOL=1` in compose to reduce cold-start latency.

---

## 🛠️ Installation & Daemon

```bash
cursor-plan2api start      # background
cursor-plan2api status
cursor-plan2api stop
tail -f ~/.cursor-plan2api/server.log
```

---

## 🧪 Tests & CI

GitHub Actions runs on every push to `main` / `cursor/**` branches: `npm ci` → `npm run build` → `npm run test:unit` → `npm run test:catalog` → OpenAPI YAML validation. See [`.github/workflows/ci.yml`](.github/workflows/ci.yml).

```bash
npm run test:catalog      # compare agent --list-models vs src/cursor/catalog.ts (CI gate)
```

```bash
npm run test              # full integration suite (requires running gateway)
npm run test:unit         # unit tests only (CI-safe)
npm run test:edge         # edge cases
npm run test:all          # full + edge
```

### Model matrix (`npm run test:models`)

Exercises every chat model from `GET /v1/models` across modes and stream settings. Requires a running gateway and `agent login`.

**Prerequisites:** `cursor-plan2api` running, `npm run build` done.

```bash
# List models without running requests
npm run test:models -- --list-only

# Fast smoke: ask mode, non-streaming only (how the 179/179 run was done)
npm run test:models -- --modes=ask --no-stream

# Throttle + resume after interruption (state saved to model-matrix-state.json)
npm run test:models -- --modes=ask --no-stream --delay=45000 --resume

# Skip Fable models (data policy not accepted)
npm run test:models -- --skip-fable --delay=45000

# Subset of models
npm run test:models -- --models=composer-2.5,auto --modes=ask
```

| Flag | Default | Description |
|------|---------|-------------|
| `--modes` | `ask,plan,agent` | Comma-separated CLI modes to test |
| `--no-stream` | — | Skip streaming cases |
| `--no-non-stream` | — | Skip non-streaming cases |
| `--delay` | `0` | Milliseconds to wait between cases (rate-limit friendly) |
| `--resume` | — | Skip combinations already marked OK in state file |
| `--state-file` | `model-matrix-state.json` | Resume checkpoint path |
| `--skip-fable` | — | Omit models whose id contains `fable` |
| `--list-only` | — | Print model ids and exit |
| `--base-url` | `http://127.0.0.1:8787` | Gateway URL |
| `--timeout` | `180000` | Per-request timeout (ms) |

**Exit codes:** `0` when all cases pass. Subscription `usage_limit` responses count as pass. True failures (unknown model, auth error, empty response) exit `1`.

---

## 🏗️ Project Structure

```text
Cursor-Plan2API/
├── Dockerfile / docker-compose.yml
├── deploy/
│   ├── systemd/cursor-plan2api.service
│   └── launchd/com.cursor.plan2api.plist
├── docs/
│   ├── openapi.yaml                # OpenAPI 3.1 spec (served at /docs)
│   └── competitor-analysis.md      # Feature parity vs competitors
├── examples/
│   ├── config.yaml                 # Full config reference
│   └── hermes-config.yaml
├── opencode.jsonc                  # OpenCode provider (3 recommended models)
├── scripts/model-matrix-test.mjs   # Full model catalog test suite
├── src/
│   ├── config.ts                   # Zod config schema (yaml + env)
│   ├── handlers/
│   │   ├── chat-completions.ts     # POST /v1/chat/completions
│   │   ├── messages.ts             # POST /v1/messages (Anthropic)
│   │   ├── responses.ts            # POST /v1/responses
│   │   ├── admin.ts                # GET /admin, /admin/stats, /admin/logs
│   │   ├── playground.ts           # GET /playground
│   │   ├── docs.ts                 # GET /openapi.json, /docs
│   │   └── usage.ts                # GET /v1/usage + cost estimates
│   ├── anthropic/
│   │   ├── convert.ts              # Anthropic ↔ OpenAI message mapping
│   │   └── stream.ts               # Anthropic SSE event stream
│   ├── cursor/
│   │   ├── catalog.ts              # Built-in ~189 model ids
│   │   ├── agent-pool.ts           # Warm CLI slot pool
│   │   ├── profile-rotator.ts      # Multi-profile round-robin / LRU
│   │   └── pricing.ts              # Per-model cost estimation
│   └── openai/
│       ├── context-budget.ts       # MAX_HISTORY_TOKENS compression
│       ├── auto-continue.ts        # Truncation auto-continue
│       ├── compact-tools.ts        # Compact tool schema mode
│       ├── tool-fixer.ts           # Tool parameter normalization
│       ├── vision.ts               # Base64 images → temp files
│       └── hermes-mode.ts          # Hermes Agent / OpenCode client logic
├── .github/workflows/ci.yml          # Build + unit tests + OpenAPI validate
└── dist/
```

---

## ❓ Troubleshooting

| Problem | Solution |
|---------|----------|
| Hermes Agent / OpenCode can't connect | Start gateway: `cursor-plan2api` |
| OpenCode shows code but no files | Use `opencode.jsonc` with `X-Cursor-Mode: agent` |
| Model says "I'm Composer in Cursor" | Restart OpenCode (needs `X-Plan2API-Client: opencode`) |
| Slow responses (~20s/turn) | Enable `CURSOR_PLAN2API_AGENT_POOL=1` and session resume; CLI spawn overhead remains per request |
| `agent login` required | `curl https://cursor.com/install -fsS \| bash && agent login` |
| Fable model: data policy error | Accept Cursor data retention policy, or use `--skip-fable` in tests |
| OpenCode shows only 3 models | Restart gateway; ensure `CURSOR_PLAN2API_INCLUDE_MODEL_CATALOG=true` (default) |
| `usage_limit` in matrix test | Expected for quota-capped models — counted as pass, not failure |

---

## 📄 License

MIT — Not an official Cursor product.

---

<p align="center">
  <strong>Hermes Agent compatible · OpenCode compatible · OpenAI API compatible · Cursor.ai subscription</strong><br>
  <sub>Built for developers who want their Cursor sub in any OpenAI client</sub>
</p>

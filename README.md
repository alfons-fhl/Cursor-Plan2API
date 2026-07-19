# 🚀 Cursor-Plan2API

> **✅ Hermes Agent compatible** · **✅ OpenCode compatible** · **✅ OpenAI API compatible**
>
> **Use your [Cursor.ai](https://cursor.com) subscription as an OpenAI-compatible API** — locally, on your machine.

**Run [Hermes Agent](https://github.com/NousResearch/hermes-agent) or OpenCode with your Cursor subscription** — no official Dashboard `CURSOR_API_KEY`, no third-party bridge.

| Client | Status | What you get |
|--------|--------|--------------|
| **Hermes Agent** | **✅ Supported** | OpenRouter-style tool loop — Hermes Agent runs tools locally |
| **[OpenCode](https://opencode.ai)** | **✅ Supported** | Full agent mode — files & shell on your machine |
| OpenAI SDK / LangChain / n8n | ✅ Supported | Standard `/v1/chat/completions` |

```text
┌────────────┐    POST /v1/chat/completions    ┌──────────────────┐   agent CLI   ┌────────────┐
│Hermes Agent│         ─────────────►          │ Cursor-Plan2API  │   ───────►    │   Cursor   │
│  OpenCode  │         ◄─────────────          │  localhost:8787  │   ◄───────    │composer-2.5│
└────────────┘        OpenAI JSON / SSE        └──────────────────┘               └────────────┘
```

[![Node](https://img.shields.io/badge/node-%3E%3D20-brightgreen)]()
[![License](https://img.shields.io/badge/license-MIT-blue)]()
[![OpenAI API](https://img.shields.io/badge/OpenAI%20API-compatible-412991)]()
[![Hermes Agent](https://img.shields.io/badge/Hermes%20Agent-compatible-7C3AED)]()
[![OpenCode](https://img.shields.io/badge/OpenCode-compatible-0EA5E9)]()

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

> **Note:** ~15–20s per turn is normal — each request spawns a new `agent` CLI process.

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

### `POST /v1/responses`

OpenAI Responses API compatible endpoint. Maps `input` and `instructions` to the same Cursor CLI runner as chat completions.

```bash
curl -s http://127.0.0.1:8787/v1/responses \
  -H "Content-Type: application/json" \
  -d '{"model":"composer-2.5","input":"Say hello"}'
```

Supports `stream: true` (SSE events: `response.created`, `response.output_text.delta`, `response.completed`).

### Other endpoints

- `GET /v1/usage` — subscription usage
- `POST /v1/embeddings` — semantic embeddings
- `POST /v1/images/generations` — image generation

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

## ⚙️ Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `CURSOR_PLAN2API_PORT` | `8787` | Port |
| `CURSOR_PLAN2API_DEFAULT_MODEL` | `composer-2.5` | Default model |
| `CURSOR_PLAN2API_MODE` | `ask` | Default CLI mode |
| `CURSOR_PLAN2API_CLIENT_COMPAT` | `openrouter` | `openrouter` or `delegate` |
| `CURSOR_PLAN2API_SESSION_RESUME` | `true` | Cursor CLI `--resume` |
| `CURSOR_PLAN2API_WARMUP_ON_START` | `true` | Warm agent binary on start |
| `CURSOR_PLAN2API_AGENT_POOL` | `false` | Keep warm CLI slots between requests |
| `CURSOR_PLAN2API_AGENT_POOL_SIZE` | `2` | Number of warm slots when pool enabled |
| `CURSOR_PLAN2API_INCLUDE_MODEL_CATALOG` | `true` | Merge built-in model catalog into `/v1/models` |
| `CURSOR_PLAN2API_EXTRA_MODELS` | — | Additional models (`id` or `id=Name`, comma-separated) |
| `CURSOR_PLAN2API_API_KEY` | — | Optional bearer token |
| `CURSOR_PLAN2API_VERBOSE` | `false` | Request logging |

See full list in source [`src/config.ts`](src/config.ts).

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

## 🧪 Tests

```bash
npm run test              # full integration suite
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
├── opencode.jsonc                  # OpenCode provider (3 recommended models)
├── examples/hermes-config.yaml
├── scripts/model-matrix-test.mjs   # Full model catalog test suite
├── src/
│   ├── models.ts                   # Recommended model IDs + sorting
│   ├── cursor/catalog.ts           # Built-in ~189 model ids
│   ├── cursor/models.ts            # Catalog merge + EXTRA_MODELS parser
│   ├── openai/hermes-mode.ts       # Hermes Agent / OpenCode client logic
│   └── cursor/session-store.ts
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

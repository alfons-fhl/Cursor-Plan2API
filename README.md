# 🚀 Cursor-Plan2API

> **Use your [Cursor.ai](https://cursor.com) subscription as an OpenAI-compatible API** — locally, on your machine.

## ✅ **Hermes-compatible** · ✅ **OpenCode-compatible**

**Run Hermes Agent or OpenCode with your Cursor subscription** — no official Dashboard `CURSOR_API_KEY`, no third-party bridge.

| Client | Status | What you get |
|--------|--------|--------------|
| **[Hermes Agent](https://github.com/NousResearch/hermes-agent)** | **✅ Supported** | OpenRouter-style tool loop — Hermes runs tools locally |
| **[OpenCode](https://opencode.ai)** | **✅ Supported** | Full agent mode — files & shell on your machine |
| OpenAI SDK / LangChain / n8n | ✅ Supported | Standard `/v1/chat/completions` |

```text
┌──────────────┐   Hermes / OpenCode / SDK   ┌──────────────────┐   agent CLI   ┌─────────────┐
│ Hermes Agent │ ───────────────────────────►│ Cursor-Plan2API  │ ─────────────►│ Cursor Sub  │
│   OpenCode   │ ◄───────────────────────────│  localhost:8787  │ ◄─────────────│ Composer 2.5│
└──────────────┘      OpenAI JSON / SSE      └──────────────────┘               └─────────────┘
```

[![Node](https://img.shields.io/badge/node-%3E%3D20-brightgreen)]()
[![License](https://img.shields.io/badge/license-MIT-blue)]()
[![OpenAI API](https://img.shields.io/badge/OpenAI%20API-compatible-412991)]()
[![Hermes](https://img.shields.io/badge/Hermes-compatible-7C3AED)]()
[![OpenCode](https://img.shields.io/badge/OpenCode-compatible-0EA5E9)]()

---

## 🎯 Recommended models (always use these three)

These are the **primary models** for Hermes, OpenCode, and API clients:

| Model ID | Name | When to use |
|----------|------|-------------|
| `composer-2.5` | **Composer 2.5** | Default — best balance of quality and speed |
| `composer-2.5-fast` | **Composer 2.5 Fast** | Faster responses, good for chat & tool loops |
| `auto` | **Auto** | Let Cursor pick the model automatically |

```bash
# Hermes
hermes -z "Hello" -m composer-2.5
hermes -z "Quick task" -m composer-2.5-fast
hermes -z "Route me" -m auto

# OpenCode (/models)
cursor-plan2api/composer-2.5
cursor-plan2api/composer-2.5-fast
cursor-plan2api/auto
```

`GET /v1/models` returns all Cursor CLI models; the three above are listed first as **recommended**.

---

## 📖 What is this?

**Cursor-Plan2API** is a local HTTP proxy that turns your **Cursor CLI subscription** (`agent login`) into an **OpenAI-compatible REST API** on `http://127.0.0.1:8787/v1`.

### ✨ Features

| Feature | Description |
|---------|-------------|
| 🤖 **Hermes-compatible** | OpenRouter-style `tool_calls` — Hermes executes tools locally |
| 🧩 **OpenCode-compatible** | Agent mode + workspace headers — real file/shell execution |
| 💬 **Chat Completions** | Streaming & non-streaming, real token usage from CLI |
| 🔧 **Tool Calling** | OpenAI `tool_calls` + streaming deltas |
| 🧠 **Embeddings** | Semantic vectors via `all-MiniLM-L6-v2` |
| 🎨 **Image Generation** | Native Cursor `generateImageToolCall` |
| 📊 **Usage API** | Live subscription usage from `api2.cursor.sh` |
| ⚡ **Plan Fast-Path** | Plan mode ~2× faster (ask + planning prompt) |
| 🔁 **Session Resume** | Reuse Cursor CLI sessions on large multi-turn prompts |
| 🔒 **Optional Auth** | Local bearer token for the proxy |
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

### 2. Configure Hermes

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

### 3. Run Hermes

```bash
hermes -z "Hello, are you connected?" -m composer-2.5
hermes -z "Fast turn" -m composer-2.5-fast
hermes -z "Auto route" -m auto
```

### Hermes tool modes

| `CURSOR_PLAN2API_CLIENT_COMPAT` | Behavior |
|----------------------------------|----------|
| `openrouter` (default) | Ask mode — model returns `tool_calls`, **Hermes runs tools** |
| `delegate` | Agent mode — **Cursor executes** files/shell directly |

```bash
# Default: OpenRouter-style (Hermes tool loop)
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

Preconfigured provider `cursor-plan2api` with three models:

- `cursor-plan2api/composer-2.5`
- `cursor-plan2api/composer-2.5-fast`
- `cursor-plan2api/auto`

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

Live Cursor CLI models. **Recommended models appear first:**

`composer-2.5` · `composer-2.5-fast` · `auto`

### `POST /v1/chat/completions`

| Parameter | Type | Description |
|-----------|------|-------------|
| `model` | string | `composer-2.5` (default), `composer-2.5-fast`, `auto`, … |
| `messages` | array | OpenAI message format |
| `stream` | boolean | `true` → SSE |
| `tools` | array | OpenAI function tools (Hermes) |
| `mode` | string | `ask` \| `plan` \| `agent` |

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
| `ask` | LLM-only | **Hermes** (client runs tools) |
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
| `CURSOR_PLAN2API_API_KEY` | — | Optional bearer token |
| `CURSOR_PLAN2API_VERBOSE` | `false` | Request logging |

See full list in source [`src/config.ts`](src/config.ts).

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
npm run test
npm run test:edge
npm run test:all
```

---

## 🏗️ Project Structure

```text
Cursor-Plan2API/
├── opencode.jsonc             # OpenCode provider (3 models)
├── examples/hermes-config.yaml
├── src/
│   ├── models.ts              # Recommended model IDs
│   ├── openai/hermes-mode.ts  # Hermes / OpenCode client logic
│   └── cursor/session-store.ts
└── dist/
```

---

## ❓ Troubleshooting

| Problem | Solution |
|---------|----------|
| Hermes/OpenCode can't connect | Start gateway: `cursor-plan2api` |
| OpenCode shows code but no files | Use `opencode.jsonc` with `X-Cursor-Mode: agent` |
| Model says "I'm Composer in Cursor" | Restart OpenCode (needs `X-Plan2API-Client: opencode`) |
| Slow responses (~20s/turn) | Normal — CLI spawn overhead per request |
| `agent login` required | `curl https://cursor.com/install -fsS \| bash && agent login` |

---

## 📄 License

MIT — Not an official Cursor product.

---

<p align="center">
  <strong>Hermes-compatible · OpenCode-compatible · Cursor.ai subscription</strong><br>
  <sub>Built for developers who want their Cursor sub in any OpenAI client</sub>
</p>

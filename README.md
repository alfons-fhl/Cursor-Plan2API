# 🚀 Cursor-Plan2API

> **Cursor subscription → OpenAI-compatible API** — Use Composer 2.5, embeddings, images & tool calling from any OpenAI client.

[![Node](https://img.shields.io/badge/node-%3E%3D20-brightgreen)]()
[![License](https://img.shields.io/badge/license-MIT-blue)]()
[![OpenAI API](https://img.shields.io/badge/OpenAI%20API-compatible-412991)]()

---

## 📖 What is this?

**Cursor-Plan2API** is a local HTTP proxy that turns your **Cursor CLI subscription** (`agent login`) into an **OpenAI-compatible REST API**.

Connect **Hermes**, the **OpenAI SDK**, **LangChain**, **Continue**, **n8n**, or any OpenAI-compatible tool to your **Cursor subscription** — **without** an official Dashboard `CURSOR_API_KEY` and **without** third-party bridges like cursorbridge.dev.

```text
┌─────────────┐     POST /v1/chat/completions     ┌──────────────────┐     agent CLI      ┌─────────────┐
│   Hermes    │ ─────────────────────────────────►│ Cursor-Plan2API  │ ──────────────────►│   Cursor    │
│  OpenAI SDK │ ◄─────────────────────────────────│  localhost:8787  │ ◄──────────────────│ composer-2.5│
└─────────────┘         OpenAI JSON / SSE           └──────────────────┘                    └─────────────┘
```

### ✨ Features

| Feature | Description |
|---------|-------------|
| 💬 **Chat Completions** | Streaming & non-streaming, real token usage from CLI |
| 🔧 **Tool Calling** | OpenAI `tool_calls` + streaming deltas (Hermes-ready) |
| 🧠 **Embeddings** | Semantic vectors via `all-MiniLM-L6-v2` |
| 🎨 **Image Generation** | Native Cursor `generateImageToolCall` |
| 📊 **Usage API** | Live subscription usage from `api2.cursor.sh` |
| ⚡ **Plan Fast-Path** | Plan mode ~2× faster (ask + planning prompt) |
| 🔒 **Optional Auth** | Local bearer token for the proxy |
| 🔄 **429 Retry** | Automatic retry on rate limits |
| 🌐 **CORS** | Browser clients supported |
| 🖥️ **Daemon** | `start` / `stop` / `status` in the background |

---

## 📋 Prerequisites

- **Node.js** ≥ 20
- **Cursor CLI** installed & logged in

```bash
# Install Cursor CLI (macOS / Linux)
curl https://cursor.com/install -fsS | bash

# Log in (subscription auth)
agent login

# Verify
agent status
# → logged in as your@email.com
```

---

## ⚡ Quick Start

```bash
# 1. Install dependencies
npm install

# 2. Build (dist/ may already be included)
npm run build

# 3. Link globally (optional)
npm link

# 4. Start the server
cursor-plan2api
```

Output:

```text
Cursor-Plan2API running
  auth          cursor-cli subscription (agent login)
  default model composer-2.5
  base url      http://127.0.0.1:8787/v1
  health        http://127.0.0.1:8787/health
```

**Smoke test:**

```bash
curl http://127.0.0.1:8787/health
```

---

## 🛠️ Installation & Daemon

### Foreground (development)

```bash
cursor-plan2api
# or
npm start
```

### Background daemon

```bash
cursor-plan2api start      # Start in background
cursor-plan2api status     # PID + log path
cursor-plan2api stop       # Stop daemon
cursor-plan2api restart    # Restart

# Logs
tail -f ~/.cursor-plan2api/server.log
```

### Custom port

```bash
CURSOR_PLAN2API_PORT=9000 cursor-plan2api start 9000
```

---

## 🔌 Client Integration

### 🤖 Hermes Agent

`~/.hermes/config.yaml`:

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

Run:

```bash
hermes -z "Hello, are you connected?" -m composer-2.5
```

### 🐍 OpenAI Python SDK

```python
from openai import OpenAI

client = OpenAI(
    base_url="http://127.0.0.1:8787/v1",
    api_key="not-needed",
)

response = client.chat.completions.create(
    model="composer-2.5",
    messages=[{"role": "user", "content": "Reply with only: connected"}],
)
print(response.choices[0].message.content)
print(response.usage)
```

### 📡 cURL — Streaming

```bash
curl -N http://127.0.0.1:8787/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "composer-2.5",
    "stream": true,
    "messages": [{"role": "user", "content": "Explain SSE in one sentence"}]
  }'
```

### 🔧 Tool Calling

```bash
curl http://127.0.0.1:8787/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "composer-2.5",
    "messages": [{"role": "user", "content": "Calculate 12*8 using the calculator"}],
    "tools": [{
      "type": "function",
      "function": {
        "name": "calculator",
        "description": "Evaluate math expressions",
        "parameters": {
          "type": "object",
          "properties": { "expression": { "type": "string" } },
          "required": ["expression"]
        }
      }
    }]
  }'
```

Response on tool use: `finish_reason: "tool_calls"` with `tool_calls[]`.

---

## 📚 API Reference

Base URL: `http://127.0.0.1:8787`

### `GET /health` · `GET /v1/health`

Health check. Returns status, CLI version, and available endpoints.

```bash
curl http://127.0.0.1:8787/health
```

---

### `GET /v1/models`

Lists Cursor CLI models live, plus any configured extras (+ embedding models).

```bash
curl http://127.0.0.1:8787/v1/models
```

Example IDs: `composer-2.5`, `auto`, `cursor-grok-4.5-high`, `claude-opus-4-7-thinking-high`, …

**Extra models:** If your client only shows the 3 default Composer models from `agent --list-models`, add more via `CURSOR_PLAN2API_EXTRA_MODELS`. Chat requests already accept any model id — this only extends the model picker.

```bash
CURSOR_PLAN2API_EXTRA_MODELS="cursor-grok-4.5-high=Grok 4.5,claude-opus-4-7-thinking-high=Claude Opus 4.7"
```

Format: comma-separated `id` or `id=Display Name`.

---

### `GET /v1/usage`

Cursor subscription usage (macOS Keychain token → `api2.cursor.sh`).

```bash
curl http://127.0.0.1:8787/v1/usage
```

---

### `POST /v1/chat/completions`

OpenAI-compatible chat endpoint.

| Parameter | Type | Description |
|-----------|------|-------------|
| `model` | string | e.g. `composer-2.5` (default) |
| `messages` | array | OpenAI message format |
| `stream` | boolean | `true` → SSE |
| `tools` | array | OpenAI function tools |
| `mode` | string | `ask` \| `plan` \| `agent` |

**Token usage** comes from the CLI (`inputTokens` / `outputTokens`), not estimated.

---

### `POST /v1/embeddings`

Semantic embeddings (default) or local deterministic fallback.

```bash
curl http://127.0.0.1:8787/v1/embeddings \
  -H "Content-Type: application/json" \
  -d '{"input": ["Hello world", "Hola mundo"]}'
```

| Model ID | Provider | Dims |
|----------|----------|------|
| `text-embedding-plan2api-semantic` | Transformers (MiniLM) | 384 |
| `text-embedding-plan2api-local` | Deterministic hash | configurable |

---

### `POST /v1/images/generations`

Image generation via Cursor's native `generateImageToolCall`.

```bash
curl http://127.0.0.1:8787/v1/images/generations \
  -H "Content-Type: application/json" \
  -d '{
    "prompt": "a red circle on a white background",
    "size": "512x512",
    "response_format": "b64_json"
  }'
```

Supported sizes: `256x256`, `512x512`, `1024x1024`

---

## 🎛️ Request Headers

| Header | Values | Description |
|--------|--------|-------------|
| `Authorization` | `Bearer <token>` | Required when `CURSOR_PLAN2API_API_KEY` is set |
| `X-Cursor-Mode` | `ask` \| `plan` \| `agent` | CLI execution mode |
| `X-Cursor-Workspace` | path | Workspace for the agent |

**Mode priority:** `body.mode` > `X-Cursor-Mode` > config default  
On conflict → `400 Mode conflict`

---

## 🧭 Execution Modes

| Mode | Behavior | Best for |
|------|----------|----------|
| `ask` ✅ | LLM-only, no CLI tools | **Hermes** (client runs tools) |
| `plan` 📋 | Structured plan (fast-path: ask + prompt) | Architecture, roadmaps |
| `agent` 🤖 | Full agent with shell/files | Images, code execution |

Default: `ask` — Hermes keeps tool control.

---

## ⚙️ Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `CURSOR_PLAN2API_HOST` | `127.0.0.1` | Bind address |
| `CURSOR_PLAN2API_PORT` | `8787` | Port |
| `CURSOR_PLAN2API_DEFAULT_MODEL` | `composer-2.5` | Default model |
| `CURSOR_PLAN2API_MODE` | `ask` | Default CLI mode |
| `CURSOR_PLAN2API_API_KEY` | — | Optional local bearer token |
| `CURSOR_PLAN2API_CHAT_ONLY` | `true` | Isolated temp workspace |
| `CURSOR_PLAN2API_STDIN` | `true` | Prompt via stdin (no arg limit) |
| `CURSOR_PLAN2API_MAX_CONCURRENT` | `4` | Parallel CLI processes |
| `CURSOR_PLAN2API_RATE_LIMIT_RETRIES` | `3` | 429 retries |
| `CURSOR_PLAN2API_CORS` | `true` | Enable CORS |
| `CURSOR_PLAN2API_VERBOSE` | `false` | Request logging |
| `CURSOR_PLAN2API_EMBEDDING_PROVIDER` | `semantic` | `semantic` or `local` |
| `CURSOR_PLAN2API_PLAN_FAST` | `true` | Fast plan mode shortcut |
| `CURSOR_PLAN2API_EXTRA_MODELS` | — | Extra models for `GET /v1/models` (`id` or `id=Name`, comma-separated) |
| `CURSOR_PLAN2API_HEALTH_PUBLIC` | `false` | Allow `/health` without auth |
| `CURSOR_PLAN2API_TIMEOUT_MS` | `300000` | CLI timeout (5 min) |
| `CURSOR_PLAN2API_AGENT_BIN` | `agent` | Path to Cursor CLI |

> 💡 Legacy: `HC_CURSOR_PROXY_*` env vars are still supported as fallback.

### Example `.env`

```bash
CURSOR_PLAN2API_PORT=8787
CURSOR_PLAN2API_DEFAULT_MODEL=composer-2.5
CURSOR_PLAN2API_MODE=ask
CURSOR_PLAN2API_EMBEDDING_PROVIDER=semantic
CURSOR_PLAN2API_PLAN_FAST=true
CURSOR_PLAN2API_EXTRA_MODELS=cursor-grok-4.5-high=Grok 4.5
```

---

## 🧪 Tests

```bash
npm run test        # 98 integration + unit tests (~5 min)
npm run test:edge   # Edge cases & combinations (~7 min)
npm run test:all    # Everything
```

---

## 🏗️ Project Structure

```text
Cursor-Plan2API/
├── src/
│   ├── cli.ts                 # Entry + daemon commands
│   ├── server.ts              # HTTP router + CORS
│   ├── config.ts              # Zod env config
│   ├── cursor/                # CLI spawn, stream-json, images
│   ├── openai/                # Prompt, response, embeddings
│   └── handlers/              # Route handlers
├── scripts/
│   ├── full-test.mjs          # Full test suite
│   └── edge-test.mjs          # Edge-case tests
└── dist/                      # Compiled JS (gitignored)
```

---

## ❓ Troubleshooting

| Problem | Solution |
|---------|----------|
| `Cursor CLI check failed` | Run `agent login` |
| `401 Invalid bridge API key` | Send correct bearer token or remove API key |
| `Mode conflict` | Set only `body.mode` **or** `X-Cursor-Mode`, not both |
| Slow responses | Expected — each request spawns a new `agent` (~15–30s) |
| Embeddings slow (first run) | Model download (~90 MB), then cached |
| Port in use | `lsof -ti:8787 \| xargs kill` or use another port |

---

## 📄 License

MIT — Free to use, modify, and distribute.

---

<p align="center">
  <sub>Built with ❤️ for Cursor subscription users · Not an official Cursor product</sub>
</p>

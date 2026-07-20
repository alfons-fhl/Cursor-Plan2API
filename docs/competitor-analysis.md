# Competitor Analysis: Cursor-to-API Landscape

**Date:** 2026-07-19  
**Our project:** [Cursor-Plan2API](../README.md) — TypeScript/Node, OpenAI-compatible bridge for **Cursor CLI subscription** (`agent login`), Hermes Agent, OpenCode, ~189 model catalog, session resume, delegate mode, embeddings, images.

---

## Executive positioning

| Dimension | Cursor-Plan2API | Typical competitors |
|-----------|-----------------|---------------------|
| **Auth model** | Cursor CLI subscription (`agent login`) | Cookie scraping, web API reverse-engineering, or Dashboard API key |
| **Legal/ToS posture** | Strongest — uses official CLI | Weak — session tokens, fingerprints, undocumented APIs |
| **Primary clients** | Hermes Agent, OpenCode, OpenAI SDK | Claude Code, ChatBox, Cursor IDE BYOK |
| **Deployment** | Local daemon, no Docker yet | Docker/systemd everywhere |
| **Protocol breadth** | Chat Completions only | Often + Anthropic Messages + `/v1/responses` |

**Strategic thesis:** We win on *subscription-native, agent-client-first* workflows. We lose on *protocol coverage, deployment ergonomics, and latency* until we close the gaps below.

---

## Repos analyzed

| # | Repo | Stars | Lang | Status | Relevance |
|---|------|-------|------|--------|-----------|
| 1 | [7836246/cursor2api](https://github.com/7836246/cursor2api) | 1,850 | TypeScript | Active (v2.7.8) | **Direct** — richest feature set, web-API based |
| 2 | [Xchat1/cursor2api-go](https://github.com/Xchat1/cursor2api-go) | 1,067 | Go | Active (README notes service down) | **Direct** — web API, Docker, web UI |
| 3 | [wisdgod/cursor-api](https://github.com/wisdgod/cursor-api) | 691 | Rust | **Archived** | Historical — cookie auth, multi-token |
| 4 | [zhx47/cursor-api](https://github.com/zhx47/cursor-api) | 268 | JavaScript | Active | Direct — minimal cookie proxy |
| 5 | [h88782481/api2cursor](https://github.com/h88782481/api2cursor) | 267 | Python | Active | **Adjacent** — reverse direction (third-party API → Cursor) |
| 6 | [gavilanch/CursoRESTfulAPIsASPNETCore](https://github.com/gavilanch/CursoRESTfulAPIsASPNETCore) | 221 | C# | Course repo | **Unrelated** — ASP.NET WebAPI course (Spanish) |
| 7 | [jhhgiyv/cursorweb2api](https://github.com/jhhgiyv/cursorweb2api) | 143 | Python | Active | Direct — web scrape + fingerprint |
| 8 | [standardagents/composer-api](https://github.com/standardagents/composer-api) | 275 | Swift/TS | Active | **Closest competitor** — Composer via Cursor SDK/API key, same port 8787 |

---

## Our current feature inventory

### Strengths (keep & extend)

| Feature | Implementation | Competitor gap |
|---------|----------------|----------------|
| CLI subscription auth | `agent login` via `src/cursor/cli.ts` | Most use cookies or undocumented web APIs |
| Hermes Agent compat | `src/openai/hermes-mode.ts`, OpenRouter tool loop | Unique — none target Hermes specifically |
| OpenCode compat | `X-Plan2API-Client`, agent prompts, `opencode.jsonc` | composer-api has Agent Setup; we are deeper |
| Model catalog (~189) | `src/cursor/catalog.ts` + CLI merge | Broader than composer-api's 4 primary models |
| Session resume | `src/cursor/session-store.ts` + CLI `--resume` | Rare; composer-api has SDK session DB |
| Delegate vs OpenRouter mode | `CURSOR_PLAN2API_CLIENT_COMPAT` | Unique execution-model switch |
| Plan fast-path | `src/openai/plan-mode.ts` | Unique |
| Embeddings | `src/handlers/embeddings.ts` (Xenova semantic) | Unique among competitors |
| Image generation | `src/handlers/images.ts` (native Cursor tool) | Unique among competitors |
| Usage API | `GET /v1/usage` from `api2.cursor.sh` | Unique among competitors |
| Model matrix tests | `scripts/model-matrix-test.mjs` (179/179) | Best-in-class verification |
| 429 retry + concurrency | `src/concurrency.ts`, `src/cursor/cli.ts` | Partial parity |
| Daemon CLI | `src/daemon.ts` start/stop/status | Partial parity |

### Known limitations

| Gap | Current behavior |
|-----|------------------|
| No Docker / compose | Manual `npm install && build` only |
| No `/v1/responses` | Cursor IDE + newer SDK clients blocked |
| No `/v1/messages` (Anthropic) | Claude Code unsupported |
| Vision / multimodal | `image_url` → text placeholder `[Image: url]` in `src/openai/prompt.ts` |
| No `reasoning_content` / thinking blocks | Thinking models lose chain-of-thought |
| ~15–20s per turn | New `agent` process per request |
| Single account | One CLI login, no rotation |
| No admin / log UI | `VERBOSE` console only |
| No context compression | Full prompt sent every turn |
| No truncation continue | Long outputs cut off |
| No `response_format` | JSON mode unsupported |
| No `stream_options.include_usage` | Streaming usage not in final chunk |
| Images in chat only as placeholders | Not passed to CLI vision |

---

## Feature comparison matrix

Legend: ✅ full · ⚠️ partial · ❌ none · ➖ N/A (different purpose) · 🚫 anti-pattern

| Feature | **Plan2API** | cursor2api | cursor2api-go | wisdgod | zhx47 | api2cursor | cursorweb2api | composer-api |
|---------|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|
| **Auth: CLI subscription** | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| **Auth: API key / cookie** | ❌ | web | web | cookie | cookie | upstream | web+FP | API key |
| **POST /v1/chat/completions** | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| **POST /v1/responses** | ❌ | ✅ | ❌ | ❌ | ❌ | ✅ | ❌ | ✅ |
| **POST /v1/messages (Anthropic)** | ❌ | ✅ | ❌ | ❌ | ❌ | ✅ | ❌ | ❌ |
| **GET /v1/models** | ✅ (~189) | ✅ | ✅ (2) | ✅ dynamic | ✅ | ✅ mapped | ✅ env | ✅ (4+) |
| **Streaming SSE** | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| **Tool calling** | ✅ | ✅ | ✅ | ✅ | ⚠️ | ✅ | ⚠️ opt-in | ⚠️ CC only |
| **Vision / images in chat** | ❌ | ✅ OCR/API | ❌ | ✅ | ⚠️ | ➖ | ❌ | ✅ ≤1MB |
| **Thinking / reasoning** | ❌ | ✅ | ✅ *-thinking | ⚠️ | ❌ | ✅ | ❌ | ⚠️ |
| **Session resume** | ✅ CLI | ⚠️ compress | ❌ | ❌ | ❌ | ➖ | ❌ | ✅ SDK DB |
| **Multi-account rotation** | ❌ | ❌ | ❌ | ✅ | ✅ comma keys | ➖ | ❌ | ✅ hosted |
| **Context compression** | ❌ | ✅ 3 levels | ❌ | ❌ | ❌ | ➖ | ❌ | ❌ |
| **Truncation auto-continue** | ❌ | ✅ | ❌ | ❌ | ❌ | ➖ | ✅ | ❌ |
| **Tool param fixer** | ❌ | ✅ | ❌ | ❌ | ❌ | ✅ | ❌ | ⚠️ |
| **Embeddings** | ✅ | ❌ | ❌ | ❌ | ❌ | ➖ | ❌ | ❌ |
| **Image generation** | ✅ | ⚠️ | ❌ | ❌ | ❌ | ➖ | ❌ | ❌ |
| **Usage / billing API** | ✅ sub | ❌ | ❌ | ❌ | ❌ | ✅ debug | ❌ | ✅ cost est. |
| **Admin / log UI** | ❌ | ✅ /logs | ✅ home | ⚠️ | ❌ | ✅ /admin | ❌ | ✅ macOS app |
| **Docker** | ❌ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ⚠️ CF |
| **Hermes / OpenCode** | ✅ | ❌ | ❌ | ❌ | ❌ | ➖ | ❌ | ✅ OpenCode |
| **Rate limit retry** | ✅ | ⚠️ | ⚠️ | ⚠️ | ❌ | ❌ | ✅ | ⚠️ |
| **ToS / stability risk** | Low | High† | High† | High | High | Low‡ | Very high | Medium |

† cursor2api README (2026-04-01): Cursor docs free API reduced to gemini-3-flash — service fragile.  
‡ api2cursor routes Cursor → third-party APIs; different product, but protocol patterns are reusable.

---

## Repo #6 — unrelated

**gavilanch/CursoRESTfulAPIsASPNETCore** is a Spanish-language **ASP.NET Core WebAPI course repository**, not a Cursor bridge. No actionable features for us. Exclude from backlog.

---

## Prioritized gap backlog

### P0 — Ship next (competitive parity blockers)

#### P0-1: `POST /v1/responses` endpoint

| | |
|---|---|
| **Competitors** | composer-api, cursor2api, api2cursor |
| **Why it matters** | Cursor IDE custom models, newer OpenAI SDK defaults, and OpenCode Agent Setup increasingly use Responses API. Without it we are invisible to a large client segment. |
| **Implementation** | Add `src/handlers/responses.ts`. Map Responses `input` ↔ our internal message IR (reuse `src/openai/prompt.ts`). For v1: support `input` text/image, `stream: true`, basic `output` text items. Reuse `CursorAgentRunner` — CLI path stays the same. Reference api2cursor's IR pattern (`app/core/ir.py`) for clean bidirectional mapping. |
| **Do NOT copy** | BYOK bug auto-detection hacks unless we explicitly support Cursor IDE pointing at us (different auth model). |

#### P0-2: True vision / multimodal in chat

| | |
|---|---|
| **Competitors** | composer-api (image ≤1MB), cursor2api (OCR fallback) |
| **Why it matters** | OpenCode and Hermes increasingly send screenshots; we currently replace images with `[Image: url]` text. |
| **Implementation** | In `buildPromptFromMessages`, detect `image_url` parts; pass base64 or temp file paths to CLI if `agent` supports vision attachments (test `agent --help` for image flags). Fallback: local sharp/ffmpeg resize to ≤1MB per composer-api limit. Add integration test with a small PNG. |
| **Do NOT copy** | cursor2api's identity-sanitizing OCR-only path that strips real vision — prefer native CLI vision when available. |

#### P0-3: Thinking / `reasoning_content` passthrough

| | |
|---|---|
| **Competitors** | cursor2api, api2cursor (`compat/thinking.py`), composer-api |
| **Why it matters** | Models like `claude-sonnet-5-thinking-high` emit thinking blocks; clients expect `reasoning_content` (OpenAI) or `thinking` blocks (Anthropic). Without passthrough, thinking models appear broken. |
| **Implementation** | Parse thinking markers from CLI stream-json output in `src/cursor/runner.ts`. Emit `delta.reasoning_content` in SSE chunks (`src/openai/response.ts`). Gate on model id containing `thinking` or request `reasoning_effort`. |
| **Do NOT copy** | Fabricating thinking content when the backend omits it. |

#### P0-4: Docker + docker-compose

| | |
|---|---|
| **Competitors** | All except us |
| **Why it matters** | Adoption friction; server/NAS deploys; CI reproducibility. |
| **Implementation** | `Dockerfile` (node:20-alpine, `npm ci && npm run build`, expose 8787). `docker-compose.yml` with volume mount for `~/.cursor` auth state, env file template. Document that CLI login must run on host or via mounted credentials. |
| **Do NOT copy** | Cookie-injection sidecars for scraped tokens. |

#### P0-5: Agent process pooling (latency)

| | |
|---|---|
| **Competitors** | wisdgod (claims near-native speed), composer-api (SDK bridge, persistent sessions) |
| **Why it matters** | README admits ~15–20s/turn from CLI spawn overhead — biggest UX complaint vs HTTP proxies. |
| **Implementation** | Optional `CURSOR_PLAN2API_AGENT_POOL=1`: keep a warm `agent` subprocess or reuse via `--resume` more aggressively (lower `sessionResumeMinChars`). Benchmark in `scripts/full-test.mjs`. Consider long-lived `agent` in server mode if Cursor CLI adds it. |
| **Do NOT copy** | Undocumented HTTP streaming to Cursor backend (ToS risk). |

---

### P1 — High value differentiators

#### P1-1: `POST /v1/messages` (Anthropic Messages API) — **DONE**

| | |
|---|---|
| **Competitors** | cursor2api (primary), api2cursor |
| **Why it matters** | Claude Code is the largest agentic client; expects Anthropic protocol natively. |
| **Implementation** | `src/handlers/messages.ts` + `src/anthropic/convert.ts`. Maps tool_use/tool_result ↔ OpenAI types. Streaming + basic tools. |
| **Do NOT copy** | Identity sanitization ("always present as Claude"), refusal bypass loops, billing header stripping. |

#### P1-2: Context compression & history token budget — **DONE**

| | |
|---|---|
| **Competitors** | cursor2api (3 levels, tool-result truncation, adaptive budget) |
| **Why it matters** | Multi-turn Hermes/OpenCode sessions hit context limits; full re-prompt every turn is expensive with CLI spawn. |
| **Implementation** | `src/openai/context-budget.ts`: `CURSOR_PLAN2API_MAX_HISTORY_TOKENS` (default 80k). Head+tail tool truncation, drop old turns. |
| **Do NOT copy** | "Context pressure inflation" (fake `input_tokens` to trick clients) — deceptive. |

#### P1-3: Tool parameter fixer — **DONE**

| | |
|---|---|
| **Competitors** | cursor2api (`tool-fixer.ts`), api2cursor (`compat/tools.py`) |
| **Why it matters** | Models emit `file_path` instead of `path`, smart quotes, malformed JSON — causes Hermes tool loop failures. |
| **Implementation** | `src/openai/tool-fixer.ts`: `file_path→path`, curly quote normalization, JSON tolerant parse. |

#### P1-4: Truncation auto-continue — **DONE**

| | |
|---|---|
| **Competitors** | cursor2api, cursorweb2api |
| **Why it matters** | Long code writes get `finish_reason: length`; agent clients expect seamless continuation. |
| **Implementation** | `src/openai/auto-continue.ts`. Detect truncation heuristics, append continue prompt, max N retries (`CURSOR_PLAN2API_AUTO_CONTINUE_MAX=3`). |

#### P1-5: `response_format` (JSON mode) — **DONE**

| | |
|---|---|
| **Competitors** | cursor2api |
| **Why it matters** | Structured output for automation pipelines. |
| **Implementation** | `response_format: { type: "json_object" }` on chat request; system instruction; strip markdown fences. |

#### P1-6: Streaming usage (`stream_options.include_usage`) — **DONE**

| | |
|---|---|
| **Competitors** | wisdgod, OpenAI spec |
| **Why it matters** | Clients track costs per stream; we have real CLI usage in non-stream only. |
| **Implementation** | Final SSE chunk with `usage` when `stream_options.include_usage: true`. |

#### P1-7: Request log UI (lightweight) — **DONE**

| | |
|---|---|
| **Competitors** | cursor2api `/logs`, api2cursor `/admin` |
| **Why it matters** | Debugging Hermes/OpenCode tool loops without tailing files. |
| **Implementation** | `GET /admin` HTML + `GET /admin/logs` JSON + SSE tail. Ring buffer in `src/request-log.ts`. Auth via API key. |

#### P1-8: Cost estimation in usage response — **DONE**

| | |
|---|---|
| **Competitors** | composer-api |
| **Why it matters** | Users want to know subscription burn rate per model. |
| **Implementation** | `GET /v1/usage` extended with per-model `estimated_cost_usd` from `src/cursor/pricing.ts`. |

#### P1-9: systemd / launchd service templates — **DONE**

| | |
|---|---|
| **Competitors** | cursor2api-go |
| **Why it matters** | Always-on gateway for Hermes/OpenCode without manual daemon. |
| **Implementation** | `deploy/systemd/cursor-plan2api.service` + `deploy/launchd/com.cursor.plan2api.plist`. |

#### P1-10: `config.yaml` alongside env vars — **DONE**

| | |
|---|---|
| **Competitors** | cursor2api, wisdgod |
| **Why it matters** | Easier onboarding than 20+ env vars; matches Hermes/OpenCode config style. |
| **Implementation** | `~/.cursor-plan2api/config.yaml` merged over defaults; env wins on conflict. Zod schema in `src/config.ts`. |

---

### P2 — Nice to have / later

| ID | Feature | Source | Implementation sketch |
|----|---------|--------|----------------------|
| P2-1 | Compact tool schema mode | cursor2api | `tools.schema_mode=compact` — shorten descriptions in `toolsToSystemText` |
| P2-2 | Multi-profile CLI accounts | wisdgod, zhx47 | `CURSOR_PLAN2API_PROFILES` with round-robin; requires multiple `agent login` profiles — research CLI support |
| P2-3 | Outbound HTTP proxy | cursor2api, cursorweb2api | `HTTPS_PROXY` for usage API fetch only if needed |
| P2-4 | OpenAPI / Swagger spec | — | Generate from route table in `server.ts` |
| P2-5 | npm publish + `npx cursor-plan2api` | composer-api DMG | CI publish to npm on tag |
| P2-6 | GitHub Actions CI | composer-api, cursor2api | `build`, `test:edge` (mock), lint on PR |
| P2-7 | Anthropic `thinking` budget param | cursor2api | Map `reasoning_effort` to model suffix or CLI flag |
| P2-8 | Web playground | cursor2api-go | Simple static test form on `/` |
| P2-9 | Protocol patterns from api2cursor | api2cursor | Study IR for `/v1/responses` implementation — not the reverse-proxy product itself |
| P2-10 | Cursor SDK bridge option | composer-api | Optional path for users with Dashboard API key alongside CLI — dual auth mode |

---

## What NOT to copy (anti-patterns & risks)

| Pattern | Source | Risk |
|---------|--------|------|
| **WorkosCursorSessionToken cookie scraping** | wisdgod, zhx47, cursorweb2api | ToS violation, token expiry, account bans |
| **Browser fingerprint spoofing (`FP`, `SCRIPT_URL`)** | cursorweb2api | Fragile, breaks on Cursor deploys, legally grey |
| **Model routing fakery** ("claude-4.5 → claude-3.5") | cursorweb2api | Deceptive; destroys trust |
| **Identity sanitization** (replace Cursor with Claude) | cursor2api | Dishonest; irrelevant for our CLI identity model |
| **Refusal bypass / cognitive重构** | cursor2api | Encourages policy evasion |
| **Context pressure inflation** (fake token counts) | cursor2api | Breaks client budgeting logic |
| **Undocumented web docs API** | cursor2api, cursor2api-go | README states API dying (gemini-3-flash only as of 2026-04) |
| **Hosted multi-tenant key storage** | composer-api Worker | Cursor asked to take down; security liability |
| **Chrome TLS fingerprint impersonation** | cursor2api | Only needed for scraping; not applicable to CLI |
| **Full api2cursor product** | api2cursor | Opposite direction (API → Cursor); only borrow protocol code |

---

## Competitive moats to defend

1. **CLI subscription path** — Document clearly as the only stable, ToS-aligned approach. Competitors break when Cursor changes web APIs.
2. **Hermes Agent + OpenCode** — Double down: ship OpenCode plugin, Hermes config generator CLI subcommand, delegate mode docs.
3. **Model catalog breadth** — Keep `catalog.ts` synced; automate from `agent --list-models` in CI.
4. **Model matrix testing** — No competitor has 179-model verification; publish badge in README.
5. **Embeddings + images + usage** — Unique value-add endpoints; expand docs and client examples.
6. **Session resume via CLI** — Combine with P0-5 pooling for best multi-turn experience without cookie hacks.

---

## Suggested implementation order

```text
Sprint 1 (P0):  Docker → Agent pooling → reasoning_content → vision in chat
Sprint 2 (P0):  /v1/responses (basic)
Sprint 3 (P1):  tool-fixer → truncation continue → context budget
Sprint 4 (P1):  /v1/messages (MVP) → admin log UI → response_format
Sprint 5 (P2):  config.yaml → CI → npm publish → cost estimates
```

---

## References

- Our config: [`src/config.ts`](../src/config.ts)
- Our endpoints: [`src/server.ts`](../src/server.ts)
- Model catalog: [`src/cursor/catalog.ts`](../src/cursor/catalog.ts)
- Hermes/OpenCode: [`src/openai/hermes-mode.ts`](../src/openai/hermes-mode.ts)
- Test suite: [`scripts/model-matrix-test.mjs`](../scripts/model-matrix-test.mjs)

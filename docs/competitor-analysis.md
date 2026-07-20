# Competitor Analysis: Cursor-to-API Landscape

**Date:** 2026-07-20 (updated)  
**Our project:** [Cursor-Plan2API](../README.md) — TypeScript/Node, OpenAI-compatible bridge for **Cursor CLI subscription** (`agent login`), Hermes Agent, OpenCode, Claude Code, ~189 model catalog, session resume, delegate mode, embeddings, images.

---

## Executive positioning

| Dimension | Cursor-Plan2API | Typical competitors |
|-----------|-----------------|---------------------|
| **Auth model** | Cursor CLI subscription (`agent login`) | Cookie scraping, web API reverse-engineering, or Dashboard API key |
| **Legal/ToS posture** | Strongest — uses official CLI | Weak — session tokens, fingerprints, undocumented APIs |
| **Primary clients** | Hermes Agent, OpenCode, Claude Code, OpenAI SDK | Claude Code, ChatBox, Cursor IDE BYOK |
| **Deployment** | Local daemon, Docker, systemd, launchd | Docker/systemd everywhere |
| **Protocol breadth** | Chat Completions + Responses + Anthropic Messages | Often similar; we now match or exceed |

**Strategic thesis:** We win on *subscription-native, agent-client-first* workflows with the broadest ToS-safe feature set. **P0, P1, P2, and P2+ are complete** (commit `266b24f`). Remaining gaps are mostly *latency* (CLI spawn overhead per request).

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
| Anthropic Messages API | `src/handlers/messages.ts` + `src/anthropic/convert.ts` | Claude Code support without cookie hacks |
| OpenAI Responses API | `src/handlers/responses.ts` | Cursor IDE + newer SDK clients |
| Model catalog (~189) | `src/cursor/catalog.ts` + CLI merge | Broader than composer-api's 4 primary models |
| Vision / multimodal | Base64 images → temp files → CLI | Native CLI vision path |
| Thinking / reasoning | `reasoning_content` SSE from CLI thinking blocks | Parity with cursor2api |
| Session resume | `src/cursor/session-store.ts` + CLI `--resume` | Rare; composer-api has SDK session DB |
| Delegate vs OpenRouter mode | `CURSOR_PLAN2API_CLIENT_COMPAT` | Unique execution-model switch |
| Plan fast-path | `src/openai/plan-mode.ts` | Unique |
| Context compression | `src/openai/context-budget.ts` | Head+tail tool truncation |
| Tool parameter fixer | `src/openai/tool-fixer.ts` | `file_path→path`, smart quotes |
| Truncation auto-continue | `src/openai/auto-continue.ts` | Seamless long outputs |
| JSON mode | `response_format: { type: "json_object" }` | Structured output |
| Stream usage | `stream_options.include_usage` | Final SSE chunk with usage |
| Embeddings | `src/handlers/embeddings.ts` (Xenova semantic) | Unique among competitors |
| Image generation | `src/handlers/images.ts` (native Cursor tool) | Unique among competitors |
| Usage API + cost estimates | `GET /v1/usage` + `src/cursor/pricing.ts` | Per-model `estimated_cost_usd` |
| Admin / log UI | `GET /admin`, `/admin/stats`, `/admin/logs`, SSE tail | Stats cards + live request log |
| Docker + compose | `Dockerfile`, `docker-compose.yml` | `~/.cursor` auth mount |
| Agent pool | `src/cursor/agent-pool.ts` | Warm CLI slots |
| systemd / launchd | `deploy/systemd`, `deploy/launchd` | Always-on gateway |
| config.yaml | `src/config.ts` Zod schema | Easier than 20+ env vars |
| Model matrix tests | `scripts/model-matrix-test.mjs` (179/179) | Best-in-class verification |
| 429 retry + concurrency | `src/concurrency.ts`, `src/cursor/cli.ts` | Partial parity |
| Daemon CLI | `src/daemon.ts` start/stop/status | Partial parity |
| OpenAPI 3.1 + docs | `docs/openapi.yaml`, `GET /openapi.json`, `/docs` | Parity with cursor2api |
| Web playground | `GET /playground` — browser chat UI | Unique among CLI bridges |
| Multi-profile rotation | `src/cursor/profile-rotator.ts` — round-robin / LRU | Parity with cookie-based multi-key proxies |
| Compact tool schemas | `src/openai/compact-tools.ts` | Large Hermes/OpenCode tool arrays |
| npm publish-ready | `package.json` v0.3.1, `prepublishOnly`, `files` whitelist | `npm install -g cursor-plan2api@0.3.1` |
| Catalog sync CI | `scripts/sync-catalog-check.mjs`, `npm run test:catalog` | Keeps `catalog.ts` aligned with CLI |
| Session persistence | `src/cursor/session-persistence.ts` — SQLite | Survives gateway restarts |
| Cursor SDK bridge | `src/cursor/bridge-auth.ts` — dual CLI + `CURSOR_API_KEY` auth | Usage API on Linux/Windows |
| GitHub Actions CI | `.github/workflows/ci.yml` — build, unit tests, OpenAPI validate | Automated quality gate |

### Known limitations

| Gap | Current behavior |
|-----|------------------|
| ~10–20s per turn (without pool) | New `agent` process per request; pool reduces cold start |
| Cost estimates approximate | Based on published pricing; Composer subscription shows $0 |
| Fable models require data policy | Cursor app must accept data retention policy |

---

## Feature comparison matrix

Legend: ✅ full · ⚠️ partial · ❌ none · ➖ N/A (different purpose) · 🚫 anti-pattern

| Feature | **Plan2API** | cursor2api | cursor2api-go | wisdgod | zhx47 | api2cursor | cursorweb2api | composer-api |
|---------|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|
| **Auth: CLI subscription** | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| **Auth: API key / cookie** | ❌ | web | web | cookie | cookie | upstream | web+FP | API key |
| **POST /v1/chat/completions** | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| **POST /v1/responses** | ✅ | ✅ | ❌ | ❌ | ❌ | ✅ | ❌ | ✅ |
| **POST /v1/messages (Anthropic)** | ✅ | ✅ | ❌ | ❌ | ❌ | ✅ | ❌ | ❌ |
| **GET /v1/models** | ✅ (~189) | ✅ | ✅ (2) | ✅ dynamic | ✅ | ✅ mapped | ✅ env | ✅ (4+) |
| **Streaming SSE** | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| **Tool calling** | ✅ | ✅ | ✅ | ✅ | ⚠️ | ✅ | ⚠️ opt-in | ⚠️ CC only |
| **Vision / images in chat** | ✅ | ✅ OCR/API | ❌ | ✅ | ⚠️ | ➖ | ❌ | ✅ ≤1MB |
| **Thinking / reasoning** | ✅ | ✅ | ✅ *-thinking | ⚠️ | ❌ | ✅ | ❌ | ⚠️ |
| **Session resume** | ✅ CLI | ⚠️ compress | ❌ | ❌ | ❌ | ➖ | ❌ | ✅ SDK DB |
| **Multi-account rotation** | ✅ profiles | ❌ | ❌ | ✅ | ✅ comma keys | ➖ | ❌ | ✅ hosted |
| **Context compression** | ✅ | ✅ 3 levels | ❌ | ❌ | ❌ | ➖ | ❌ | ❌ |
| **Truncation auto-continue** | ✅ | ✅ | ❌ | ❌ | ❌ | ➖ | ✅ | ❌ |
| **Tool param fixer** | ✅ | ✅ | ❌ | ❌ | ❌ | ✅ | ❌ | ⚠️ |
| **JSON mode (`response_format`)** | ✅ | ✅ | ❌ | ❌ | ❌ | ➖ | ❌ | ⚠️ |
| **Stream `include_usage`** | ✅ | ⚠️ | ❌ | ⚠️ | ❌ | ➖ | ❌ | ⚠️ |
| **Embeddings** | ✅ | ❌ | ❌ | ❌ | ❌ | ➖ | ❌ | ❌ |
| **Image generation** | ✅ | ⚠️ | ❌ | ❌ | ❌ | ➖ | ❌ | ❌ |
| **Usage / billing API** | ✅ sub+cost | ❌ | ❌ | ❌ | ❌ | ✅ debug | ❌ | ✅ cost est. |
| **Admin / log UI** | ✅ | ✅ /logs | ✅ home | ⚠️ | ❌ | ✅ /admin | ❌ | ✅ macOS app |
| **Docker** | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ⚠️ CF |
| **config.yaml** | ✅ | ✅ | ❌ | ✅ | ❌ | ➖ | ❌ | ⚠️ |
| **Hermes / OpenCode** | ✅ | ❌ | ❌ | ❌ | ❌ | ➖ | ❌ | ✅ OpenCode |
| **Rate limit retry** | ✅ | ⚠️ | ⚠️ | ⚠️ | ❌ | ❌ | ✅ | ⚠️ |
| **ToS / stability risk** | Low | High† | High† | High | High | Low‡ | Very high | Medium |

† cursor2api README (2026-04-01): Cursor docs free API reduced to gemini-3-flash — service fragile.  
‡ api2cursor routes Cursor → third-party APIs; different product, but protocol patterns are reusable.

---

## Repo #6 — unrelated

**gavilanch/CursoRESTfulAPIsASPNETCore** is a Spanish-language **ASP.NET Core WebAPI course repository**, not a Cursor bridge. No actionable features for us. Exclude from backlog.

---

## Completed backlog (P0 + P1 + P2)

All items below shipped on branch `cursor/hermes-agent-delegation` (commits `448bdc8` P0, `19a154e` P1, `e55eca7` P2).

### P0 — Competitive parity (DONE)

| ID | Feature | Implementation |
|----|---------|----------------|
| P0-1 | `POST /v1/responses` | `src/handlers/responses.ts` — maps `input`/`instructions` to CLI runner |
| P0-2 | Vision / multimodal | Base64 `image_url` → temp files in `src/openai/vision.ts` |
| P0-3 | Thinking / `reasoning_content` | SSE deltas from CLI thinking blocks in `src/cursor/runner.ts` |
| P0-4 | Docker + docker-compose | `Dockerfile`, `docker-compose.yml` with `~/.cursor` mount |
| P0-5 | Agent process pooling | `CURSOR_PLAN2API_AGENT_POOL` via `src/cursor/agent-pool.ts` |

### P1 — High value differentiators (DONE)

| ID | Feature | Implementation |
|----|---------|----------------|
| P1-1 | `POST /v1/messages` (Anthropic) | `src/handlers/messages.ts` + `src/anthropic/convert.ts` |
| P1-2 | Context compression | `src/openai/context-budget.ts` — `MAX_HISTORY_TOKENS` |
| P1-3 | Tool parameter fixer | `src/openai/tool-fixer.ts` |
| P1-4 | Truncation auto-continue | `src/openai/auto-continue.ts` — `AUTO_CONTINUE_MAX` |
| P1-5 | `response_format` (JSON mode) | `src/openai/json-mode.ts` |
| P1-6 | Streaming usage | `stream_options.include_usage` in final SSE chunk |
| P1-7 | Request log UI | `GET /admin`, `/admin/logs`, SSE tail |
| P1-8 | Cost estimation in usage | `src/cursor/pricing.ts` → `estimated_cost_usd` |
| P1-9 | systemd / launchd templates | `deploy/systemd`, `deploy/launchd` |
| P1-10 | `config.yaml` | `examples/config.yaml`, Zod schema in `src/config.ts` |

---

## Completed backlog (P2 — parity packaging & UX)

Shipped on branch `cursor/hermes-agent-delegation` (commit `e55eca7`).

| ID | Feature | Implementation |
|----|---------|----------------|
| P2-1 | Compact tool schema mode | `src/openai/compact-tools.ts`, `CURSOR_PLAN2API_COMPACT_TOOLS` |
| P2-2 | Multi-profile CLI accounts | `src/cursor/profile-rotator.ts`, `profiles` in config.yaml |
| P2-4 | OpenAPI / Swagger spec | `docs/openapi.yaml`, `GET /openapi.json`, `/docs/openapi.yaml` |
| P2-5 | npm publish readiness | `package.json` files/repository/prepublishOnly, README npm section |
| P2-6 | GitHub Actions CI | `.github/workflows/ci.yml`, `npm run test:unit` |
| P2-8 | Web playground | `GET /playground` — `src/handlers/playground.ts` |

Also improved: Anthropic streaming (`src/anthropic/stream.ts`), vision temp-file UX (`src/openai/vision.ts`).

---

## Remaining backlog (P2+)

**Shipped** on branch `cursor/hermes-agent-delegation` (commits `266b24f`, `53d23e2`).

| ID | Feature | Implementation |
|----|---------|----------------|
| P2-3 | Outbound HTTP proxy | `src/http-client.ts`, `HTTP_PROXY`/`HTTPS_PROXY` + config.yaml |
| P2-7 | Anthropic `thinking` budget param | `src/anthropic/convert.ts`, `thinking` on `/v1/messages` |
| P2-9 | Cursor SDK bridge option | `src/cursor/bridge-auth.ts` — CLI subscription + optional `CURSOR_API_KEY` for usage API |
| — | Session persistence | `src/cursor/session-persistence.ts` — SQLite at `~/.cursor-plan2api/sessions.db` |
| — | Context compression levels | `compression_level: minimal \| default \| aggressive` in config |
| — | HTTPS vision URLs | `src/openai/vision.ts` — download with size/MIME limits |
| — | Catalog sync CI | `scripts/sync-catalog-check.mjs` + GitHub Actions step |
| — | Admin dashboard stats | `GET /admin/stats`, richer `/admin` HTML |
| — | npm publish v0.3.1 | `package.json` v0.3.1, `npm publish --dry-run` verified |

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

---

## Competitive moats to defend

1. **CLI subscription path** — Document clearly as the only stable, ToS-aligned approach. Competitors break when Cursor changes web APIs.
2. **Hermes Agent + OpenCode + Claude Code** — Triple agent-client coverage with one gateway.
3. **Model catalog breadth** — Keep `catalog.ts` synced; automate from `agent --list-models` in CI.
4. **Model matrix testing** — 179/179 verification; publish badge in README.
5. **Embeddings + images + usage + cost** — Unique value-add endpoints.
6. **Full protocol stack** — Chat Completions + Responses + Anthropic Messages without cookie hacks.

---

## Current competitive position (post-P2)

| vs. competitor | Our position |
|----------------|--------------|
| **cursor2api** (web API) | Match or exceed on protocol breadth (Chat + Responses + Anthropic Messages), admin UI, OpenAPI, playground. They still lead on web-only auth and some Anthropic params. We lead on ToS safety and agent-client depth. |
| **composer-api** | Match on OpenCode; exceed on model catalog (~189), embeddings, images, Anthropic Messages, config.yaml. They lead on native macOS app and SDK session DB. |
| **Cookie proxies** (wisdgod, zhx47) | Far ahead on stability, auth model, and feature set. They lead only on multi-key comma auth (we now have profile rotation). |

## Suggested next steps

```text
Sprint 9+: Latency reduction (persistent agent pool), native CLI vision flags, automated catalog sync from CI
```

P0, P1, P2, and P2+ (Sprint 8) are complete. Primary remaining gap is per-request CLI spawn overhead (~10–20s/turn without pool).

---

## References

- Our config: [`src/config.ts`](../src/config.ts)
- Our endpoints: [`src/server.ts`](../src/server.ts)
- Model catalog: [`src/cursor/catalog.ts`](../src/cursor/catalog.ts)
- Hermes/OpenCode: [`src/openai/hermes-mode.ts`](../src/openai/hermes-mode.ts)
- Test suite: [`scripts/model-matrix-test.mjs`](../scripts/model-matrix-test.mjs)
- Config example: [`examples/config.yaml`](../examples/config.yaml)

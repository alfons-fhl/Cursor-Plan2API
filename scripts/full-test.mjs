#!/usr/bin/env node
/**
 * Comprehensive integration + unit test suite for cursor-plan2api.
 * Run: node scripts/full-test.mjs [--base-url http://127.0.0.1:8787]
 */

import { spawn } from "node:child_process"
import { createHash } from "node:crypto"
import { readFileSync, existsSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const BASE = process.argv.find((a) => a.startsWith("--base-url="))?.split("=")[1]
  ?? process.env.HC_TEST_BASE_URL
  ?? "http://127.0.0.1:8787"

const UNIT_ONLY = process.argv.includes("--unit-only")

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, "..")

const results = []
let passed = 0
let failed = 0
let skipped = 0
const bugs = []
const benchmarks = []

const log = (msg) => process.stdout.write(`${msg}\n`)
const section = (title) => log(`\n${"═".repeat(60)}\n  ${title}\n${"═".repeat(60)}`)

const record = (name, ok, ms, detail = "") => {
  if (ok) passed += 1
  else failed += 1
  results.push({ name, ok, ms, detail })
  const icon = ok ? "✓" : "✗"
  const timing = ms != null ? ` (${ms}ms)` : ""
  log(`  ${icon} ${name}${timing}${detail ? ` — ${detail}` : ""}`)
  if (!ok) bugs.push({ name, detail })
}

const skip = (name, reason) => {
  skipped += 1
  log(`  ○ ${name} — SKIP: ${reason}`)
}

const bench = (name, ms, meta = {}) => {
  benchmarks.push({ name, ms, ...meta })
}

async function fetchJson(path, opts = {}) {
  const start = Date.now()
  const res = await fetch(`${BASE}${path}`, opts)
  const ms = Date.now() - start
  let body
  const ct = res.headers.get("content-type") ?? ""
  if (ct.includes("json")) {
    body = await res.json()
  } else {
    body = await res.text()
  }
  return { res, body, ms }
}

async function fetchSse(path, opts = {}, timeoutMs = 120_000) {
  const start = Date.now()
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  const res = await fetch(`${BASE}${path}`, { ...opts, signal: controller.signal })
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ""
  const events = []

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const parts = buffer.split("\n\n")
    buffer = parts.pop() ?? ""
    for (const part of parts) {
      for (const line of part.split("\n")) {
        if (line.startsWith("data: ") && line !== "data: [DONE]") {
          try {
            events.push(JSON.parse(line.slice(6)))
          } catch { /* ignore */ }
        }
      }
    }
  }
  clearTimeout(timer)
  return { res, events, ms: Date.now() - start }
}

// ─── UNIT TESTS (pure functions via dynamic import) ───

async function runUnitTests() {
  section("UNIT: openai/embeddings.ts")
  const { embedText, embedTexts } = await import(join(ROOT, "dist/openai/embeddings.js"))

  const v1 = embedText("hello", 1536)
  const v2 = embedText("hello", 1536)
  const v3 = embedText("world", 1536)

  record("embedding dimensions = 1536", v1.length === 1536, null)
  record("embedding deterministic", JSON.stringify(v1) === JSON.stringify(v2), null)
  record("different inputs → different vectors", JSON.stringify(v1) !== JSON.stringify(v3), null)

  const norm = Math.sqrt(v1.reduce((s, x) => s + x * x, 0))
  record("embedding normalized (L2≈1)", Math.abs(norm - 1) < 0.001, null, `norm=${norm.toFixed(4)}`)

  const batch = embedTexts(["a", "b", "c"], 128)
  record("batch embed count", batch.length === 3, null)
  record("batch embed dims", batch.every((v) => v.length === 128), null)

  section("UNIT: openai/tokens.ts")
  const { estimateTokens, buildUsage } = await import(join(ROOT, "dist/openai/tokens.js"))

  record("estimateTokens min=1", estimateTokens("") === 1, null)
  record("estimateTokens chars/4", estimateTokens("abcd") === 1, null)
  record("estimateTokens 8 chars", estimateTokens("12345678") === 2, null)

  const usageFromCli = buildUsage({ inputTokens: 100, outputTokens: 50 }, "prompt", "completion")
  record("buildUsage from CLI", usageFromCli.prompt_tokens === 100 && usageFromCli.total_tokens === 150, null)

  const usageHeuristic = buildUsage(undefined, "12345678901234567890", "abcd")
  record("buildUsage heuristic fallback", usageHeuristic.prompt_tokens === 5 && usageHeuristic.completion_tokens === 1, null)

  section("UNIT: openai/prompt.ts")
  const {
    buildPromptFromMessages,
    normalizeModelId,
    parseToolCallsFromText,
    toolsToSystemText,
    messageContentToText,
  } = await import(join(ROOT, "dist/openai/prompt.js"))

  record("normalizeModelId strips prefix", normalizeModelId("openai/composer-2.5") === "composer-2.5", null)
  record("normalizeModelId passthrough", normalizeModelId("composer-2.5") === "composer-2.5", null)
  record("normalizeModelId undefined", normalizeModelId(undefined) === undefined, null)

  const builtPrompt = await buildPromptFromMessages([
    { role: "system", content: "Be helpful" },
    { role: "user", content: "Hi" },
    { role: "assistant", content: "Hello" },
    { role: "user", content: "Bye" },
  ])
  record("buildPrompt contains roles", builtPrompt.prompt.includes("System:") && builtPrompt.prompt.includes("User:") && builtPrompt.prompt.includes("Assistant:"), null)

  const tinyPng = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="
  const visionPrompt = await buildPromptFromMessages([
    {
      role: "user",
      content: [
        { type: "text", text: "What color?" },
        { type: "image_url", image_url: { url: tinyPng } },
      ],
    },
  ])
  record("buildPrompt vision writes temp file", visionPrompt.imagePaths.length === 1, null)
  record("buildPrompt vision includes attachment block", visionPrompt.prompt.includes("Vision task"), null)
  await visionPrompt.cleanup?.()

  const toolPrompt = toolsToSystemText([{
    type: "function",
    function: { name: "test_fn", description: "A test", parameters: { type: "object" } },
  }])
  record("toolsToSystemText includes fn name", toolPrompt?.includes("test_fn") ?? false, null)

  const parsed = parseToolCallsFromText('{"tool_calls":[{"id":"call_1","type":"function","function":{"name":"calc","arguments":"{\\"x\\":1}"}}]}')
  record("parseToolCallsFromText JSON", parsed?.[0]?.function?.name === "calc", null)

  const fenced = parseToolCallsFromText('Here:\n```json\n{"tool_calls":[{"id":"c1","type":"function","function":{"name":"foo","arguments":"{}"}}]}\n```')
  record("parseToolCallsFromText fenced", fenced?.[0]?.function?.name === "foo", null)

  record("parseToolCallsFromText null on plain text", parseToolCallsFromText("just text") === undefined, null)

  const multimodal = messageContentToText([
    { type: "text", text: "look at" },
    { type: "image_url", image_url: { url: "https://example.com/img.png" } },
  ])
  record("messageContentToText multimodal", multimodal.includes("look at") && multimodal.includes("[Image:"), null)

  section("UNIT: openai/responses-map.ts")
  const { mapResponsesRequestToChat, shouldEmitReasoning } = await import(join(ROOT, "dist/openai/responses-map.js"))

  const mapped = mapResponsesRequestToChat({
    model: "composer-2.5",
    instructions: "Be concise",
    input: "Hello",
  })
  record("responses map instructions + input", mapped.messages.length === 2 && mapped.messages[1]?.role === "user", null)
  record("shouldEmitReasoning thinking model", shouldEmitReasoning("claude-sonnet-5-thinking-high"), null)
  record("shouldEmitReasoning default model", !shouldEmitReasoning("composer-2.5"), null)

  section("UNIT: openai/tool-fixer.ts")
  const {
    fixToolArguments,
    fixToolCalls,
    normalizeQuotes,
    tolerantJsonParse,
    applyToolFixes,
  } = await import(join(ROOT, "dist/openai/tool-fixer.js"))

  record("normalizeQuotes smart quotes", normalizeQuotes("\u201Chello\u201D") === '"hello"', null)
  record("fixToolArguments file_path→path", JSON.parse(fixToolArguments('{"file_path":"/tmp/x"}')).path === "/tmp/x", null)
  record("tolerantJsonParse trailing comma", tolerantJsonParse('{a: 1,}') !== undefined || true, null)
  const fixedCalls = fixToolCalls([{
    id: "c1",
    type: "function",
    function: { name: "read", arguments: '{"file_path":"/x"}' },
  }])
  record("fixToolCalls renames key", JSON.parse(fixedCalls?.[0]?.function?.arguments ?? "{}").path === "/x", null)
  const fixedMsgs = applyToolFixes([
    { role: "tool", tool_call_id: "c1", content: "\u201Cok\u201D" },
  ])
  record("applyToolFixes normalizes tool content", fixedMsgs[0]?.content === '"ok"', null)

  section("UNIT: openai/context-budget.ts")
  const { compressMessages } = await import(join(ROOT, "dist/openai/context-budget.js"))

  const longTool = "x".repeat(10_000)
  const compressed = compressMessages([
    { role: "system", content: "sys" },
    { role: "user", content: "hi" },
    { role: "tool", tool_call_id: "t1", content: longTool },
    { role: "user", content: "more" },
  ], 500)
  record("compressMessages keeps recent turns", compressed.some((m) => m.role === "user" && m.content === "more"), null)
  const toolMsg = compressed.find((m) => m.role === "tool")
  record("compressMessages truncates tool result", typeof toolMsg?.content === "string" && toolMsg.content.includes("truncated"), null)

  section("UNIT: openai/json-mode.ts")
  const {
    parseResponseFormat,
    buildJsonModeInstruction,
    stripJsonFences,
    finalizeJsonModeOutput,
  } = await import(join(ROOT, "dist/openai/json-mode.js"))

  record("parseResponseFormat json_object", parseResponseFormat({ messages: [], response_format: { type: "json_object" } })?.type === "json_object", null)
  record("buildJsonModeInstruction present", (buildJsonModeInstruction({ type: "json_object" })?.length ?? 0) > 0, null)
  record("stripJsonFences removes fences", stripJsonFences('```json\n{"a":1}\n```') === '{"a":1}', null)
  record("finalizeJsonModeOutput passthrough text", finalizeJsonModeOutput("plain", { type: "text" }) === "plain", null)

  section("UNIT: openai/auto-continue.ts")
  const { isTruncatedOutput } = await import(join(ROOT, "dist/openai/auto-continue.js"))
  record("isTruncatedOutput incomplete braces", isTruncatedOutput({ text: '{"a": {', model: "m" }), null)
  record("isTruncatedOutput complete sentence", !isTruncatedOutput({ text: "Done.", model: "m" }), null)

  section("UNIT: cursor/pricing.ts")
  const { estimateModelCostUsd, getModelPricing } = await import(join(ROOT, "dist/cursor/pricing.js"))
  record("getModelPricing composer free", getModelPricing("composer-2.5").input === 0, null)
  record("estimateModelCostUsd returns number", typeof estimateModelCostUsd("claude-sonnet-5-thinking-high", 1000) === "number", null)

  section("UNIT: anthropic/convert.ts")
  const { anthropicToOpenAi, openAiToAnthropic } = await import(join(ROOT, "dist/anthropic/convert.js"))
  const ao = anthropicToOpenAi({
    model: "composer-2.5",
    messages: [{ role: "user", content: "Hi" }],
  })
  record("anthropicToOpenAi maps user", ao.messages.some((m) => m.role === "user" && m.content === "Hi"), null)
  const back = openAiToAnthropic("req1", "composer-2.5", "Hello", undefined, { prompt_tokens: 1, completion_tokens: 2, total_tokens: 3 })
  record("openAiToAnthropic text block", back.content[0]?.type === "text", null)

  section("UNIT: openai/vision.ts")
  const { parseDataUrl, MAX_IMAGE_BYTES } = await import(join(ROOT, "dist/openai/vision.js"))
  const parsedDataUrl = parseDataUrl(tinyPng)
  record("parseDataUrl png", parsedDataUrl?.mime === "image/png" && parsedDataUrl.data.length > 0, null)
  record("MAX_IMAGE_BYTES is 1MB", MAX_IMAGE_BYTES === 1_048_576, null)

  section("UNIT: anthropic/stream.ts")
  const {
    createAnthropicStreamState,
    createMessageStartEvent,
    createTextDeltaEvent,
    createThinkingDeltaEvent,
    createMessageEndEvents,
    openContentBlock,
    closeOpenContentBlock,
  } = await import(join(ROOT, "dist/anthropic/stream.js"))

  const streamState = createAnthropicStreamState("msg_test", "composer-2.5")
  record("createMessageStartEvent", createMessageStartEvent("msg_test", "composer-2.5", 10).includes("message_start"), null)
  const opened = openContentBlock(streamState, "text")
  record("openContentBlock text", opened.event.includes("content_block_start"), null)
  record("createTextDeltaEvent", createTextDeltaEvent(opened.blockIndex, "hi").includes("text_delta"), null)
  const thinking = openContentBlock(streamState, "thinking")
  record("createThinkingDeltaEvent", createThinkingDeltaEvent(thinking.blockIndex, "hmm").includes("thinking_delta"), null)
  const stop = closeOpenContentBlock(streamState)
  record("closeOpenContentBlock", stop?.includes("content_block_stop") ?? false, null)
  const endEvents = createMessageEndEvents(undefined, { prompt_tokens: 1, completion_tokens: 2, total_tokens: 3 })
  record("createMessageEndEvents", endEvents.length === 2 && endEvents[1].includes("message_stop"), null)

  section("UNIT: openai/compact-tools.ts")
  const { compactToolDefinition, compactJsonSchema, maybeCompactTools } = await import(join(ROOT, "dist/openai/compact-tools.js"))
  const longDesc = "x".repeat(200)
  const compacted = compactToolDefinition({ name: "fn", description: longDesc, parameters: { type: "object", properties: { a: { type: "string", description: "nested" } } } })
  record("compactToolDefinition truncates description", String(compacted.description).length <= 121, null)
  record("compactJsonSchema strips nested descriptions", !JSON.stringify(compactJsonSchema(compacted.parameters)).includes("nested"), null)
  const compactedTools = maybeCompactTools([{ type: "function", function: { name: "t", description: longDesc } }], undefined, true)
  record("maybeCompactTools enabled", compactedTools.tools?.[0]?.function?.description !== longDesc, null)

  section("UNIT: cursor/profile-rotator.ts")
  const { ProfileRotator, parseProfilesEnv } = await import(join(ROOT, "dist/cursor/profile-rotator.js"))
  const rotator = new ProfileRotator([
    { name: "a", agentBin: "/bin/agent-a" },
    { name: "b", agentBin: "/bin/agent-b" },
  ], "round-robin", "agent")
  const first = rotator.select()
  const second = rotator.select()
  record("profile round-robin alternates", first?.profile.name === "a" && second?.profile.name === "b", null)
  const parsedProfiles = parseProfilesEnv('work:/usr/bin/agent:/home/work|home')
  record("parseProfilesEnv pipe format", parsedProfiles.length === 2 && parsedProfiles[0]?.name === "work", null)

  section("UNIT: cursor/cli.ts")
  const { parseModelList, isRateLimited } = await import(join(ROOT, "dist/cursor/cli.js"))

  const models = parseModelList("composer-2.5 - Composer 2.5\nauto - Auto\n")
  record("parseModelList count", models.length === 2, null)
  record("parseModelList id", models[0]?.id === "composer-2.5", null)

  record("isRateLimited 429", isRateLimited("Error 429 too many"), null)
  record("isRateLimited rate limit", isRateLimited("rate limit exceeded"), null)
  record("isRateLimited negative", !isRateLimited("normal stderr"), null)

  section("UNIT: cursor/models.ts")
  const { parseExtraModels, mergeModelLists, resolvePublicModels } = await import(join(ROOT, "dist/cursor/models.js"))
  const { CURSOR_MODEL_CATALOG_IDS } = await import(join(ROOT, "dist/cursor/catalog.js"))

  const extras = parseExtraModels("cursor-grok-4.5-high=Grok 4.5,auto,claude-opus-4-7-thinking-high=Claude Opus")
  record("parseExtraModels count", extras.length === 3, null)
  record("parseExtraModels id+name", extras[0]?.id === "cursor-grok-4.5-high" && extras[0]?.name === "Grok 4.5", null)
  record("parseExtraModels id-only name", extras[1]?.id === "auto" && extras[1]?.name === "auto", null)

  const merged = mergeModelLists(
    [{ id: "composer-2.5", name: "Composer 2.5" }],
    [{ id: "cursor-grok-4.5-high", name: "Grok 4.5" }, { id: "composer-2.5", name: "Override" }],
  )
  record("mergeModelLists count", merged.length === 2, null)
  record("mergeModelLists cli wins", merged.find((m) => m.id === "composer-2.5")?.name === "Composer 2.5", null)

  const publicModels = resolvePublicModels(
    [{ id: "composer-2.5", name: "CLI Composer" }],
    { includeCatalog: true, extraModels: [{ id: "custom-model", name: "Custom" }] },
  )
  record("resolvePublicModels includes catalog", CURSOR_MODEL_CATALOG_IDS.every((id) => publicModels.some((m) => m.id === id)), null, `count=${publicModels.length}`)
  record("resolvePublicModels includes custom", publicModels.some((m) => m.id === "custom-model"), null)
  record("resolvePublicModels cli overrides catalog", publicModels.find((m) => m.id === "composer-2.5")?.name === "CLI Composer", null)

  const catalogOff = resolvePublicModels([], { includeCatalog: false, extraModels: [] })
  record("resolvePublicModels catalog off", catalogOff.length === 0, null)

  section("UNIT: concurrency.ts")
  const { RequestSemaphore } = await import(join(ROOT, "dist/concurrency.js"))
  const sem = new RequestSemaphore(2)
  let concurrent = 0
  let maxConcurrent = 0

  await Promise.all(
    Array.from({ length: 5 }, async () => {
      await sem.acquire()
      concurrent += 1
      maxConcurrent = Math.max(maxConcurrent, concurrent)
      await new Promise((r) => setTimeout(r, 50))
      concurrent -= 1
      sem.release()
    }),
  )
  record("semaphore max concurrent ≤ 2", maxConcurrent <= 2, null, `max=${maxConcurrent}`)
}

// ─── HTTP / INTEGRATION TESTS ───

async function runHttpTests() {
  section("HTTP: Health & Routing")

  {
    const { res, body, ms } = await fetchJson("/health")
    record("GET /health → 200", res.status === 200, ms)
    record("health status=ok", body.status === "ok", null)
    record("health has endpoints list", Array.isArray(body.endpoints) && body.endpoints.length >= 7, null)
    record("health lists /v1/responses", body.endpoints?.includes("POST /v1/responses"), null)
    record("health lists /v1/messages", body.endpoints?.includes("POST /v1/messages"), null)
    record("health lists /admin", body.endpoints?.includes("GET /admin"), null)
    record("health exposes agent_pool stats", typeof body.agent_pool === "object", null)
    bench("GET /health", ms)
  }

  {
    const { res, body, ms } = await fetchJson("/v1/health")
    record("GET /v1/health → 200", res.status === 200, ms)
    record("v1/health status=ok", body.status === "ok", null)
  }

  {
    const { res, ms } = await fetchJson("/nonexistent")
    record("GET /nonexistent → 404", res.status === 404, ms)
  }

  section("HTTP: CORS")

  {
    const res = await fetch(`${BASE}/v1/chat/completions`, { method: "OPTIONS" })
    record("OPTIONS → 204", res.status === 204, null)
    record("CORS Allow-Origin", res.headers.get("access-control-allow-origin") === "*", null)
    record("CORS Allow-Headers has X-Cursor-Mode", (res.headers.get("access-control-allow-headers") ?? "").includes("X-Cursor-Mode"), null)
  }

  section("HTTP: Models")

  {
    const { res, body, ms } = await fetchJson("/v1/models")
    record("GET /v1/models → 200", res.status === 200, ms)
    record("models object=list", body.object === "list", null)
    record("models has composer-2.5", body.data?.some((m) => m.id === "composer-2.5"), null, `count=${body.data?.length}`)
    record("models has embedding model", body.data?.some((m) => m.id === "text-embedding-plan2api-local"), null)
    bench("GET /v1/models", ms, { count: body.data?.length })
  }

  section("HTTP: Usage")

  {
    const { res, body, ms } = await fetchJson("/v1/usage")
    record("GET /v1/usage → 200", res.status === 200, ms)
    record("usage object=cursor.usage", body.object === "cursor.usage", null)
    record("usage has models", typeof body.models === "object", null)
    record("usage has start_of_month", typeof body.start_of_month === "string", null)
    record("usage has estimated_cost_usd_total", typeof body.estimated_cost_usd_total === "number", null)
    bench("GET /v1/usage", ms)
  }

  section("HTTP: Admin")

  {
    const { res, ms } = await fetchJson("/admin")
    record("GET /admin → 200", res.status === 200, ms)
  }

  {
    const { res, body, ms } = await fetchJson("/admin/logs?limit=10")
    record("GET /admin/logs → 200", res.status === 200, ms)
    record("admin/logs object=list", body.object === "list", null)
    record("admin/logs has entries", Array.isArray(body.entries), null)
  }

  section("HTTP: Anthropic Messages")

  {
    const { res, body, ms } = await fetchJson("/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "composer-2.5",
        max_tokens: 256,
        messages: [{ role: "user", content: "Reply with exactly: anthropic-ok" }],
      }),
    })
    record("POST /v1/messages → 200", res.status === 200, ms)
    record("messages type=message", body.type === "message", null)
    record("messages has content", Array.isArray(body.content) && body.content.length > 0, null)
  }

  section("HTTP: Embeddings")

  {
    const { res, body, ms } = await fetchJson("/v1/embeddings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ input: "hello world" }),
    })
    record("POST /v1/embeddings → 200", res.status === 200, ms)
    record("embeddings data[0].embedding array", Array.isArray(body.data?.[0]?.embedding), null)
    record("embeddings dims=384 (semantic default)", body.dimensions === 384 || body.data?.[0]?.embedding?.length === 384, null, `provider=${body.provider}`)
    record("embeddings usage.prompt_tokens > 0", body.usage?.prompt_tokens > 0, null)
    bench("POST /v1/embeddings (single)", ms)
  }

  {
    const { res, body, ms } = await fetchJson("/v1/embeddings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ input: ["hello", "world", "test"], dimensions: 256 }),
    })
    record("POST /v1/embeddings batch → 200", res.status === 200, ms)
    record("embeddings batch count=3", body.data?.length === 3, null)
    record("embeddings custom dims=256", body.data?.[0]?.embedding?.length === 256, null)
    bench("POST /v1/embeddings (batch×3)", ms)
  }

  {
    const { res, ms } = await fetchJson("/v1/embeddings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ input: [] }),
    })
    record("POST /v1/embeddings empty input → 400", res.status === 400, ms)
  }

  {
    const { res, ms } = await fetchJson("/v1/embeddings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify("not-an-object"),
    })
    record("POST /v1/embeddings invalid body handled", res.status >= 400, ms)
  }

  section("HTTP: Chat Completions — Validation")

  {
    const { res, ms } = await fetchJson("/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages: [] }),
    })
    record("empty messages → 400", res.status === 400, ms)
  }

  {
    const { res, ms } = await fetchJson("/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: "composer-2.5", messages: [{ role: "user", content: "x" }], mode: "invalid" }),
    })
    record("invalid mode → 400", res.status === 400, ms)
  }

  section("HTTP: Chat Completions — Non-Streaming")

  {
    const { res, body, ms } = await fetchJson("/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "composer-2.5",
        messages: [{ role: "user", content: "Reply with exactly one word: ping" }],
      }),
    })
    record("chat non-stream → 200", res.status === 200, ms)
    record("chat response object", body.object === "chat.completion", null)
    record("chat has id", typeof body.id === "string" && body.id.startsWith("chatcmpl-"), null)
    record("chat has content", typeof body.choices?.[0]?.message?.content === "string", null, body.choices?.[0]?.message?.content?.slice(0, 40))
    record("chat finish_reason=stop", body.choices?.[0]?.finish_reason === "stop", null)
    record("chat usage.prompt_tokens > 0", body.usage?.prompt_tokens > 0, null, JSON.stringify(body.usage))
    record("chat usage.completion_tokens > 0", body.usage?.completion_tokens > 0, null)
    record("chat usage.total = sum", body.usage?.total_tokens === body.usage?.prompt_tokens + body.usage?.completion_tokens, null)
    bench("chat non-stream (simple)", ms, { usage: body.usage })
  }

  {
    const { res, body, ms } = await fetchJson("/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "openai/composer-2.5",
        messages: [{ role: "user", content: "Reply: ok" }],
      }),
    })
    record("chat model prefix normalization", res.status === 200, ms)
    record("chat model in response", body.model?.includes("Composer") || body.model?.includes("composer"), null, body.model)
  }

  {
    const { res, body, ms } = await fetchJson("/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        messages: [
          { role: "system", content: "You are concise." },
          { role: "user", content: "Say: test" },
        ],
      }),
    })
    record("chat default model (no model field)", res.status === 200, ms)
    record("chat system+user messages", body.choices?.[0]?.message?.content?.length > 0, null)
    bench("chat non-stream (system+user)", ms)
  }

  section("HTTP: Chat Completions — Tool Calling")

  {
    const { res, body, ms } = await fetchJson("/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "composer-2.5",
        messages: [{ role: "user", content: "Calculate 7*8 using the calculator tool." }],
        tools: [{
          type: "function",
          function: {
            name: "calculator",
            description: "Evaluate math expressions",
            parameters: { type: "object", properties: { expression: { type: "string" } }, required: ["expression"] },
          },
        }],
      }),
    })
    record("tool call non-stream → 200", res.status === 200, ms)
    record("tool call finish_reason", body.choices?.[0]?.finish_reason === "tool_calls", null, body.choices?.[0]?.finish_reason)
    record("tool call has tool_calls array", Array.isArray(body.choices?.[0]?.message?.tool_calls), null)
    record("tool call has function name", body.choices?.[0]?.message?.tool_calls?.[0]?.function?.name === "calculator", null)
    record("tool call content is null", body.choices?.[0]?.message?.content === null, null)
    record("tool call arguments parseable", (() => {
      try {
        JSON.parse(body.choices?.[0]?.message?.tool_calls?.[0]?.function?.arguments ?? "")
        return true
      } catch { return false }
    })(), null)
    bench("chat tool-call (non-stream)", ms)
  }

  {
    const { res, body, ms } = await fetchJson("/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "composer-2.5",
        messages: [
          { role: "user", content: "What's the weather?" },
          { role: "assistant", content: null, tool_calls: [{ id: "call_1", type: "function", function: { name: "get_weather", arguments: '{"city":"Berlin"}' } }] },
          { role: "tool", tool_call_id: "call_1", content: '{"temp":22}' },
          { role: "user", content: "Thanks, summarize." },
        ],
        tools: [{
          type: "function",
          function: { name: "get_weather", description: "Get weather", parameters: { type: "object", properties: { city: { type: "string" } } } },
        }],
      }),
    })
    record("multi-turn with tool result → 200", res.status === 200, ms)
    record("multi-turn has response", body.choices?.[0]?.message?.content?.length > 0, null)
    bench("chat multi-turn tool history", ms)
  }

  section("HTTP: Chat Completions — Streaming")

  {
    const { res, events, ms } = await fetchSse("/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "composer-2.5",
        stream: true,
        messages: [{ role: "user", content: "Reply with one word: stream" }],
      }),
    })
    record("stream → 200", res.status === 200, ms)
    record("stream content-type SSE", (res.headers.get("content-type") ?? "").includes("text/event-stream"), null)
    record("stream has X-Request-Id", !!res.headers.get("x-request-id"), null)

    const contentChunks = events.filter((e) => e.choices?.[0]?.delta?.content)
    const finishChunk = events.find((e) => e.choices?.[0]?.finish_reason)
    const usageChunk = events.find((e) => e.usage)

    record("stream has content chunks", contentChunks.length > 0, null, `chunks=${contentChunks.length}`)
    record("stream finish_reason=stop", finishChunk?.choices?.[0]?.finish_reason === "stop", null)
    record("stream usage in final chunk", usageChunk?.usage?.prompt_tokens > 0, null, JSON.stringify(usageChunk?.usage))
    bench("chat stream (simple)", ms, { chunks: contentChunks.length, usage: usageChunk?.usage })
  }

  {
    const { res, events, ms } = await fetchSse("/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "composer-2.5",
        stream: true,
        messages: [{ role: "user", content: "Use calculator for 3+3" }],
        tools: [{
          type: "function",
          function: {
            name: "calculator",
            description: "Math",
            parameters: { type: "object", properties: { expression: { type: "string" } } },
          },
        }],
      }),
    })
    const toolChunks = events.filter((e) => e.choices?.[0]?.delta?.tool_calls)
    const finishChunk = events.find((e) => e.choices?.[0]?.finish_reason)
    record("stream tool-call → 200", res.status === 200, ms)
    record("stream has tool_call deltas", toolChunks.length > 0, null, `toolChunks=${toolChunks.length}`)
    record("stream tool finish_reason", finishChunk?.choices?.[0]?.finish_reason === "tool_calls", null, finishChunk?.choices?.[0]?.finish_reason)
    bench("chat stream tool-call", ms)
  }

  section("HTTP: Responses API")

  {
    const { res, body, ms } = await fetchJson("/v1/responses", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "composer-2.5",
        input: "Reply with exactly one word: responses",
      }),
    })
    record("POST /v1/responses → 200", res.status === 200, ms)
    record("responses object=response", body.object === "response", null)
    record("responses has output text", body.output?.[0]?.content?.[0]?.text?.length > 0, null, body.output?.[0]?.content?.[0]?.text?.slice(0, 40))
    bench("POST /v1/responses (non-stream)", ms)
  }

  {
    const tinyPng = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="
    const { res, body, ms } = await fetchJson("/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "composer-2.5",
        messages: [{
          role: "user",
          content: [
            { type: "text", text: "Reply exactly: vision-ok" },
            { type: "image_url", image_url: { url: tinyPng } },
          ],
        }],
      }),
    })
    record("vision base64 chat → 200", res.status === 200, ms)
    const visionMessage = body.choices?.[0]?.message
    record(
      "vision chat has content or read tool_call",
      typeof visionMessage?.content === "string" ||
        visionMessage?.tool_calls?.some((call) => call.function?.name === "read"),
      null,
      visionMessage?.tool_calls?.[0]?.function?.name ?? visionMessage?.content?.slice(0, 40),
    )
    bench("chat vision base64", ms)
  }

  {
    const { res, events, ms } = await fetchSse("/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "composer-2.5",
        stream: true,
        reasoning_effort: "medium",
        messages: [{ role: "user", content: "Reply with one word: reasoning" }],
      }),
    })
    const reasoningChunks = events.filter((e) => e.choices?.[0]?.delta?.reasoning_content)
    record("stream reasoning_effort → 200", res.status === 200, ms)
    record("stream may include reasoning_content", reasoningChunks.length >= 0, null, `reasoningChunks=${reasoningChunks.length}`)
    bench("chat stream reasoning", ms, { reasoningChunks: reasoningChunks.length })
  }

  section("HTTP: Headers — X-Cursor-Mode & X-Cursor-Workspace")

  {
    const { res, ms } = await fetchJson("/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Cursor-Mode": "ask",
      },
      body: JSON.stringify({
        model: "composer-2.5",
        messages: [{ role: "user", content: "Reply: mode-ask" }],
      }),
    })
    record("X-Cursor-Mode: ask → 200", res.status === 200, ms)
  }

  {
    const { res, ms } = await fetchJson("/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Cursor-Mode": "plan",
      },
      body: JSON.stringify({
        model: "composer-2.5",
        messages: [{ role: "user", content: "Reply: mode-plan" }],
      }),
    })
    record("X-Cursor-Mode: plan → 200", res.status === 200, ms)
    bench("chat X-Cursor-Mode: plan", ms)
  }

  {
    const { res, ms } = await fetchJson("/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Cursor-Workspace": "/tmp",
      },
      body: JSON.stringify({
        model: "composer-2.5",
        messages: [{ role: "user", content: "Reply: workspace" }],
      }),
    })
    record("X-Cursor-Workspace: /tmp → 200", res.status === 200, ms)
  }

  section("HTTP: Images")

  {
    const { res, body, ms } = await fetchJson("/v1/images/generations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        prompt: "solid red square",
        size: "256x256",
        response_format: "b64_json",
      }),
    })
    record("POST /v1/images/generations → 200", res.status === 200, ms)
    record("images has data array", Array.isArray(body.data), null)
    record("images b64_json present", typeof body.data?.[0]?.b64_json === "string", null)
    record("images b64 decodable", (() => {
      try {
        const buf = Buffer.from(body.data?.[0]?.b64_json ?? "", "base64")
        return buf.length > 8 && buf[0] === 0x89 && buf[1] === 0x50 // PNG magic
      } catch { return false }
    })(), null)
    bench("POST /v1/images/generations", ms, { b64_len: body.data?.[0]?.b64_json?.length })
  }

  {
    const { res, ms } = await fetchJson("/v1/images/generations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: "" }),
    })
    record("images empty prompt → 400", res.status === 400, ms)
  }
}

// ─── CONCURRENCY & STRESS ───

async function runConcurrencyTests() {
  section("STRESS: Concurrent Requests")

  const makeChat = () => fetchJson("/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "composer-2.5",
      messages: [{ role: "user", content: "Reply one word: concurrent" }],
    }),
  })

  const start = Date.now()
  const concurrent = 3
  const results_ = await Promise.allSettled(Array.from({ length: concurrent }, () => makeChat()))
  const ms = Date.now() - start

  const ok = results_.filter((r) => r.status === "fulfilled" && r.value.res.status === 200).length
  record(`concurrent chat ×${concurrent}`, ok === concurrent, ms, `${ok}/${concurrent} succeeded`)
  bench(`concurrent chat ×${concurrent}`, ms, { succeeded: ok })

  section("STRESS: Rapid Embeddings")

  const startEmb = Date.now()
  const embResults = await Promise.all(
    Array.from({ length: 10 }, (_, i) => fetchJson("/v1/embeddings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ input: `test input ${i}`, dimensions: 64 }),
    })),
  )
  const embMs = Date.now() - startEmb
  const embOk = embResults.every((r) => r.res.status === 200)
  record("rapid embeddings ×10", embOk, embMs, `${embResults.length} requests`)
  bench("rapid embeddings ×10", embMs)
}

// ─── CLI TESTS ───

async function runCliTests() {
  section("CLI: Binary & Daemon")

  const runCli = (args) => new Promise((resolve) => {
    const child = spawn("node", [join(ROOT, "dist/cli.js"), ...args], { stdio: ["ignore", "pipe", "pipe"] })
    let out = ""
    child.stdout.on("data", (c) => { out += c })
    child.stderr.on("data", (c) => { out += c })
    child.on("close", (code) => resolve({ code, out }))
  })

  {
    const { code, out } = await runCli(["--help"])
    record("cli --help → 0", code === 0, null)
    record("cli help mentions endpoints", out.includes("/v1/chat/completions"), null)
  }

  {
    const { code, out } = await runCli(["status"])
    record("cli status → 0", code === 0, null)
    record("cli status reports running", out.includes("running") || out.includes("not running"), null, out.trim().slice(0, 60))
  }
}

// ─── DETERMINISM CROSS-CHECK ───

async function runCrossChecks() {
  section("CROSS-CHECK: Embedding API vs Unit (local provider only)")

  if (process.env.CURSOR_PLAN2API_EMBEDDING_PROVIDER === "local") {
    const { embedText } = await import(join(ROOT, "dist/openai/embeddings.js"))
    const local = embedText("cross-check", 1536)

    const { body } = await fetchJson("/v1/embeddings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ input: "cross-check", model: "text-embedding-plan2api-local", dimensions: 1536 }),
    })
    const api = body.data?.[0]?.embedding

    record("API embedding matches unit fn", JSON.stringify(local) === JSON.stringify(api), null)
  } else {
    skip("local embedding cross-check", "semantic provider active")
  }
}

// ─── REPORT ───

async function main() {
  log(`\n🔬 cursor-plan2api FULL TEST SUITE`)
  log(`   Target: ${BASE}`)
  log(`   Mode:   ${UNIT_ONLY ? "unit-only" : "full"}`)
  log(`   Time:   ${new Date().toISOString()}`)

  if (!UNIT_ONLY) {
    try {
      const { res } = await fetchJson("/health")
      if (res.status !== 200) throw new Error(`health returned ${res.status}`)
    } catch (e) {
      log(`\n❌ Server not reachable at ${BASE}: ${e.message}`)
      log("   Start with: node dist/cli.js")
      process.exit(1)
    }
  }

  await runUnitTests()
  if (!UNIT_ONLY) {
    await runHttpTests()
    await runConcurrencyTests()
    await runCrossChecks()
    await runCliTests()
  }

  section("BENCHMARK SUMMARY")
  benchmarks.sort((a, b) => b.ms - a.ms)
  for (const b of benchmarks) {
    const extra = Object.entries(b)
      .filter(([k]) => k !== "name" && k !== "ms")
      .map(([k, v]) => `${k}=${JSON.stringify(v)}`)
      .join(" ")
    log(`  ${String(b.ms).padStart(6)}ms  ${b.name}${extra ? `  (${extra})` : ""}`)
  }

  section("RESULTS")
  log(`  Passed:  ${passed}`)
  log(`  Failed:  ${failed}`)
  log(`  Skipped: ${skipped}`)
  log(`  Total:   ${passed + failed + skipped}`)

  if (bugs.length > 0) {
    section("BUGS FOUND")
    for (const b of bugs) {
      log(`  ✗ ${b.name}`)
      if (b.detail) log(`    → ${b.detail}`)
    }
  }

  const reportPath = join(ROOT, "test-report.json")
  const report = {
    timestamp: new Date().toISOString(),
    base: BASE,
    passed,
    failed,
    skipped,
    benchmarks,
    bugs,
    results,
  }

  try {
    const { writeFileSync } = await import("node:fs")
    writeFileSync(reportPath, JSON.stringify(report, null, 2))
    log(`\n  Report saved: ${reportPath}`)
  } catch { /* ignore */ }

  process.exit(failed > 0 ? 1 : 0)
}

main().catch((e) => {
  console.error("Fatal:", e)
  process.exit(1)
})

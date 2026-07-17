#!/usr/bin/env node
/**
 * Model matrix test: every chat model × mode × stream configuration.
 *
 * Prerequisites:
 *   - cursor-plan2api running (agent login required)
 *   - npm run build
 *
 * Usage:
 *   node scripts/model-matrix-test.mjs
 *   node scripts/model-matrix-test.mjs --base-url=http://127.0.0.1:8787
 *   node scripts/model-matrix-test.mjs --models=composer-2.5,auto
 *   node scripts/model-matrix-test.mjs --modes=ask --no-stream
 *   node scripts/model-matrix-test.mjs --list-only
 */

const BASE = process.argv.find((a) => a.startsWith("--base-url="))?.split("=")[1]
  ?? process.env.HC_TEST_BASE_URL
  ?? "http://127.0.0.1:8787"

const argValue = (name) => {
  const prefixed = process.argv.find((a) => a.startsWith(`--${name}=`))
  if (prefixed) return prefixed.split("=").slice(1).join("=")
  const idx = process.argv.indexOf(`--${name}`)
  if (idx !== -1 && process.argv[idx + 1] && !process.argv[idx + 1].startsWith("--")) {
    return process.argv[idx + 1]
  }
  return undefined
}

const hasFlag = (name) => process.argv.includes(`--${name}`)

const MODELS_FILTER = argValue("models")?.split(",").map((s) => s.trim()).filter(Boolean)
const MODES = (argValue("modes") ?? "ask,plan,agent").split(",").map((s) => s.trim()).filter(Boolean)
const TEST_STREAM = !hasFlag("no-stream")
const TEST_NON_STREAM = !hasFlag("no-non-stream")
const LIST_ONLY = hasFlag("list-only")
const TIMEOUT_MS = Number(argValue("timeout") ?? "180000")
const PROMPT = argValue("prompt") ?? "Reply with exactly one word: ok"

const EMBEDDING_PREFIX = "text-embedding-plan2api-"

const log = (msg) => process.stdout.write(`${msg}\n`)

const fetchJson = async (path, opts = {}) => {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  try {
    const res = await fetch(`${BASE}${path}`, { ...opts, signal: controller.signal })
    const ct = res.headers.get("content-type") ?? ""
    const body = ct.includes("json") ? await res.json() : await res.text()
    return { res, body }
  } finally {
    clearTimeout(timer)
  }
}

const fetchSse = async (path, opts = {}) => {
  const start = Date.now()
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  const res = await fetch(`${BASE}${path}`, { ...opts, signal: controller.signal })
  if (!res.ok || !res.body) {
    clearTimeout(timer)
    return { res, ok: false, ms: Date.now() - start, error: `HTTP ${res.status}` }
  }

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ""
  let chunks = 0
  let content = ""

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      const parts = buffer.split("\n\n")
      buffer = parts.pop() ?? ""
      for (const part of parts) {
        for (const line of part.split("\n")) {
          if (!line.startsWith("data: ") || line === "data: [DONE]") continue
          chunks += 1
          try {
            const parsed = JSON.parse(line.slice(6))
            const delta = parsed.choices?.[0]?.delta?.content
            if (typeof delta === "string") content += delta
          } catch { /* ignore */ }
        }
      }
    }
  } finally {
    clearTimeout(timer)
  }

  return {
    res,
    ok: chunks > 0 && content.trim().length > 0,
    ms: Date.now() - start,
    content: content.trim().slice(0, 80),
    chunks,
  }
}

const runCase = async (model, mode, stream) => {
  const label = `${model} | mode=${mode} | stream=${stream}`
  const start = Date.now()
  try {
    if (stream) {
      const result = await fetchSse("/v1/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model,
          mode,
          stream: true,
          messages: [{ role: "user", content: PROMPT }],
        }),
      })
      return {
        label,
        ok: result.ok,
        ms: result.ms,
        detail: result.ok ? result.content : result.error ?? `chunks=${result.chunks}`,
      }
    }

    const { res, body } = await fetchJson("/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        mode,
        stream: false,
        messages: [{ role: "user", content: PROMPT }],
      }),
    })

    const content = body?.choices?.[0]?.message?.content
    const ok = res.status === 200 && typeof content === "string" && content.trim().length > 0
    return {
      label,
      ok,
      ms: Date.now() - start,
      detail: ok ? content.trim().slice(0, 80) : body?.error?.message ?? body?.message ?? `HTTP ${res.status}`,
    }
  } catch (error) {
    return {
      label,
      ok: false,
      ms: Date.now() - start,
      detail: error instanceof Error ? error.message : String(error),
    }
  }
}

const main = async () => {
  log(`\n${"═".repeat(70)}`)
  log("  MODEL MATRIX TEST")
  log(`  base: ${BASE}`)
  log(`  modes: ${MODES.join(", ")}`)
  log(`  stream: ${[TEST_NON_STREAM && "false", TEST_STREAM && "true"].filter(Boolean).join(", ")}`)
  log(`${"═".repeat(70)}\n`)

  const health = await fetch(`${BASE}/health`).catch(() => null)
  if (!health?.ok) {
    log("✗ Server not reachable. Start cursor-plan2api first.")
    process.exit(1)
  }

  const { res, body } = await fetchJson("/v1/models")
  if (res.status !== 200) {
    log(`✗ GET /v1/models failed: HTTP ${res.status}`)
    process.exit(1)
  }

  let models = (body.data ?? [])
    .map((m) => m.id)
    .filter((id) => !id.startsWith(EMBEDDING_PREFIX))

  if (MODELS_FILTER?.length) {
    models = models.filter((id) => MODELS_FILTER.includes(id))
  }

  log(`Found ${models.length} chat models:\n  ${models.join("\n  ")}\n`)

  if (LIST_ONLY) {
    process.exit(0)
  }

  const cases = []
  for (const model of models) {
    for (const mode of MODES) {
      if (TEST_NON_STREAM) cases.push({ model, mode, stream: false })
      if (TEST_STREAM) cases.push({ model, mode, stream: true })
    }
  }

  log(`Running ${cases.length} combinations (timeout ${TIMEOUT_MS}ms each)...\n`)

  const results = []
  for (let i = 0; i < cases.length; i += 1) {
    const { model, mode, stream } = cases[i]
    const result = await runCase(model, mode, stream)
    results.push(result)
    const icon = result.ok ? "✓" : "✗"
    log(`[${String(i + 1).padStart(3)}/${cases.length}] ${icon} ${result.label} (${result.ms}ms) — ${result.detail}`)
  }

  const passed = results.filter((r) => r.ok).length
  const failed = results.filter((r) => !r.ok)

  log(`\n${"─".repeat(70)}`)
  log(`Results: ${passed}/${results.length} passed`)

  if (failed.length > 0) {
    log("\nFailed:")
    for (const f of failed) {
      log(`  ✗ ${f.label} — ${f.detail}`)
    }
  }

  const byModel = new Map()
  for (const r of results) {
    const model = r.label.split(" | ")[0]
    if (!byModel.has(model)) byModel.set(model, { pass: 0, fail: 0 })
    const entry = byModel.get(model)
    if (r.ok) entry.pass += 1
    else entry.fail += 1
  }

  log("\nPer model:")
  for (const [model, stats] of byModel) {
    log(`  ${stats.fail === 0 ? "✓" : "✗"} ${model}: ${stats.pass}/${stats.pass + stats.fail}`)
  }

  process.exit(failed.length > 0 ? 1 : 0)
}

main().catch((error) => {
  console.error("Fatal:", error)
  process.exit(1)
})

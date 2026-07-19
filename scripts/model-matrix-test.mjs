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
 *   node scripts/model-matrix-test.mjs --delay=60000 --resume --state-file=model-matrix-state.json
 *   node scripts/model-matrix-test.mjs --skip-fable --delay=45000
 */

import { readFileSync, writeFileSync, existsSync } from "node:fs"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, "..")

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
const DELAY_MS = Number(argValue("delay") ?? "0")
const RATE_LIMIT_BACKOFF_MS = Number(argValue("rate-limit-backoff") ?? "300000")
const STATE_FILE = argValue("state-file") ?? "model-matrix-state.json"
const RESUME = hasFlag("resume")
const SKIP_FABLE = hasFlag("skip-fable")
const PROMPT = argValue("prompt") ?? "Reply with exactly one word: ok"

const EMBEDDING_PREFIX = "text-embedding-plan2api-"

const log = (msg) => process.stdout.write(`${msg}\n`)

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

const isUsageLimited = (detail) =>
  /usage limit|spend limit|monthly cycle ends/i.test(detail ?? "")

/** Transient 429 / throttle — not subscription usage caps. */
const isRateLimited = (detail) =>
  !isUsageLimited(detail) &&
  /rate.?limit|too many requests|\b429\b/i.test(detail ?? "")

const isBlocked = (detail) =>
  /data retention policy|data policy/i.test(detail ?? "")

const applyUsageLimitSuccess = (result) => {
  if (!isUsageLimited(result.detail)) return result
  return {
    ...result,
    ok: true,
    skipped_usage_limit: true,
    detail: `usage_limit (ok): ${result.detail.slice(0, 120)}`,
    rateLimited: false,
  }
}

const caseKey = (model, mode, stream) => `${model}|${mode}|${stream}`

const loadState = () => {
  const path = STATE_FILE.startsWith("/") ? STATE_FILE : join(ROOT, STATE_FILE)
  if (!RESUME || !existsSync(path)) {
    return { path, results: new Map() }
  }
  try {
    const raw = JSON.parse(readFileSync(path, "utf8"))
    const results = new Map()
    for (const entry of raw.results ?? []) {
      results.set(caseKey(entry.model, entry.mode, entry.stream), entry)
    }
    return { path, results }
  } catch {
    return { path, results: new Map() }
  }
}

const saveState = (statePath, results) => {
  const entries = [...results.values()].sort((a, b) => a.key.localeCompare(b.key))
  writeFileSync(statePath, JSON.stringify({
    updated_at: new Date().toISOString(),
    passed: entries.filter((e) => e.ok).length,
    failed: entries.filter((e) => !e.ok).length,
    total: entries.length,
    results: entries,
  }, null, 2))
}

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
      return applyUsageLimitSuccess({
        label,
        ok: result.ok,
        ms: result.ms,
        detail: result.ok ? result.content : result.error ?? `chunks=${result.chunks}`,
        rateLimited: isRateLimited(result.error),
      })
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
    const errorText =
      body?.error?.message ??
      (typeof body === "string" ? body : body?.message) ??
      ""
    const ok = res.status === 200 && typeof content === "string" && content.trim().length > 0
    return applyUsageLimitSuccess({
      label,
      ok,
      ms: Date.now() - start,
      detail: ok ? content.trim().slice(0, 80) : errorText || `HTTP ${res.status}`,
      rateLimited: isRateLimited(errorText),
      blocked: isBlocked(errorText),
    })
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    return applyUsageLimitSuccess({
      label,
      ok: false,
      ms: Date.now() - start,
      detail,
      rateLimited: isRateLimited(detail),
      blocked: false,
    })
  }
}

const main = async () => {
  log(`\n${"═".repeat(70)}`)
  log("  MODEL MATRIX TEST")
  log(`  base: ${BASE}`)
  log(`  modes: ${MODES.join(", ")}`)
  log(`  stream: ${[TEST_NON_STREAM && "false", TEST_STREAM && "true"].filter(Boolean).join(", ")}`)
  if (DELAY_MS > 0) log(`  delay: ${DELAY_MS}ms between cases`)
  if (RESUME) log(`  resume: ${STATE_FILE}`)
  if (SKIP_FABLE) log(`  skip-fable: enabled`)
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

  if (SKIP_FABLE) {
    models = models.filter((id) => !id.includes("fable"))
  }

  const { path: statePath, results: priorResults } = loadState()

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

  const pending = cases.filter((c) => {
    const key = caseKey(c.model, c.mode, c.stream)
    const prior = priorResults.get(key)
    return !prior?.ok
  })

  const skipped = cases.length - pending.length
  log(`Running ${pending.length} combinations (${skipped} already passed, timeout ${TIMEOUT_MS}ms each)...\n`)

  const results = [...priorResults.values()]
  let consecutiveRateLimits = 0

  for (let i = 0; i < pending.length; i += 1) {
    const { model, mode, stream } = pending[i]
    const key = caseKey(model, mode, stream)

    if (DELAY_MS > 0 && i > 0) {
      log(`  … waiting ${DELAY_MS}ms before next case`)
      await sleep(DELAY_MS)
    }

    let result = await runCase(model, mode, stream)

    if (!result.ok && result.rateLimited) {
      consecutiveRateLimits += 1
      const backoff = RATE_LIMIT_BACKOFF_MS * consecutiveRateLimits
      log(`  ⚠ rate limit detected, backing off ${backoff}ms then retrying once…`)
      await sleep(backoff)
      result = applyUsageLimitSuccess(await runCase(model, mode, stream))
    } else {
      consecutiveRateLimits = 0
    }

    const entry = {
      key,
      model,
      mode,
      stream,
      ok: result.ok,
      ms: result.ms,
      detail: result.detail,
      blocked: result.blocked ?? false,
      skipped_usage_limit: result.skipped_usage_limit ?? false,
      tested_at: new Date().toISOString(),
    }

    const idx = results.findIndex((r) => r.key === key)
    if (idx === -1) results.push(entry)
    else results[idx] = entry

    priorResults.set(key, entry)
    saveState(statePath, new Map(results.map((r) => [r.key, r])))

    const icon = result.skipped_usage_limit ? "○" : result.ok ? "✓" : "✗"
    log(`[${String(i + 1).padStart(3)}/${pending.length}] ${icon} ${result.label} (${result.ms}ms) — ${result.detail}`)
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
    if (!byModel.has(r.model)) byModel.set(r.model, { pass: 0, fail: 0 })
    const entry = byModel.get(r.model)
    if (r.ok) entry.pass += 1
    else entry.fail += 1
  }

  log("\nPer model:")
  for (const [model, stats] of byModel) {
    log(`  ${stats.fail === 0 ? "✓" : "✗"} ${model}: ${stats.pass}/${stats.pass + stats.fail}`)
  }

  log(`\nState saved: ${statePath}`)
  process.exit(failed.length > 0 ? 1 : 0)
}

main().catch((error) => {
  console.error("Fatal:", error)
  process.exit(1)
})

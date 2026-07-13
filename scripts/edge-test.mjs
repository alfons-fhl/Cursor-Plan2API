#!/usr/bin/env node
/** Edge-case & combination tests to find hidden bugs */

const BASE = "http://127.0.0.1:8787"
const bugs = []
const pass = (n, ok, d = "") => { console.log(`${ok ? "✓" : "✗"} ${n}${d ? " — " + d : ""}`); if (!ok) bugs.push({ n, d }) }

async function j(path, opts = {}) {
  const t = Date.now()
  const r = await fetch(`${BASE}${path}`, opts)
  const ct = r.headers.get("content-type") ?? ""
  const body = ct.includes("json") ? await r.json() : await r.text()
  return { r, body, ms: Date.now() - t }
}

console.log("\n🔎 EDGE-CASE & COMBINATION TESTS\n")

// 1. Invalid JSON
{
  const r = await fetch(`${BASE}/v1/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{broken json",
  })
  pass("invalid JSON chat → 400", r.status === 400)
}

// 2. Missing messages field
{
  const { r } = await j("/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: "composer-2.5" }),
  })
  pass("missing messages → 400", r.status === 400)
}

// 3. Legacy functions API (not tools)
{
  const { r, body, ms } = await j("/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "composer-2.5",
      messages: [{ role: "user", content: "Use search for 'test'" }],
      functions: [{ name: "search", description: "Search web", parameters: { type: "object", properties: { q: { type: "string" } } } }],
    }),
  })
  pass("legacy functions API → 200", r.status === 200, `${ms}ms finish=${body.choices?.[0]?.finish_reason}`)
}

// 4. Multimodal message content array
{
  const { r, body, ms } = await j("/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "composer-2.5",
      messages: [{
        role: "user",
        content: [
          { type: "text", text: "Reply: multimodal" },
          { type: "image_url", image_url: { url: "https://example.com/x.png" } },
        ],
      }],
    }),
  })
  pass("multimodal content array → 200", r.status === 200, `${ms}ms`)
}

// 5. Very long prompt (stdin path) — 50k chars
{
  const long = "Summarize this text in one word: " + "word ".repeat(12000)
  const { r, ms } = await j("/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "composer-2.5",
      messages: [{ role: "user", content: long }],
    }),
  })
  pass("long prompt ~60k chars → 200", r.status === 200, `${ms}ms len=${long.length}`)
}

// 6. X-Cursor-Mode: agent (default agent mode)
{
  const { r, ms } = await j("/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Cursor-Mode": "agent" },
    body: JSON.stringify({
      model: "composer-2.5",
      messages: [{ role: "user", content: "Reply one word: agent-mode" }],
    }),
  })
  pass("X-Cursor-Mode: agent → 200", r.status === 200, `${ms}ms`)
}

// 7. body.mode overrides default
{
  const { r, ms } = await j("/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "composer-2.5",
      mode: "ask",
      messages: [{ role: "user", content: "Reply: body-mode" }],
    }),
  })
  pass("body.mode=ask → 200", r.status === 200, `${ms}ms`)
}

// 8. Header mode vs body mode conflict (header wins?)
{
  const { r, ms } = await j("/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Cursor-Mode": "ask" },
    body: JSON.stringify({
      model: "composer-2.5",
      mode: "plan",
      messages: [{ role: "user", content: "Reply: conflict" }],
    }),
  })
  pass("header/body mode conflict → 400", r.status === 400, `${ms}ms`)
}

// 9. Stream + tools + system message combo
{
  const res = await fetch(`${BASE}/v1/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "composer-2.5",
      stream: true,
      messages: [
        { role: "system", content: "Always use tools when math is involved." },
        { role: "user", content: "What is 99+1?" },
      ],
      tools: [{
        type: "function",
        function: { name: "calculator", description: "Math", parameters: { type: "object", properties: { expression: { type: "string" } } } },
      }],
    }),
  })
  const text = await res.text()
  const hasToolCall = text.includes("tool_calls")
  const hasDone = text.includes("[DONE]")
  pass("stream+tools+system combo", res.status === 200 && hasDone, `tool_calls in stream=${hasToolCall}`)
}

// 10. Embeddings: special chars & unicode
{
  const { r, body } = await j("/v1/embeddings", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ input: "emoji 🚀 unicode ñ 中文 \"quotes\"" }),
  })
  const v = body.data?.[0]?.embedding
  pass("embeddings unicode/special chars", r.status === 200 && v?.length === 1536)
}

// 11. Embeddings: identical inputs same vector
{
  const { body: b1 } = await j("/v1/embeddings", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ input: "same", dimensions: 64 }),
  })
  const { body: b2 } = await j("/v1/embeddings", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ input: "same", dimensions: 64 }),
  })
  pass("embeddings idempotent", JSON.stringify(b1.data[0].embedding) === JSON.stringify(b2.data[0].embedding))
}

// 12. Images: different sizes
{
  const { r, body, ms } = await j("/v1/images/generations", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt: "green circle", size: "512x512", response_format: "b64_json" }),
  })
  const buf = Buffer.from(body.data?.[0]?.b64_json ?? "", "base64")
  pass("images 512x512 PNG", r.status === 200 && buf[0] === 0x89, `${ms}ms size=${buf.length}b`)
}

// 13. Concurrent embeddings + health (no semaphore on embeddings?)
{
  const [h, e1, e2] = await Promise.all([
    j("/health"),
    j("/v1/embeddings", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ input: "a", dimensions: 32 }) }),
    j("/v1/embeddings", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ input: "b", dimensions: 32 }) }),
  ])
  pass("concurrent health+embeddings", h.r.status === 200 && e1.r.status === 200 && e2.r.status === 200)
}

// 14. Response structure validation
{
  const { body } = await j("/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "composer-2.5",
      messages: [{ role: "user", content: "Reply: struct" }],
    }),
  })
  pass("response.created is unix ts", typeof body.created === "number" && body.created > 1700000000)
  pass("response.choices[0].index === 0", body.choices?.[0]?.index === 0)
  pass("response.choices[0].message.role === assistant", body.choices?.[0]?.message?.role === "assistant")
}

// 15. Double finish_reason check on stream
{
  const res = await fetch(`${BASE}/v1/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "composer-2.5", stream: true,
      messages: [{ role: "user", content: "Reply: sse" }],
    }),
  })
  const text = await res.text()
  const finishMatches = [...text.matchAll(/"finish_reason":"(stop|tool_calls)"/g)]
  pass("stream exactly one finish_reason", finishMatches.length === 1, `count=${finishMatches.length}`)
}

// 16. Tool call without tools defined (should still work, maybe text response)
{
  const { r, body, ms } = await j("/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "composer-2.5",
      messages: [{ role: "user", content: "What is 5+5? Just answer." }],
    }),
  })
  pass("chat without tools defined", r.status === 200 && body.choices?.[0]?.finish_reason === "stop", `${ms}ms`)
}

console.log(`\n${"─".repeat(40)}`)
console.log(`Edge tests: ${bugs.length === 0 ? "ALL PASSED" : bugs.length + " FAILED"}`)
if (bugs.length) bugs.forEach((b) => console.log(`  BUG: ${b.n} — ${b.d}`))
process.exit(bugs.length ? 1 : 0)

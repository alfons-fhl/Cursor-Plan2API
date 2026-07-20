#!/usr/bin/env node
/**
 * Compare `agent --list-models` output with src/cursor/catalog.ts.
 * Exits 0 when in sync; 1 when drift is detected.
 *
 * Usage:
 *   node scripts/sync-catalog-check.mjs
 *   node scripts/sync-catalog-check.mjs --write-hint
 */

import { spawnSync } from "node:child_process"
import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, "..")
const CATALOG_PATH = join(ROOT, "src/cursor/catalog.ts")
const WRITE_HINT = process.argv.includes("--write-hint")

const extractCatalogIds = (source) => {
  const ids = new Set()
  const pattern = /\{\s*id:\s*"([^"]+)"/g
  let match
  while ((match = pattern.exec(source)) !== null) {
    ids.add(match[1])
  }
  return ids
}

const parseCliModels = (output) => {
  const ids = new Set()
  for (const line of output.split(/\r?\n/)) {
    const trimmed = line.replace(/\x1b\[[0-9;]*m/g, "").trim()
    const match = trimmed.match(/^([A-Za-z0-9][A-Za-z0-9._:/-]*)\s+-\s+/)
    if (match) ids.add(match[1])
  }
  return ids
}

const catalogSource = readFileSync(CATALOG_PATH, "utf8")
const catalogIds = extractCatalogIds(catalogSource)

const agentBin = process.env.CURSOR_PLAN2API_AGENT_BIN ?? process.env.AGENT_BIN ?? "agent"
const result = spawnSync(agentBin, ["--list-models"], {
  encoding: "utf8",
  timeout: 30_000,
})

if (result.error || result.status !== 0) {
  console.error("WARN: agent --list-models unavailable in CI; skipping catalog drift check")
  console.error(result.stderr?.trim() || result.error?.message || "unknown error")
  process.exit(0)
}

const cliIds = parseCliModels(result.stdout ?? "")

const missingInCatalog = [...cliIds].filter((id) => !catalogIds.has(id)).sort()
const extraInCatalog = [...catalogIds].filter((id) => !cliIds.has(id)).sort()

console.log(`CLI models: ${cliIds.size}`)
console.log(`Catalog models: ${catalogIds.size}`)

if (missingInCatalog.length === 0 && extraInCatalog.length === 0) {
  console.log("Catalog is in sync with agent --list-models")
  process.exit(0)
}

console.error("\nCatalog drift detected:\n")

if (missingInCatalog.length > 0) {
  console.error(`Missing from catalog (${missingInCatalog.length}):`)
  for (const id of missingInCatalog) {
    console.error(`  + ${id}`)
  }
}

if (extraInCatalog.length > 0) {
  console.error(`\nIn catalog but not in CLI (${extraInCatalog.length}) — may be intentional fallback ids:`)
  for (const id of extraInCatalog.slice(0, 20)) {
    console.error(`  - ${id}`)
  }
  if (extraInCatalog.length > 20) {
    console.error(`  ... and ${extraInCatalog.length - 20} more`)
  }
}

if (WRITE_HINT && missingInCatalog.length > 0) {
  console.error("\nAdd to src/cursor/catalog.ts:")
  for (const id of missingInCatalog) {
    const name = id
      .replace(/-/g, " ")
      .replace(/\b\w/g, (c) => c.toUpperCase())
    console.error(`  { id: "${id}", name: "${name}" },`)
  }
}

// Fail CI only when CLI exposes models missing from our catalog.
process.exit(missingInCatalog.length > 0 ? 1 : 0)

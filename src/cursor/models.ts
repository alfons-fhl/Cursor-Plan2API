import type { CursorCliModel } from "./types.js"

/**
 * Parse `CURSOR_PLAN2API_EXTRA_MODELS` entries.
 *
 * Format: comma-separated `id` or `id=Display Name`
 * Example: cursor-grok-4.5-high=Grok 4.5,claude-opus-4-7-thinking-high
 */
export const parseExtraModels = (raw?: string): CursorCliModel[] => {
  if (!raw?.trim()) return []

  const models: CursorCliModel[] = []
  const seen = new Set<string>()

  for (const entry of raw.split(",")) {
    const trimmed = entry.trim()
    if (!trimmed) continue

    const separator = trimmed.indexOf("=")
    const id = (separator === -1 ? trimmed : trimmed.slice(0, separator)).trim()
    const name =
      separator === -1
        ? id
        : trimmed.slice(separator + 1).trim() || id

    if (!id || seen.has(id)) continue
    seen.add(id)
    models.push({ id, name })
  }

  return models
}

/**
 * Merge CLI models with configured extras. CLI entries win on id conflicts.
 */
export const mergeModelLists = (
  cliModels: CursorCliModel[],
  extraModels: CursorCliModel[],
): CursorCliModel[] => {
  const byId = new Map<string, CursorCliModel>()

  for (const model of extraModels) {
    byId.set(model.id, model)
  }

  for (const model of cliModels) {
    byId.set(model.id, model)
  }

  return [...byId.values()]
}

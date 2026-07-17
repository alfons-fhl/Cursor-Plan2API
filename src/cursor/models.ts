import type { CursorCliModel } from "./types.js"
import { CURSOR_MODEL_CATALOG } from "./catalog.js"

export { CURSOR_MODEL_CATALOG, CURSOR_MODEL_CATALOG_IDS } from "./catalog.js"

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
 * Merge model lists. The first list wins on id conflicts.
 */
export const mergeModelLists = (
  primary: CursorCliModel[],
  secondary: CursorCliModel[],
): CursorCliModel[] => {
  const byId = new Map<string, CursorCliModel>()

  for (const model of secondary) {
    byId.set(model.id, model)
  }

  for (const model of primary) {
    byId.set(model.id, model)
  }

  return [...byId.values()]
}

/**
 * Build the public model list: catalog (optional) + env extras + live CLI models.
 * Later sources win on id conflicts (CLI names override catalog).
 */
export const resolvePublicModels = (
  cliModels: CursorCliModel[],
  options: {
    includeCatalog: boolean
    extraModels: CursorCliModel[]
  },
): CursorCliModel[] => {
  const catalog = options.includeCatalog ? [...CURSOR_MODEL_CATALOG] : []
  const supplemental = mergeModelLists(options.extraModels, catalog)
  return mergeModelLists(cliModels, supplemental)
}

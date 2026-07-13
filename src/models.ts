/**
 * Primary Cursor models exposed for Hermes, OpenCode, and other clients.
 */
export const RECOMMENDED_MODELS = [
  {
    id: "composer-2.5",
    name: "Composer 2.5",
    description: "Default — balanced quality and speed",
  },
  {
    id: "composer-2.5-fast",
    name: "Composer 2.5 Fast",
    description: "Lower latency for chat and tool loops",
  },
  {
    id: "auto",
    name: "Auto",
    description: "Cursor model routing (auto-select)",
  },
] as const

export type RecommendedModelId = (typeof RECOMMENDED_MODELS)[number]["id"]

export const RECOMMENDED_MODEL_IDS: readonly RecommendedModelId[] =
  RECOMMENDED_MODELS.map((model) => model.id)

/**
 * Sort model list with recommended Composer models first.
 */
export const sortModelsWithRecommendedFirst = <T extends { id: string }>(
  models: T[],
): T[] => {
  const rank = new Map(
    RECOMMENDED_MODEL_IDS.map((id, index) => [id, index]),
  )

  return [...models].sort((left, right) => {
    const leftRank = rank.get(left.id as RecommendedModelId)
    const rightRank = rank.get(right.id as RecommendedModelId)

    if (leftRank !== undefined && rightRank !== undefined) {
      return leftRank - rightRank
    }
    if (leftRank !== undefined) return -1
    if (rightRank !== undefined) return 1
    return left.id.localeCompare(right.id)
  })
}

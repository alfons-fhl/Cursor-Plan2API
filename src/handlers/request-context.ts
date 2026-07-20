import type { ProxyConfig } from "../config.js"
import type { ProfileRotator, ProfileSelection } from "../cursor/profile-rotator.js"

export type EffectiveRequestContext = {
  config: ProxyConfig
  profile?: ProfileSelection
}

/**
 * Select an optional CLI profile and merge agent binary overrides.
 */
export const resolveEffectiveContext = (
  config: ProxyConfig,
  profileRotator?: ProfileRotator,
): EffectiveRequestContext => {
  const profile = profileRotator?.select()
  return {
    config: profileRotator?.applyConfig(config, profile) ?? config,
    profile,
  }
}

/**
 * Profile workspace acts as default when no X-Cursor-Workspace header is set.
 */
export const resolveWorkspaceHeader = (
  profile: ProfileSelection | undefined,
  headerWorkspace?: string | string[],
): string | string[] | undefined => {
  const headerValue = Array.isArray(headerWorkspace)
    ? headerWorkspace[0]
    : headerWorkspace
  if (headerValue?.trim()) return headerWorkspace
  return profile?.workspace
}

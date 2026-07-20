import type { ProxyConfig } from "./config.js"

export type ResolvedProxyConfig = {
  httpProxy?: string
  httpsProxy?: string
}

/**
 * Merge proxy settings from config and standard environment variables.
 */
export const resolveProxyConfig = (
  config: Pick<ProxyConfig, "httpProxy" | "httpsProxy">,
): ResolvedProxyConfig => ({
  httpProxy:
    config.httpProxy?.trim() ||
    process.env.HTTP_PROXY?.trim() ||
    process.env.http_proxy?.trim() ||
    undefined,
  httpsProxy:
    config.httpsProxy?.trim() ||
    process.env.HTTPS_PROXY?.trim() ||
    process.env.https_proxy?.trim() ||
    process.env.HTTP_PROXY?.trim() ||
    process.env.http_proxy?.trim() ||
    undefined,
})

/**
 * Pick the proxy URL for an outbound request target.
 */
export const selectProxyUrl = (
  targetUrl: string,
  proxy: ResolvedProxyConfig,
): string | undefined => {
  if (targetUrl.startsWith("https://")) {
    return proxy.httpsProxy
  }
  if (targetUrl.startsWith("http://")) {
    return proxy.httpProxy ?? proxy.httpsProxy
  }
  return proxy.httpsProxy ?? proxy.httpProxy
}

type ProxyAgentCtor = new (uri: string) => unknown

let proxyAgentCtor: ProxyAgentCtor | null | undefined

const dynamicImport = (specifier: string): Promise<unknown> =>
  new Function("specifier", "return import(specifier)")(specifier) as Promise<unknown>

const loadProxyAgent = async (): Promise<ProxyAgentCtor | null> => {
  if (proxyAgentCtor !== undefined) return proxyAgentCtor
  try {
    const undici = (await dynamicImport("undici")) as {
      ProxyAgent: ProxyAgentCtor
    }
    proxyAgentCtor = undici.ProxyAgent
    return proxyAgentCtor
  } catch {
    proxyAgentCtor = null
    return null
  }
}

/**
 * Fetch with optional HTTP(S) proxy support.
 */
export const proxiedFetch = async (
  url: string,
  init: RequestInit & { timeoutMs?: number } = {},
  proxy: ResolvedProxyConfig = {},
): Promise<Response> => {
  const { timeoutMs, ...fetchInit } = init
  const proxyUrl = selectProxyUrl(url, proxy)

  const controller = new AbortController()
  const signals: AbortSignal[] = []
  if (fetchInit.signal) signals.push(fetchInit.signal)
  signals.push(controller.signal)

  const linkedSignal =
    signals.length > 1
      ? AbortSignal.any(signals)
      : controller.signal

  const timer =
    timeoutMs && timeoutMs > 0
      ? setTimeout(() => controller.abort(), timeoutMs)
      : undefined

  try {
    const requestInit: RequestInit & { dispatcher?: unknown } = {
      ...fetchInit,
      signal: linkedSignal,
    }

    if (proxyUrl) {
      const ProxyAgent = await loadProxyAgent()
      if (ProxyAgent) {
        requestInit.dispatcher = new ProxyAgent(proxyUrl)
      }
    }

    return await fetch(url, requestInit)
  } finally {
    if (timer) clearTimeout(timer)
  }
}

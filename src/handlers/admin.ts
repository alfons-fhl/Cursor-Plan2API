import type { IncomingMessage, ServerResponse } from "node:http"

import type { ProxyConfig } from "../config.js"
import { fetchLocalAccountUsage } from "../cursor/auth.js"
import { formatAuthLabel, resolveCursorAuth } from "../cursor/bridge-auth.js"
import { estimateModelCostUsd } from "../cursor/pricing.js"
import type { AgentWarmPool } from "../cursor/agent-pool.js"
import type { ProfileRotator } from "../cursor/profile-rotator.js"
import { resolveSessionDbPath } from "../cursor/session-persistence.js"
import type { CursorSessionStore } from "../cursor/session-store.js"
import { resolveProxyConfig } from "../http-client.js"
import { getRecentRequests, subscribeRequestLog } from "../request-log.js"
import { authorize, sendError } from "./shared.js"
import { sendJson } from "./http.js"
import { writeSse, endSse } from "./http.js"

type HandlerContext = {
  config: ProxyConfig
  cliVersion?: string
  sessionStore?: CursorSessionStore
  agentPool?: AgentWarmPool
  profileRotator?: ProfileRotator
}

const ADMIN_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Cursor-Plan2API — Admin</title>
  <style>
    body { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; margin: 1rem; background: #0d1117; color: #c9d1d9; }
    h1 { font-size: 1.1rem; color: #58a6ff; }
    h2 { font-size: 0.95rem; color: #8b949e; margin-top: 1.25rem; }
    .stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 0.75rem; margin: 1rem 0; }
    .card { background: #161b22; border: 1px solid #21262d; border-radius: 6px; padding: 0.75rem; }
    .card h3 { margin: 0 0 0.35rem; font-size: 0.8rem; color: #8b949e; text-transform: uppercase; }
    .card .value { font-size: 1rem; color: #e6edf3; }
    table { width: 100%; border-collapse: collapse; font-size: 0.85rem; }
    th, td { text-align: left; padding: 0.35rem 0.5rem; border-bottom: 1px solid #21262d; }
    th { color: #8b949e; }
    tr:hover { background: #161b22; }
    .ok { color: #3fb950; }
    .err { color: #f85149; }
    #status { color: #8b949e; margin-bottom: 0.5rem; }
  </style>
</head>
<body>
  <h1>Cursor-Plan2API Admin</h1>
  <div id="stats" class="stats">Loading stats…</div>
  <h2>Request Log</h2>
  <div id="status">Connecting live tail…</div>
  <table>
    <thead><tr><th>Time</th><th>Method</th><th>Path</th><th>Status</th><th>Latency</th><th>Model</th></tr></thead>
    <tbody id="log"></tbody>
  </table>
  <script>
    const tbody = document.getElementById('log');
    const status = document.getElementById('status');
    const statsEl = document.getElementById('stats');
    const rows = [];

    const renderStats = (stats) => {
      const cards = [
        ['Auth', stats.auth_label],
        ['CLI Version', stats.cli_version ?? 'unknown'],
        ['Cached Sessions', String(stats.cached_sessions ?? 0)],
        ['Agent Pool', stats.agent_pool?.enabled ? stats.agent_pool.warmCount + '/' + stats.agent_pool.poolSize + ' warm' : 'disabled'],
        ['Profiles', (stats.profiles ?? []).join(', ') || 'none'],
        ['Compression', stats.compression_level ?? 'default'],
        ['Usage Models', stats.usage_summary?.model_count != null ? String(stats.usage_summary.model_count) : 'unavailable'],
        ['Est. Cost (USD)', stats.usage_summary?.estimated_cost_usd_total != null ? '$' + stats.usage_summary.estimated_cost_usd_total : '—'],
      ];
      statsEl.innerHTML = cards.map(([title, value]) =>
        '<div class="card"><h3>' + title + '</h3><div class="value">' + value + '</div></div>'
      ).join('');
    };

    const render = () => {
      tbody.innerHTML = rows.slice(-200).map(r =>
        '<tr><td>' + r.timestamp + '</td><td>' + r.method + '</td><td>' + r.pathname +
        '</td><td class="' + (r.status >= 400 ? 'err' : 'ok') + '">' + (r.status ?? '-') +
        '</td><td>' + (r.latencyMs != null ? r.latencyMs + 'ms' : '-') +
        '</td><td>' + (r.model ?? '-') + '</td></tr>'
      ).join('');
    };

    fetch('/admin/stats').then(r => r.json()).then(renderStats).catch(() => {
      statsEl.textContent = 'Could not load stats';
    });

    fetch('/admin/logs?limit=100').then(r => r.json()).then(d => {
      rows.push(...d.entries);
      render();
    });
    const es = new EventSource('/admin/logs/stream');
    es.onopen = () => { status.textContent = 'Live tail connected'; };
    es.onmessage = (e) => {
      try { rows.push(JSON.parse(e.data)); render(); } catch {}
    };
    es.onerror = () => { status.textContent = 'Live tail disconnected'; };
  </script>
</body>
</html>`

/**
 * Build admin stats payload for dashboard and JSON API.
 */
export const buildAdminStats = async (
  ctx: HandlerContext,
): Promise<Record<string, unknown>> => {
  const auth = await resolveCursorAuth(ctx.config)
  const usage = await fetchLocalAccountUsage(ctx.config)
  const proxy = resolveProxyConfig(ctx.config)

  let estimatedCostUsdTotal: number | null = null
  let modelCount: number | null = null
  if (usage) {
    modelCount = Object.keys(usage.models).length
    estimatedCostUsdTotal = 0
    for (const [modelId, modelUsage] of Object.entries(usage.models)) {
      estimatedCostUsdTotal += estimateModelCostUsd(
        modelId,
        modelUsage.numTokens,
        modelUsage.numRequests,
      )
    }
    estimatedCostUsdTotal = Math.round(estimatedCostUsdTotal * 1_000_000) / 1_000_000
  }

  return {
    status: "ok",
    auth_label: formatAuthLabel(auth),
    auth_bridge: {
      cli_subscription: auth.cliSubscription,
      dashboard_api_key: auth.dashboardApiKey,
      source: auth.source,
    },
    cli_version: ctx.cliVersion ?? "unknown",
    cached_sessions: ctx.sessionStore?.size() ?? 0,
    session_persistence: resolveSessionDbPath(ctx.config.sessionDbPath),
    compression_level: ctx.config.compressionLevel,
    outbound_proxy: Boolean(proxy.httpProxy || proxy.httpsProxy),
    agent_pool: ctx.agentPool?.getStats() ?? { enabled: false },
    profile_rotation: ctx.config.profileRotation,
    profiles: ctx.profileRotator?.listNames() ?? [],
    usage_summary: usage
      ? {
          start_of_month: usage.startOfMonth,
          model_count: modelCount,
          estimated_cost_usd_total: estimatedCostUsdTotal,
        }
      : null,
    timestamp: new Date().toISOString(),
  }
}

/**
 * Handle GET /admin — lightweight HTML request log UI.
 */
export const handleAdmin = (
  req: IncomingMessage,
  res: ServerResponse,
  ctx: HandlerContext,
): void => {
  if (!authorize(req, ctx.config)) {
    sendError(res, 401, "Invalid bridge API key", "authentication_error")
    return
  }

  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" })
  res.end(ADMIN_HTML)
}

/**
 * Handle GET /admin/stats — JSON dashboard stats.
 */
export const handleAdminStats = async (
  req: IncomingMessage,
  res: ServerResponse,
  ctx: HandlerContext,
): Promise<void> => {
  if (!authorize(req, ctx.config)) {
    sendError(res, 401, "Invalid bridge API key", "authentication_error")
    return
  }

  const stats = await buildAdminStats(ctx)
  sendJson(res, 200, stats)
}

/**
 * Handle GET /admin/logs — JSON request log.
 */
export const handleAdminLogs = (
  req: IncomingMessage,
  res: ServerResponse,
  ctx: HandlerContext,
): void => {
  if (!authorize(req, ctx.config)) {
    sendError(res, 401, "Invalid bridge API key", "authentication_error")
    return
  }

  const url = new URL(req.url ?? "/", "http://localhost")
  const limit = Math.min(500, Math.max(1, Number.parseInt(url.searchParams.get("limit") ?? "100", 10)))

  sendJson(res, 200, {
    object: "list",
    count: getRecentRequests(limit).length,
    entries: getRecentRequests(limit),
  })
}

/**
 * Handle GET /admin/logs/stream — SSE live log tail.
 */
export const handleAdminLogsStream = (
  req: IncomingMessage,
  res: ServerResponse,
  ctx: HandlerContext,
): void => {
  if (!authorize(req, ctx.config)) {
    sendError(res, 401, "Invalid bridge API key", "authentication_error")
    return
  }

  writeSse(res, { "Cache-Control": "no-cache" })

  const unsubscribe = subscribeRequestLog((entry) => {
    writeSse(res, {}, `data: ${JSON.stringify(entry)}\n\n`)
  })

  req.on("close", () => {
    unsubscribe()
    endSse(res)
  })
}

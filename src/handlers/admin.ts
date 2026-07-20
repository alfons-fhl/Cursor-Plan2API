import type { IncomingMessage, ServerResponse } from "node:http"

import type { ProxyConfig } from "../config.js"
import { getRecentRequests, subscribeRequestLog } from "../request-log.js"
import { authorize, sendError } from "./shared.js"
import { sendJson } from "./http.js"
import { writeSse, endSse } from "./http.js"

type HandlerContext = {
  config: ProxyConfig
}

const ADMIN_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Cursor-Plan2API — Request Log</title>
  <style>
    body { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; margin: 1rem; background: #0d1117; color: #c9d1d9; }
    h1 { font-size: 1.1rem; color: #58a6ff; }
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
  <h1>Cursor-Plan2API Request Log</h1>
  <div id="status">Connecting live tail…</div>
  <table>
    <thead><tr><th>Time</th><th>Method</th><th>Path</th><th>Status</th><th>Latency</th><th>Model</th></tr></thead>
    <tbody id="log"></tbody>
  </table>
  <script>
    const tbody = document.getElementById('log');
    const status = document.getElementById('status');
    const rows = [];
    const render = () => {
      tbody.innerHTML = rows.slice(-200).map(r =>
        '<tr><td>' + r.timestamp + '</td><td>' + r.method + '</td><td>' + r.pathname +
        '</td><td class="' + (r.status >= 400 ? 'err' : 'ok') + '">' + (r.status ?? '-') +
        '</td><td>' + (r.latencyMs != null ? r.latencyMs + 'ms' : '-') +
        '</td><td>' + (r.model ?? '-') + '</td></tr>'
      ).join('');
    };
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

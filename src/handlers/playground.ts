import type { IncomingMessage, ServerResponse } from "node:http"

import type { ProxyConfig } from "../config.js"
import { authorize, sendError } from "./shared.js"

type HandlerContext = {
  config: ProxyConfig
}

const PLAYGROUND_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Cursor-Plan2API — Playground</title>
  <style>
    :root { color-scheme: dark; }
    body { font-family: system-ui, sans-serif; margin: 1.5rem; background: #0d1117; color: #c9d1d9; max-width: 960px; }
    h1 { font-size: 1.25rem; color: #58a6ff; margin-bottom: 0.25rem; }
    p.sub { color: #8b949e; margin-top: 0; }
    label { display: block; margin: 0.75rem 0 0.25rem; font-size: 0.85rem; color: #8b949e; }
    select, textarea, input[type="text"] { width: 100%; box-sizing: border-box; background: #161b22; color: #c9d1d9; border: 1px solid #30363d; border-radius: 6px; padding: 0.5rem; }
    textarea { min-height: 140px; font-family: ui-monospace, monospace; font-size: 0.9rem; }
    .row { display: flex; gap: 1rem; align-items: center; flex-wrap: wrap; }
    .row label { margin: 0; display: flex; align-items: center; gap: 0.35rem; }
    button { margin-top: 1rem; background: #238636; color: #fff; border: none; border-radius: 6px; padding: 0.55rem 1rem; cursor: pointer; font-weight: 600; }
    button:disabled { opacity: 0.5; cursor: not-allowed; }
    #output { margin-top: 1rem; white-space: pre-wrap; background: #161b22; border: 1px solid #30363d; border-radius: 6px; padding: 0.75rem; min-height: 120px; font-family: ui-monospace, monospace; font-size: 0.85rem; }
    #status { margin-top: 0.5rem; font-size: 0.85rem; color: #8b949e; }
    a { color: #58a6ff; }
  </style>
</head>
<body>
  <h1>Cursor-Plan2API Playground</h1>
  <p class="sub">Test <code>POST /v1/chat/completions</code> against this gateway. Models load from <code>GET /v1/models</code>.</p>

  <label for="model">Model</label>
  <select id="model" aria-label="Model picker"></select>

  <label for="apiKey">API key (optional — only if CURSOR_PLAN2API_API_KEY is set)</label>
  <input id="apiKey" type="text" placeholder="Bearer token" autocomplete="off" />

  <label for="prompt">Message</label>
  <textarea id="prompt" placeholder="Say hello in one sentence.">Say hello in one sentence.</textarea>

  <div class="row">
    <label><input type="checkbox" id="stream" checked /> Stream (SSE)</label>
  </div>

  <button id="send" type="button">Send</button>
  <div id="status"></div>
  <div id="output" aria-live="polite"></div>

  <p class="sub" style="margin-top:1.5rem"><a href="/admin">Admin logs</a> · <a href="/docs/openapi.yaml">OpenAPI</a> · <a href="/health">Health</a></p>

  <script>
    const modelEl = document.getElementById('model');
    const promptEl = document.getElementById('prompt');
    const streamEl = document.getElementById('stream');
    const apiKeyEl = document.getElementById('apiKey');
    const outputEl = document.getElementById('output');
    const statusEl = document.getElementById('status');
    const sendBtn = document.getElementById('send');

    const authHeaders = () => {
      const key = apiKeyEl.value.trim();
      return key ? { Authorization: 'Bearer ' + key } : {};
    };

    async function loadModels() {
      statusEl.textContent = 'Loading models…';
      try {
        const res = await fetch('/v1/models', { headers: authHeaders() });
        const data = await res.json();
        const models = (data.recommended || []).concat((data.data || []).map(m => m.id));
        const unique = [...new Set(models)];
        modelEl.innerHTML = unique.map(id => '<option value="' + id + '">' + id + '</option>').join('');
        statusEl.textContent = unique.length + ' models loaded';
      } catch (e) {
        statusEl.textContent = 'Failed to load models: ' + e.message;
      }
    }

    async function sendChat() {
      sendBtn.disabled = true;
      outputEl.textContent = '';
      statusEl.textContent = 'Sending…';
      const body = {
        model: modelEl.value,
        stream: streamEl.checked,
        messages: [{ role: 'user', content: promptEl.value }],
      };

      const started = Date.now();
      try {
        const res = await fetch('/v1/chat/completions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...authHeaders() },
          body: JSON.stringify(body),
        });

        if (!streamEl.checked) {
          const json = await res.json();
          if (!res.ok) {
            outputEl.textContent = JSON.stringify(json, null, 2);
            statusEl.textContent = 'Error ' + res.status;
            return;
          }
          outputEl.textContent = json.choices?.[0]?.message?.content || JSON.stringify(json, null, 2);
          statusEl.textContent = 'Done in ' + (Date.now() - started) + 'ms';
          return;
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const parts = buffer.split('\\n\\n');
          buffer = parts.pop() || '';
          for (const part of parts) {
            for (const line of part.split('\\n')) {
              if (!line.startsWith('data: ')) continue;
              const payload = line.slice(6);
              if (payload === '[DONE]') continue;
              try {
                const chunk = JSON.parse(payload);
                const delta = chunk.choices?.[0]?.delta?.content;
                if (delta) outputEl.textContent += delta;
              } catch {}
            }
          }
        }
        statusEl.textContent = 'Stream finished in ' + (Date.now() - started) + 'ms';
      } catch (e) {
        statusEl.textContent = 'Request failed: ' + e.message;
      } finally {
        sendBtn.disabled = false;
      }
    }

    sendBtn.addEventListener('click', sendChat);
    loadModels();
  </script>
</body>
</html>`

/**
 * Handle GET /playground — lightweight chat test UI.
 */
export const handlePlayground = (
  req: IncomingMessage,
  res: ServerResponse,
  ctx: HandlerContext,
): void => {
  if (!authorize(req, ctx.config)) {
    sendError(res, 401, "Invalid bridge API key", "authentication_error")
    return
  }

  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" })
  res.end(PLAYGROUND_HTML)
}

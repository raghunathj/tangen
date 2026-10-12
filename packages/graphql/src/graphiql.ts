/**
 * File Name: graphiql.ts
 * Purpose: A self-contained GraphiQL-lite explorer for GET /graphql in dev.
 *          Deliberately dependency-free and CSP-safe: no external CDN, no
 *          remote fonts/scripts — just an inline editor that POSTs to the
 *          same endpoint and pretty-prints the result. Enough to explore
 *          the generated schema without shipping the full GraphiQL bundle.
 *
 * Author: Raghunath J
 * License: MIT
 */

/** Renders the explorer HTML pointed at `endpoint` (same-origin). */
export function graphiqlHTML(endpoint: string): string {
  const ep = endpoint.replace(/"/g, '&quot;')
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Tangen GraphQL</title>
<style>
  :root { color-scheme: light dark; }
  * { box-sizing: border-box; }
  body { margin: 0; font: 14px/1.5 ui-sans-serif, system-ui, sans-serif; background: #0f1115; color: #e6e6e6; }
  header { padding: 10px 16px; background: #171a21; border-bottom: 1px solid #2a2f3a; display: flex; align-items: center; gap: 12px; }
  header b { font-weight: 600; } header code { color: #8ab4f8; }
  main { display: grid; grid-template-columns: 1fr 1fr; gap: 1px; background: #2a2f3a; height: calc(100vh - 49px); }
  textarea, pre { margin: 0; padding: 14px; background: #12151b; color: #e6e6e6; border: 0; font: 13px/1.55 ui-monospace, SFMono-Regular, Menlo, monospace; width: 100%; height: 100%; resize: none; overflow: auto; }
  pre { white-space: pre-wrap; word-break: break-word; }
  .bar { position: absolute; top: 8px; right: 16px; }
  button { background: #3b82f6; color: #fff; border: 0; border-radius: 6px; padding: 6px 14px; font-weight: 600; cursor: pointer; }
  button:hover { background: #2563eb; }
</style>
</head>
<body>
<header>
  <b>Tangen GraphQL</b>
  <code id="ep"></code>
  <span style="flex:1"></span>
  <button id="run">Run ▶ <span style="opacity:.7;font-weight:400">(⌘⏎)</span></button>
</header>
<main>
  <textarea id="q" spellcheck="false" placeholder="Type a query…">{
  __schema { queryType { fields { name } } }
}</textarea>
  <pre id="out">Press Run to execute.</pre>
</main>
<script>
  var endpoint = "${ep}";
  document.getElementById('ep').textContent = endpoint;
  var q = document.getElementById('q'), out = document.getElementById('out');
  async function run() {
    out.textContent = '…';
    try {
      var res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ query: q.value })
      });
      var json = await res.json();
      out.textContent = JSON.stringify(json, null, 2);
    } catch (e) { out.textContent = 'Request failed: ' + e; }
  }
  document.getElementById('run').addEventListener('click', run);
  q.addEventListener('keydown', function (e) {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); run(); }
  });
</script>
</body>
</html>`
}

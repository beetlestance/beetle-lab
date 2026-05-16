import { mount, setBreadcrumbs } from "./shell.js";
import { icon } from "./icons.js";
import { escapeHtml } from "./api.js";

mount(async (page) => {
  setBreadcrumbs([{ label: "Integrations" }]);
  page.innerHTML = template();
  bindAccordions();
  bindCopy();
  bindCopySkill();
});

function template() {
  return `
    <div class="px-8 py-7 max-w-[1400px] mx-auto">
      <div class="flex items-end justify-between gap-6 mb-6 flex-wrap">
        <div>
          <h1 class="text-[22px] font-semibold tracking-tight">Integrations</h1>
          <p class="text-stone-500 dark:text-stone-400 text-[13px] mt-0.5">Drive k6-studio from scripts, CI, or AI agents. Everything is over plain HTTP and one WebSocket.</p>
        </div>
      </div>

      <section class="mb-8">
        ${aiPanel()}
      </section>

      <section class="mb-8">
        <div class="flex items-center gap-3 mb-3">
          <div class="w-1.5 h-6 bg-warm-500"></div>
          <h2 class="text-[18px] font-semibold tracking-tight">REST API</h2>
        </div>
        ${apiCards()}
      </section>

      <section class="mb-8">
        <div class="flex items-center gap-3 mb-3">
          <div class="w-1.5 h-6 bg-emerald-500"></div>
          <h2 class="text-[18px] font-semibold tracking-tight">WebSocket /ws</h2>
        </div>
        ${wsCard()}
      </section>

      <section class="mb-8">
        <div class="flex items-center gap-3 mb-3">
          <div class="w-1.5 h-6 bg-sky-500"></div>
          <h2 class="text-[18px] font-semibold tracking-tight">Quick recipes</h2>
        </div>
        ${recipes()}
      </section>
    </div>`;
}

function aiPanel() {
  return `
    <div class="border border-indigo-300/40 dark:border-indigo-800/40 bg-indigo-50/40 dark:bg-indigo-900/10 rounded-md p-5">
      <div class="flex items-start gap-4">
        <div class="w-10 h-10 grid place-items-center rounded bg-indigo-500/15 text-indigo-600 dark:text-indigo-400 shrink-0">
          ${icon("sparkles", { size: 20 })}
        </div>
        <div class="flex-1 min-w-0">
          <h3 class="text-[15px] font-semibold mb-1">AI agents · MCP / Claude</h3>
          <p class="text-[13px] text-stone-700 dark:text-stone-300 leading-relaxed mb-3">
            k6-studio ships a <strong>skill spec</strong> — a structured markdown document that tells an AI agent (Claude, Cursor, Continue, any MCP client) what every endpoint does, what the config shape is, and how to start, watch, and compare runs. Drop it into your agent's tool / skill folder and the agent can drive k6-studio for you.
          </p>
          <div class="flex flex-wrap items-center gap-2 mb-4">
            <a href="/integrations/k6-studio.skill.md" target="_blank" rel="noopener" download class="text-[12px] px-3 py-2 rounded border border-indigo-500 bg-indigo-500 text-white hover:bg-indigo-600 transition-colors flex items-center gap-2">
              ${icon("download", { size: 13 })}<span>Download skill (.md)</span>
            </a>
            <a href="/integrations/k6-studio.skill.md" target="_blank" rel="noopener" class="text-[12px] px-3 py-2 rounded border border-stone-200 dark:border-ink-800 hover:border-indigo-400 transition-colors flex items-center gap-2">
              ${icon("external", { size: 13 })}<span>View raw</span>
            </a>
            <button id="copySkill" class="text-[12px] px-3 py-2 rounded border border-stone-200 dark:border-ink-800 hover:border-indigo-400 transition-colors flex items-center gap-2">
              ${icon("copy", { size: 13 })}<span data-label>Copy contents</span>
            </button>
          </div>
          <div class="text-[12px] text-stone-600 dark:text-stone-400 leading-relaxed">
            <p class="mb-2"><strong>Drop-in suggestions:</strong></p>
            <ul class="list-disc pl-5 space-y-1">
              <li>Save as <code class="font-mono">~/.claude/skills/k6-studio.md</code> for Claude Code agents.</li>
              <li>Use the markdown directly as a system prompt for any tool-using LLM agent.</li>
              <li>Wrap the REST API in a thin MCP server (one tool per endpoint) and let the agent call it.</li>
            </ul>
          </div>
        </div>
      </div>
    </div>`;
}

function endpointBlock({ verb, path, body, response, notes }) {
  const verbColor = {
    GET: "text-sky-600 dark:text-sky-400",
    POST: "text-emerald-600 dark:text-emerald-400",
    PUT: "text-amber-600 dark:text-amber-400",
    DELETE: "text-rose-600 dark:text-rose-400",
    PATCH: "text-violet-600 dark:text-violet-400",
  }[verb] || "text-stone-500";
  return `
    <div class="border border-stone-200 dark:border-ink-800 rounded p-3 bg-stone-50/50 dark:bg-ink-800/20">
      <div class="flex items-center gap-3 mb-2 flex-wrap">
        <span class="font-mono text-[11px] font-bold ${verbColor}">${verb}</span>
        <code class="font-mono text-[12px]">${escapeHtml(path)}</code>
      </div>
      ${notes ? `<div class="text-[12px] text-stone-600 dark:text-stone-400 mb-2 leading-relaxed">${notes}</div>` : ""}
      ${body ? `<div class="text-[10px] uppercase tracking-wider text-stone-400 mt-2 mb-1">Body</div>${pre(body)}` : ""}
      ${response ? `<div class="text-[10px] uppercase tracking-wider text-stone-400 mt-2 mb-1">Response</div>${pre(response)}` : ""}
    </div>`;
}

function pre(code) {
  return `<div class="relative group">
    <pre class="font-mono text-[12px] leading-[1.55] bg-white dark:bg-ink-900 border border-stone-200 dark:border-ink-700 rounded px-3 py-2 overflow-x-auto whitespace-pre">${escapeHtml(code)}</pre>
    <button data-copy="${escapeHtml(code)}" class="opacity-0 group-hover:opacity-100 transition-opacity absolute top-1.5 right-1.5 text-[10px] px-2 py-0.5 rounded border border-stone-300 dark:border-ink-700 bg-white dark:bg-ink-900 text-stone-500 hover:text-ink-950 dark:hover:text-stone-50 flex items-center gap-1">${icon("copy", { size: 10 })}<span>copy</span></button>
  </div>`;
}

function card(title, hint, content, opts = {}) {
  const open = !!opts.open;
  return `
    <div data-card class="border border-stone-200 dark:border-ink-800 rounded-md bg-white dark:bg-ink-900 mb-3 overflow-hidden">
      <button data-accordion class="w-full px-4 h-11 flex items-center justify-between text-left hover:bg-stone-50 dark:hover:bg-ink-800/40 transition-colors">
        <div class="flex items-center gap-3">
          <span data-arrow class="inline-block transition-transform duration-200" style="transform:rotate(${open ? 90 : 0}deg)">${icon("chevron", { size: 12, className: "text-stone-400" })}</span>
          <h3 class="text-[13px] font-semibold">${escapeHtml(title)}</h3>
          ${hint ? `<span class="text-[11px] text-stone-500 dark:text-stone-400">${escapeHtml(hint)}</span>` : ""}
        </div>
      </button>
      <div data-expand class="expand${open ? " open" : ""}">
        <div class="expand-inner">
          <div class="px-4 py-3 border-t border-stone-100 dark:border-ink-800 space-y-2">${content}</div>
        </div>
      </div>
    </div>`;
}

function apiCards() {
  const buckets = [
    endpointBlock({ verb: "GET", path: "/api/folders", response: `[
  { "name": "ecs-content", "mtime": 1778133..., "fileCount": 7,
    "configs": [
      { "path": "config-constant.json", "mtime": ... },
      { "path": "config-rampup.json",   "mtime": ... }
    ]
  }
]` }),
    endpointBlock({ verb: "POST", path: "/api/folders", body: `{ "name": "ecs-content" }`, response: `{ "name": "ecs-content" }`, notes: "Creates an empty bucket. 409 if it already exists." }),
    endpointBlock({ verb: "DELETE", path: "/api/folders/:name", notes: "Deletes the bucket and ALL of its files and runs." }),
  ];
  const files = [
    endpointBlock({ verb: "POST", path: "/api/folders/:name/files", body: `{ "files": [
  { "path": "config.json",                    "content": "..." },
  { "path": "payload/heavy-post-payload.json", "content": "..." }
] }`, response: `{ "added": 2, "skipped": 0 }`, notes: "Merge upload — existing paths are overwritten, <code>runs/...</code> paths are silently skipped." }),
    endpointBlock({ verb: "GET", path: "/api/folders/:name/files/<rel>", notes: "Returns the file contents (JSON if it parses, else text)." }),
    endpointBlock({ verb: "DELETE", path: "/api/folders/:name/files/<rel>", notes: "Deletes a single file." }),
  ];
  const runs = [
    endpointBlock({ verb: "POST", path: "/api/runs", body: `{
  "folder": "ecs-content",
  "config": "config-constant.json",
  "target": "http://localhost:8080"
}`, response: `{
  "id":         "2026-05-07T...-abcd",
  "status":     "running",
  "bucket":     "ecs-content",
  "configRel":  "config-constant.json",
  "configDir":  "config-constant",
  "target":     "http://localhost:8080",
  "startedAt":  1778133...
}`, notes: "Starts a new run. <code>configDir</code> is the on-disk subdir name and what you pass to detail / delete URLs." }),
    endpointBlock({ verb: "POST", path: "/api/runs/:id/stop", notes: "Stops a running run; sends two SIGINTs (250ms apart) to skip k6 teardown / cooldown, then SIGKILL after 5s if needed." }),
    endpointBlock({ verb: "GET", path: "/api/runs", response: `[ { "id": "...", "status": "running", "bucket": "...", "configRel": "...", "configDir": "...", "target": "..." } ]`, notes: "List of <em>active</em> in-memory runs (resets on server restart)." }),
    endpointBlock({ verb: "GET", path: "/api/runs/:id", response: `{ ...snapshot, "ticks": [...], "logs": [...] }`, notes: "Live snapshot for in-memory runs (charts + recent logs)." }),
    endpointBlock({ verb: "GET", path: "/api/runs-history", notes: "Past runs (from disk). Optional <code>?folder=&lt;bucket&gt;</code> filter. Each row carries <code>{ bucket, configDir, configRel, status, startedAt, endedAt, stats, sizeBytes }</code>." }),
    endpointBlock({ verb: "GET", path: "/api/folders/:bucket/runs/:configDir/:id", response: `{
  "meta": {
    "id": "...",  "status": "completed | failed | stopped",
    "startedAt": ...,  "endedAt": ...,
    "exitCode": ...,  "error": ...,
    "target": "...",  "bucket": "...",
    "configRel":  "config.json",
    "configDir":  "config",
    "configHash": "sha256...",         // hash of the resolved config snapshot
    "orphaned":   true                  // present only when the run was
                                        // reaped at server boot (mid-run crash)
  },
  "summary":        { ...raw k6 summary... },
  "summaryTxt":     "...rendered text report...",
  "ticks":          [ { "t": ..., "rps": ..., "p50": ..., "p95": ..., "p99": ...,
                         "errors": ..., "vus": ..., "dropped": ...,
                         "memory": { "heapMB", "rssMB", "cpuPercent", "eldP99", "eldMax", "handles", ... } } ],
  "log":            "...",
  "hasMemory":      true,
  "configSnapshot": { ...resolved config (with .env substituted)... }
}`, notes: "Full historical detail. Reads <code>ticks.jsonl</code> from the run dir." }),
    endpointBlock({ verb: "GET", path: "/api/folders/:bucket/runs/:configDir/:id/eject.js", notes: "Self-contained k6 script with config + payloads inlined. Run with <code>k6 run &lt;file&gt;</code> outside the tool." }),
    endpointBlock({ verb: "DELETE", path: "/api/folders/:bucket/runs/:configDir/:id", notes: "Deletes a single run's directory." }),
  ];
  const reports = [
    endpointBlock({ verb: "GET", path: "/report/:bucket/:configDir/:id", notes: "Standalone HTML page with the full text report — shareable link." }),
    endpointBlock({ verb: "GET", path: "/integrations/k6-studio.skill.md", notes: "The AI agent skill spec (linked at the top of this page)." }),
  ];
  return `
    ${card("Buckets", "create / list / delete projects", buckets.join(""), { open: true })}
    ${card("Files", "merge-upload, read, delete files inside a bucket", files.join(""))}
    ${card("Runs", "start, stop, list, inspect", runs.join(""), { open: true })}
    ${card("Reports & resources", "shareable links", reports.join(""))}
  `;
}

function wsCard() {
  return `
    <div class="border border-stone-200 dark:border-ink-800 rounded-md p-4 bg-white dark:bg-ink-900">
      <p class="text-[13px] leading-[1.7] mb-3 text-stone-700 dark:text-stone-300">
        Connect with <code class="font-mono">ws://&lt;host&gt;:4567/ws?run=&lt;runId&gt;</code> after starting a run.
        On connect, the server replays prior tick history and recent log lines, then streams live events.
      </p>
      <div class="text-[10px] uppercase tracking-wider text-stone-400 mt-1 mb-1">Message types</div>
      ${pre(`{ "type": "hello",   "run":  { ...snapshot... } }              // sent first
{ "type": "tick",    "t": <ms>, "rps": ..., "p50": ..., "p95": ..., "p99": ..., "errors": ..., "vus": ...,
                     "dropped": ...,    // dropped_iterations this second; non-zero => VU pool undersized
                     "memory":  { "heapMB", "rssMB", "cpuPercent", "eldMean", "eldP99", "eldMax", "handles", ... } }
{ "type": "log",     "t": <ms>, "line": "..." }
{ "type": "status",  "status": "running" | "completed" | "failed" | "stopped",
                     "endedAt": ..., "exitCode": ..., "error": ... }
{ "type": "summary", "data":   { ...raw k6 summary... } }                   // emitted once after the run ends`)}
    </div>`;
}

function recipes() {
  const startCurl = `# Create bucket, upload config, start a run, watch live ticks
curl -s http://localhost:4567/api/folders -X POST \\
  -H 'Content-Type: application/json' \\
  -d '{"name":"smoke"}'

curl -s http://localhost:4567/api/folders/smoke/files -X POST \\
  -H 'Content-Type: application/json' \\
  -d @bundle.json     # { "files": [{"path":"config.json","content":"..."}] }

RUN=$(curl -s http://localhost:4567/api/runs -X POST \\
  -H 'Content-Type: application/json' \\
  -d '{"folder":"smoke","config":"config.json","target":"http://localhost:8080"}' \\
  | jq -r .id)

# Watch via websocket (e.g. websocat)
websocat "ws://localhost:4567/ws?run=$RUN"`;
  const compareCurl = `# Compare two runs of the same config from the CLI
A=2026-05-07T05-31-...-abcd
B=2026-05-07T06-12-...-efgh
for ID in "$A" "$B"; do
  curl -s "http://localhost:4567/api/folders/smoke/runs/config/$ID" \\
    | jq '{startedAt: .meta.startedAt,
           p95:  .summary.metrics.http_req_duration.values."p(95)",
           rps:  .summary.metrics.http_reqs.values.rate,
           heap: .summary.metrics.peak_heap_mb.values.value}'
done`;
  return `
    ${card("Start a run from the shell", null, pre(startCurl), { open: true })}
    ${card("Compare two runs from the shell", null, pre(compareCurl))}
  `;
}

function bindAccordions() {
  document.querySelectorAll("[data-accordion]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const card = btn.closest("[data-card]");
      const wrap = card?.querySelector("[data-expand]");
      if (!wrap) return;
      const willOpen = !wrap.classList.contains("open");
      wrap.classList.toggle("open", willOpen);
      const arrow = btn.querySelector("[data-arrow]");
      if (arrow) arrow.style.transform = willOpen ? "rotate(90deg)" : "rotate(0deg)";
    });
  });
}

function bindCopy() {
  document.addEventListener("click", async (e) => {
    const btn = e.target.closest("[data-copy]");
    if (!btn) return;
    e.preventDefault();
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(btn.dataset.copy);
      const span = btn.querySelector("span");
      const old = span ? span.textContent : null;
      if (span) span.textContent = "copied";
      setTimeout(() => { if (span && old) span.textContent = old; }, 1200);
    } catch {}
  });
}

function bindCopySkill() {
  const btn = document.getElementById("copySkill");
  if (!btn) return;
  btn.addEventListener("click", async () => {
    const label = btn.querySelector("[data-label]");
    try {
      const res = await fetch("/integrations/k6-studio.skill.md");
      const txt = await res.text();
      await navigator.clipboard.writeText(txt);
      const old = label.textContent;
      label.textContent = "copied to clipboard";
      setTimeout(() => (label.textContent = old), 1500);
    } catch {
      alert("Could not copy. Use the View raw link instead.");
    }
  });
}

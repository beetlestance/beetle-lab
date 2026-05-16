import { mount, setBreadcrumbs } from "./shell.js";
import { icon } from "./icons.js";
import { escapeHtml } from "./api.js";

mount(async (page) => {
  setBreadcrumbs([{ label: "Docs" }]);
  page.innerHTML = template();
  bindToc();
  bindAccordions();
});

function template() {
  return `
    <div class="px-8 py-7 max-w-[1400px] mx-auto">
      <div class="flex items-end justify-between gap-6 mb-6 flex-wrap">
        <div>
          <h1 class="text-[22px] font-semibold tracking-tight">Documentation</h1>
          <p class="text-stone-500 dark:text-stone-400 text-[13px] mt-0.5">What the tool does, how to write configs, and how to read every metric.</p>
        </div>
      </div>

      <div class="grid grid-cols-[220px_1fr] gap-8">
        <aside class="text-[13px] sticky top-4 self-start max-h-[calc(100vh-2rem)] overflow-auto">
          <div class="text-[10px] uppercase tracking-wider text-stone-400 mb-2 px-2">Contents</div>
          <nav id="toc" class="space-y-0.5">
            ${tocLinks().map(([id, label]) => `<a href="#${id}" data-toc="${id}" class="block px-2 py-1.5 rounded text-stone-600 dark:text-stone-400 hover:bg-stone-100 dark:hover:bg-ink-900 hover:text-ink-950 dark:hover:text-stone-50 transition-colors">${escapeHtml(label)}</a>`).join("")}
          </nav>
        </aside>

        <main class="min-w-0">
          ${concepts()}
          ${configRef()}
          ${metricsRef()}
          ${verdicts()}
          ${faq()}
        </main>
      </div>
    </div>`;
}

function tocLinks() {
  return [
    ["concepts", "Concepts"],
    ["config", "Config reference"],
    ["metrics", "Metrics reference"],
    ["verdicts", "How to read verdicts"],
    ["faq", "FAQ"],
  ];
}

function bindToc() {
  document.querySelectorAll("[data-toc]").forEach((a) =>
    a.addEventListener("click", () => {
      // Highlight on scroll-in.
      setTimeout(() => {
        document.querySelectorAll("[data-toc]").forEach((x) =>
          x.classList.remove("bg-indigo-500/10", "text-indigo-600", "dark:text-indigo-400"),
        );
        a.classList.add("bg-indigo-500/10", "text-indigo-600", "dark:text-indigo-400");
      }, 50);
    }),
  );
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

// ---------- Section helpers ----------
function section(id, title, body) {
  return `
    <section id="${id}" class="mb-10 scroll-mt-6">
      <div class="flex items-center gap-3 mb-3">
        <div class="w-1.5 h-6 bg-indigo-500"></div>
        <h2 class="text-[18px] font-semibold tracking-tight">${escapeHtml(title)}</h2>
      </div>
      <div class="prose-block">${body}</div>
    </section>`;
}

function card(title, hint, content, opts = {}) {
  const open = opts.open !== false;
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
          <div class="px-4 py-3 text-[13px] leading-[1.65] text-stone-700 dark:text-stone-300 border-t border-stone-100 dark:border-ink-800">${content}</div>
        </div>
      </div>
    </div>`;
}

function pre(code) {
  return `<pre class="font-mono text-[12px] leading-[1.55] bg-stone-100 dark:bg-ink-800/60 border border-stone-200 dark:border-ink-700 rounded px-3 py-2 overflow-x-auto whitespace-pre">${escapeHtml(code)}</pre>`;
}

function rowsTable(rows) {
  return `
    <div class="border border-stone-200 dark:border-ink-800 rounded overflow-hidden">
      <table class="w-full text-[12px]">
        <thead>
          <tr class="text-left text-[10px] uppercase tracking-wider text-stone-500 dark:text-stone-400 border-b border-stone-100 dark:border-ink-800">
            ${rows.headers.map((h) => `<th class="px-3 py-2 font-medium">${escapeHtml(h)}</th>`).join("")}
          </tr>
        </thead>
        <tbody>
          ${rows.body
            .map(
              (row) => `<tr class="border-b border-stone-100 dark:border-ink-800 last:border-b-0 align-top">
                ${row.map((c, i) => `<td class="px-3 py-2 ${i === 0 ? "font-mono text-[12px] text-stone-800 dark:text-stone-200 whitespace-nowrap" : "text-stone-700 dark:text-stone-300"}">${c}</td>`).join("")}
              </tr>`,
            )
            .join("")}
        </tbody>
      </table>
    </div>`;
}

// ---------- Sections ----------
function concepts() {
  return section(
    "concepts",
    "Concepts",
    `
    <div class="grid md:grid-cols-2 gap-3">
      <div class="border border-stone-200 dark:border-ink-800 rounded-md p-4 bg-white dark:bg-ink-900">
        <div class="text-[11px] uppercase tracking-wider text-indigo-500 mb-2 font-semibold">Bucket</div>
        <p class="text-[13px] text-stone-700 dark:text-stone-300 leading-relaxed">A named workspace for one project. Holds configs, payload files, and run history. On disk: <code class="font-mono text-[12px]">configs/&lt;bucket&gt;/</code>.</p>
      </div>
      <div class="border border-stone-200 dark:border-ink-800 rounded-md p-4 bg-white dark:bg-ink-900">
        <div class="text-[11px] uppercase tracking-wider text-indigo-500 mb-2 font-semibold">Config</div>
        <p class="text-[13px] text-stone-700 dark:text-stone-300 leading-relaxed">A JSON file with a non-empty <code class="font-mono text-[12px]">endpoints[]</code> array. A bucket can hold many configs (e.g. constant-rate vs ramp-up) sharing the same payload files.</p>
      </div>
      <div class="border border-stone-200 dark:border-ink-800 rounded-md p-4 bg-white dark:bg-ink-900">
        <div class="text-[11px] uppercase tracking-wider text-warm-500 mb-2 font-semibold">Run</div>
        <p class="text-[13px] text-stone-700 dark:text-stone-300 leading-relaxed">A single k6 execution of a config. Output (metrics, summary, log, config snapshot) lives at <code class="font-mono text-[12px]">configs/&lt;bucket&gt;/runs/&lt;configDir&gt;/&lt;runId&gt;/</code>.</p>
      </div>
      <div class="border border-stone-200 dark:border-ink-800 rounded-md p-4 bg-white dark:bg-ink-900">
        <div class="text-[11px] uppercase tracking-wider text-warm-500 mb-2 font-semibold">Snapshot</div>
        <p class="text-[13px] text-stone-700 dark:text-stone-300 leading-relaxed">When a run starts, the config is copied into the run dir and SHA-256-hashed. Compare uses the hash to flag if you're comparing apples to apples.</p>
      </div>
    </div>
    <div class="mt-5 text-[13px] leading-[1.7] text-stone-700 dark:text-stone-300">
      <p>A run goes through three phases:</p>
      <ol class="list-decimal pl-5 space-y-1 mt-2">
        <li><strong>Baseline sample</strong> — first memory/CPU sample, taken before load picks up.</li>
        <li><strong>Load</strong> — k6 drives the configured throughput against the target. Memory/CPU sampled every <code class="font-mono">memorySampling.intervalSeconds</code>.</li>
        <li><strong>Cooldown</strong> — k6 sits idle for <code class="font-mono">memorySampling.cooldownSeconds</code> (when configured) and takes a final sample. The cooldown vs baseline delta is the leak indicator.</li>
      </ol>
    </div>
  `,
  );
}

function configRef() {
  const topRows = {
    headers: ["Field", "Type", "Default", "Notes"],
    body: [
      ["executor", '<code>"constant-arrival-rate"</code> | <code>"ramping-vus"</code>', '"ramping-vus"', "Picks the k6 executor."],
      ["target", "string (URL)", "<code>http://localhost:8080</code>", "Default target. Overridable per run."],
      ["healthPath", "string (path)", "<em>none</em>", "If set, setup() polls until 200 before load."],
      ["tokens", "string[]", "[]", "Random token used to fill <code>${'{token}'}</code> in headers."],
      ["thresholds", "k6 thresholds object", "{}", "Optional. Without thresholds, exit code reflects only whether the test ran."],
      ["endpoints", "Endpoint[]", "<em>required</em>", "Non-empty list — see below."],
      ["memorySampling", "object", "<em>off</em>", "Enables Node.js runtime sampling — see below."],
    ],
  };
  const constantRows = {
    headers: ["Field", "Type", "Default", "Notes"],
    body: [
      ["rate", "number", "20", "Iterations per <code>timeUnit</code>."],
      ["timeUnit", "duration", '"1s"', "Time window for <code>rate</code>."],
      ["loadDuration", "duration", '"3m"', "How long to maintain the rate."],
      ["preAllocatedVUs", "number", "50", "Pre-allocated VU pool."],
      ["maxVUs", "number", "200", "Upper limit if k6 needs more."],
    ],
  };
  const rampRows = {
    headers: ["Field", "Type", "Default", "Notes"],
    body: [
      ["stages", "{duration, vus}[]", "<em>required</em>", "Sequential VU targets."],
    ],
  };
  const epRows = {
    headers: ["Field", "Type", "Notes"],
    body: [
      ["name", "string", "Unique label for the endpoint. Used in metrics (<code>ep_&lt;name&gt;_latency</code>) and reports."],
      ["method", "<code>GET</code> | <code>POST</code> | <code>PUT</code> | <code>DELETE</code> | <code>PATCH</code>", "Default <code>GET</code>."],
      ["path", "string", "URL path. Joined to <code>target</code>."],
      ["weight", "number", "How often this endpoint is hit relative to others. Higher = more often."],
      ["params", "object", "Query parameters. URL-encoded."],
      ["headers", "object", "HTTP headers. <code>${'{token}'}</code> is replaced with a random token from <code>tokens</code>."],
      ["body", "object", "Inline request body (POST/PUT/PATCH). Sent as JSON."],
      ["bodyFile", "string (path)", "Alternative to <code>body</code> — load from a file. Path is resolved against the config's directory."],
      ["checks", "object", "Validation: <code>{ status, statusNot5xx, status2xx, bodyContains }</code>."],
      ["waitMs", "{min, max}", "Optional random think-time between iterations of this endpoint."],
      ["maxIterations", "number", "Optional cap. Once reached, the endpoint drops out of the weighted pool."],
    ],
  };
  const memRows = {
    headers: ["Field", "Type", "Default", "Notes"],
    body: [
      ["enabled", "boolean", "false", "Turn on the memory sampler scenario and rich text report."],
      ["intervalSeconds", "number", "2", "How often the sampler polls the procstats endpoint."],
      ["endpoint", "string (path)", '"/debug/procstats"', "Where to fetch Node.js runtime stats."],
      ["cooldownSeconds", "number", "0", "Wait this long after load ends, then take a cooldown sample. Set to 180 (3min) for proper leak detection."],
    ],
  };
  return section(
    "config",
    "Config reference",
    `
    ${card("Top-level fields", null, rowsTable(topRows))}
    ${card("Executor: constant-arrival-rate", "Fixed throughput regardless of server speed", rowsTable(constantRows), { open: false })}
    ${card("Executor: ramping-arrival-rate", "Stage-based request-rate ramp — drive the arrival rate up/down regardless of server speed",
      rowsTable({
        headers: ["Field", "Type", "Default", "Notes"],
        body: [
          ["stages", "{duration, rate}[]", "<em>required</em>", "Each stage ramps to the given <code>rate</code> over <code>duration</code>."],
          ["startRate", "number", "0", "Starting request rate before the first stage."],
          ["timeUnit", "duration", '"1s"', "Time window for <code>rate</code> / <code>startRate</code>."],
          ["preAllocatedVUs", "number", "50", "Pre-allocated VU pool."],
          ["maxVUs", "number", "200", "Upper limit if k6 needs more."],
        ],
      }), { open: false })}
    ${card("Executor: ramping-vus", "Stage-based VU ramp; throughput depends on server speed", rowsTable(rampRows), { open: false })}
    ${card("Executor: shared-iterations / per-vu-iterations", "Fire N requests and exit — useful for warmup, smoke, fixed-budget probes",
      rowsTable({
        headers: ["Field", "Type", "Default", "Notes"],
        body: [
          ["iterations", "number", "100 (shared) / 10 (per-vu)", "Total (shared) or per-VU (per-vu) iterations."],
          ["vus", "number", "10", "VU pool size."],
          ["maxDuration", "duration", '"10m"', "Hard cap regardless of iteration count."],
        ],
      }), { open: false })}
    ${card("scenarios[]", "Stack multiple scenarios in one config — useful for background traffic + sharp bursts",
      `<p class="text-[13px] leading-[1.7] mb-2">When <code class="font-mono">scenarios[]</code> is present at the top level, it replaces the single-scenario fields. Each entry has its own <code>executor</code>, fields, and optional <code>startTime</code> (offset from run start). Scenarios run in parallel.</p>` +
      pre(`{
  "scenarios": [
    {
      "name":  "baseline",
      "executor": "constant-arrival-rate",
      "rate": 30, "timeUnit": "1s", "loadDuration": "5m",
      "preAllocatedVUs": 30, "maxVUs": 100
    },
    {
      "name":  "burst",
      "executor": "ramping-arrival-rate",
      "startTime": "1m",
      "preAllocatedVUs": 200, "maxVUs": 800,
      "stages": [
        { "duration": "10s", "rate": 1000 },
        { "duration": "30s", "rate": 1000 },
        { "duration": "10s", "rate": 0 }
      ]
    }
  ],
  "endpoints": [/* all endpoints are shared across scenarios */]
}`), { open: false })}
    ${card("Endpoint definition", null, rowsTable(epRows))}
    ${card("Per-VU data parameterization", "Named data sources — usable in params, headers, body",
      `<p class="text-[13px] leading-[1.7] mb-2">Declare data sources under <code>config.data</code>. Each source is loaded once and shared across VUs (memory-efficient via k6's SharedArray). Reference values in <code>params</code>, <code>headers</code>, <code>path</code>, or <code>body</code> using the template syntax.</p>` +
      pre(`{
  "data": {
    "users": { "file": "./users.csv", "key": "userId" },
    "refs":  { "range": [2000000, 2999999] },
    "tags":  { "values": ["foo", "bar", "baz"] }
  },
  "endpoints": [{
    "name": "get_user",
    "method": "GET",
    "path": "/v1/users/\${users.byVu().userId}",
    "params":  { "referenceId": "\${refs.random()}" },
    "headers": { "X-Tag": "\${tags.random()}" },
    "body":    { "actorId": "\${users.byVu().userId}" }
  }]
}`) +
      `<p class="text-[13px] leading-[1.7] mt-3 mb-1"><strong>Source shapes:</strong></p>` +
      rowsTable({
        headers: ["Shape", "Example", "Notes"],
        body: [
          ["<code>values</code>", `{ "values": ["a","b","c"] }`, "Inline array."],
          ["<code>file</code> (JSON)", `{ "file": "./users.json" }`, "JSON array, resolved relative to the config dir."],
          ["<code>file</code> (CSV)", `{ "file": "./users.csv" }`, "First row is headers; each row becomes an object keyed by header name."],
          ["<code>range</code>", `{ "range": [1, 1000] }`, "Inclusive integer range."],
        ],
      }) +
      `<p class="text-[13px] leading-[1.7] mt-3 mb-1"><strong>Modes:</strong></p>` +
      `<ul class="text-[13px] leading-[1.7] list-disc pl-5"><li><code>random()</code> — pick uniformly per request.</li><li><code>byVu()</code> — pick deterministically by VU id; that VU keeps the same value across all its iterations. Useful for "user N stays user N for the run".</li></ul>` +
      `<p class="text-[13px] leading-[1.7] mt-3"><code>\${source.mode().field}</code> picks a record (objects from CSV / JSON-of-objects) and reads a field. <code>\${source.mode()}</code> returns the raw value (for scalar arrays / ranges).</p>`,
      { open: false })}
    ${card("Memory sampling", "Node.js services with a /debug/procstats endpoint", rowsTable(memRows), { open: false })}
    ${card("Example: constant-arrival-rate with memory sampling", null, pre(`{
  "executor": "constant-arrival-rate",
  "rate": 30, "timeUnit": "1s", "loadDuration": "3m",
  "preAllocatedVUs": 15, "maxVUs": 60,
  "target": "http://localhost:8080",
  "healthPath": "/health",
  "memorySampling": {
    "enabled": true, "intervalSeconds": 2,
    "endpoint": "/content/debug/procstats",
    "cooldownSeconds": 180
  },
  "endpoints": [
    {
      "name": "get_content", "method": "GET", "path": "/v1/content/123",
      "weight": 100, "checks": { "status2xx": true }
    },
    {
      "name": "post_event", "method": "POST", "path": "/v1/events",
      "weight": 5, "bodyFile": "./payload/event.json",
      "checks": { "status2xx": true }
    }
  ]
}`), { open: false })}
  `,
  );
}

function metricsRef() {
  const httpRows = {
    headers: ["Metric", "Meaning", "What to watch for"],
    body: [
      ["http_reqs", "Total requests sent. Has <code>count</code> and <code>rate</code> (per-second).", "Compare across runs to verify the load was actually applied."],
      ["iterations", "Total iterations executed.", "Should track <code>http_reqs</code> closely (one request per iteration in this script)."],
      ["http_req_duration", "End-to-end request time (ms): <code>avg / med / p(90) / p(95) / p(99) / min / max</code>.", "p95/p99 are the canonical SLO indicators. Spikes in max often hide real problems behind a healthy average."],
      ["http_req_waiting", "Time spent waiting for the first byte (TTFB).", "If p95 grows but <code>http_req_receiving</code> doesn't, server is slow to start responding."],
      ["http_req_connecting / blocked / sending / receiving", "Phase breakdown.", "Usually noise. Spikes in <em>connecting</em> point at network or DNS."],
      ["http_req_failed", "Fraction of requests with non-2xx status.", "Should be 0% in a healthy run. Watch <code>rate</code>."],
      ["data_received / data_sent", "Bytes over the wire.", "Useful for sizing CDN / egress costs."],
      ["errors (custom)", "Count of failed checks (assertions on response).", "Different from <code>http_req_failed</code>: this counts <em>logical</em> failures (e.g. wrong body)."],
      ["checks", "Pass rate of all checks.", "A drop here means responses changed shape, even if status codes look fine."],
    ],
  };
  const memRows = {
    headers: ["Metric", "Meaning", "Symptom of"],
    body: [
      ["heap_inuse_bytes", "V8 heap currently used (bytes). Final value at end of load.", "<strong>Memory leak</strong> if it doesn't drop after cooldown. Compare to <code>baseline_heap_mb</code>."],
      ["peak_heap_mb", "High-water mark of the heap during load.", "Sets the realistic upper bound. If close to <code>heap_size_limit_mb</code> the process is at risk of OOM."],
      ["cooldown_heap_mb", "Heap measured <code>cooldownSeconds</code> after load ends.", "Closest indicator of a leak. Should drop close to baseline once GC has run."],
      ["heap_total_size_mb", "Total heap allocated to V8 (used + free).", "Grows when V8 needs more space. Sticky high values mean V8 isn't releasing back."],
      ["heap_size_limit_mb", "<code>--max-old-space-size</code> in MB.", "Hitting this kills the process. Common in Node 16/18 with default ~1.4 GB."],
      ["rss_bytes", "Resident Set Size — total physical memory the OS has handed to the process.", "Includes V8 heap + native + buffers + shared libs. Big delta vs heap = native / buffer leak."],
      ["external_bytes", "Memory tracked by V8 for C++ objects (Buffers, ArrayBuffers).", "If this grows monotonically you're piling up Buffers (file streams, image processing)."],
      ["cpp_heap_allocated_mb / cpp_heap_used_mb", "Newer V8 C++ heap accounting (Node 22+).", "Same shape as V8 heap but for native objects."],
    ],
  };
  const cpuRows = {
    headers: ["Metric", "Meaning", "Symptom of"],
    body: [
      ["cpu_percent", "Process CPU usage. 100% = one full core.", "Sustained &gt;80% on a single-core service caps your throughput; you've hit CPU."],
      ["system_cpu_percent", "Total system CPU usage.", "If process CPU is low but system is high, neighbours are hot."],
      ["peak_cpu_percent / avg_cpu_percent", "Run-wide CPU stats.", "Average is the steady-state cost. Peak shows worst-case spikes."],
      ["cooldown_cpu", "CPU after the load + cooldown wait.", "Should drop near baseline. If not, the process is doing background work it shouldn't."],
    ],
  };
  const eldRows = {
    headers: ["Metric", "Meaning", "Symptom of"],
    body: [
      ["event_loop_delay_mean_ms", "Average wait time for an event-loop tick.", "&gt;5ms is concerning, &gt;20ms means the JS thread is regularly busy."],
      ["event_loop_delay_p99_ms", "99th-percentile wait.", "&gt;100ms means user requests are stalling behind blocking work (sync I/O, big JSON.parse, regex)."],
      ["event_loop_delay_max_ms", "Single worst tick wait.", "Useful as a fingerprint — e.g. matches the time a sync export ran."],
    ],
  };
  const gcRows = {
    headers: ["Metric", "Meaning", "Symptom of"],
    body: [
      ["gc_count", "Number of GC pauses during the run.", "Hundreds is fine. Low thousands on a short test = high allocation churn."],
      ["gc_total_ms", "Total time spent in GC.", "Divide by run duration: &gt;5% means GC pressure is hurting latency."],
      ["gc_max_ms", "Longest single GC pause.", "&gt;100ms causes user-visible lag. Often points at a large old-gen collection."],
      ["gc_avg_ms", "Average pause length.", "Useful when comparing builds — should stay flat across runs."],
    ],
  };
  const handleRows = {
    headers: ["Metric", "Meaning", "Symptom of"],
    body: [
      ["active_handles", "Number of libuv handles open (sockets, timers, file watchers).", "Compare baseline / final / cooldown. Monotonic growth = unclosed connections, lingering timers, EventEmitter leaks."],
      ["active_requests", "Pending libuv requests (in-flight syscalls).", "If high during cooldown, something hasn't unwound."],
      ["uv_threadpool_size", "<code>UV_THREADPOOL_SIZE</code> setting.", "Bottleneck for sync work (crypto, fs, dns lookup). Default 4 — bump for fs-heavy workloads."],
    ],
  };
  return section(
    "metrics",
    "Metrics reference",
    `
    ${card("HTTP & throughput", "k6 built-ins", rowsTable(httpRows))}
    ${card("Memory · V8 heap and RSS", "Only with memorySampling.enabled", rowsTable(memRows), { open: false })}
    ${card("CPU", "Only with memorySampling.enabled", rowsTable(cpuRows), { open: false })}
    ${card("Event loop delay", "Only with memorySampling.enabled", rowsTable(eldRows), { open: false })}
    ${card("Garbage collection", "Only with memorySampling.enabled", rowsTable(gcRows), { open: false })}
    ${card("libuv handles & threadpool", null, rowsTable(handleRows), { open: false })}
  `,
  );
}

function verdicts() {
  return section(
    "verdicts",
    "How to read verdicts",
    `
    <p class="text-[13px] leading-[1.7] mb-3 text-stone-700 dark:text-stone-300">
      The performance report on each run page emits short verdict lines.
      Color tells you severity at a glance:
    </p>
    <div class="grid sm:grid-cols-2 gap-3">
      <div class="border border-emerald-300/60 dark:border-emerald-800/40 bg-emerald-50/40 dark:bg-emerald-900/10 rounded p-3 text-[12px] text-emerald-700 dark:text-emerald-300">
        <div class="font-semibold mb-1">[OK] · all good</div>
        Heap returned to baseline, peak CPU acceptable, GC pauses short.
      </div>
      <div class="border border-amber-300/60 dark:border-amber-800/40 bg-amber-50/40 dark:bg-amber-900/10 rounded p-3 text-[12px] text-amber-700 dark:text-amber-300">
        <div class="font-semibold mb-1">[~] · monitor</div>
        Modest growth or moderate pressure. Track across multiple runs before declaring a regression.
      </div>
      <div class="border border-rose-300/60 dark:border-rose-800/40 bg-rose-50/40 dark:bg-rose-900/10 rounded p-3 text-[12px] text-rose-700 dark:text-rose-300">
        <div class="font-semibold mb-1">[!] · investigate</div>
        Likely leak / blocking work / OOM risk. Take a heap snapshot or flame chart and look.
      </div>
      <div class="border border-sky-300/60 dark:border-sky-800/40 bg-sky-50/40 dark:bg-sky-900/10 rounded p-3 text-[12px] text-sky-700 dark:text-sky-300">
        <div class="font-semibold mb-1">[i] · informational</div>
        Worth noting but not necessarily a problem.
      </div>
    </div>
  `,
  );
}

function faq() {
  const items = [
    [
      "Why does my run take loadDuration + cooldownSeconds, not just loadDuration?",
      "Because we sample memory after the load to detect leaks. Each k6 scenario also has a small <code>gracefulStop</code> (1s here) to let in-flight iterations finish. Total wall time = loadDuration + cooldownSeconds + a few seconds.",
    ],
    [
      "Can I use this for a Go / Java / Python service?",
      "Yes. Set <code>memorySampling.enabled: false</code> (or omit it). The HTTP load metrics still work fully. Memory / CPU / event-loop charts are Node.js-specific because they require a <code>/debug/procstats</code>-shape endpoint.",
    ],
    [
      "What does the procstats endpoint need to return?",
      `JSON with at least these keys: <code>heapInuse</code>, <code>rss</code>, <code>activeHandles</code> (or <code>goroutines</code>), <code>cpuPercent</code>, <code>uvThreadpoolSize</code>, plus optional <code>eventLoopDelay { mean, p90, p99, max }</code>, <code>gc { count, totalMs, avgMs, maxMs }</code>, <code>cppHeap { allocated_size, used_size }</code>, <code>heapSizeLimit</code>, <code>totalHeapSize</code>, <code>external</code>. Any missing field is silently skipped.`,
    ],
    [
      "Why is one of my historical runs marked 'failed' with no exitCode?",
      "Because the server was killed mid-run. On boot the server scans for runs with status='running' (impossible if it really were running, since it wasn't there) and marks them failed with the message <em>server stopped before run finished</em>.",
    ],
    [
      "What's the difference between 'http_req_failed' and 'errors'?",
      "<code>http_req_failed</code> is k6's built-in: any non-2xx counts. <code>errors</code> is custom: it's incremented when any of your endpoint's <code>checks</code> fails. A 200 with the wrong body shape would only count toward <code>errors</code>.",
    ],
    [
      "Can I share a run with a colleague?",
      "Yes — open <code>/report/&lt;bucket&gt;/&lt;configDir&gt;/&lt;id&gt;</code> for a standalone HTML page, or use the Export menu on the run detail page to download <code>.txt</code> / <code>.json</code> / <code>.csv</code>.",
    ],
    [
      "Two runs of the same config are showing wildly different stats. Where do I look first?",
      "On the compare page, the banner at the top tells you whether the configs match. If amber, click <em>View diff</em> — the configs themselves changed. If green, the diff is in the system or the target.",
    ],
    [
      "Where do I edit hooks / settings?",
      "All bucket data (configs, payloads, runs) is per-machine under <code>configs/</code>. The k6 driver script is <code>loadtest.js</code> in the repo root. Don't put <code>configs/*</code> in source control — it's machine-specific.",
    ],
  ];
  return section(
    "faq",
    "FAQ",
    items.map(([q, a]) => card(q, null, `<div class="text-[13px] leading-[1.7]">${a}</div>`, { open: false })).join(""),
  );
}

import { mount, setBreadcrumbs } from "./shell.js";
import { api, escapeHtml, fmtSeconds, fmtRelTime } from "./api.js";
import { icon } from "./icons.js";
import { makeLineChart, setAxisMax } from "./charts.js";

// URL: /compare/:bucket/:configDir?a=ID&b=ID[&c=ID...]
const m = location.pathname.match(/^\/compare\/([^/]+)\/([^/]+)$/);
if (!m) {
  document.getElementById("page-content").textContent = "Invalid compare URL.";
  throw new Error("invalid");
}
const bucket = decodeURIComponent(m[1]);
const configDir = decodeURIComponent(m[2]);
const params = new URLSearchParams(location.search);
const ids = ["a", "b", "c", "d"]
  .map((k) => params.get(k))
  .filter(Boolean);

// Run colors — kept distinct so overlaid charts read clearly. Colors borrowed
// from the design system (indigo / orange / teal / rose) for max separation.
const RUN_COLORS = ["#6366f1", "#f97316", "#10b981", "#ef4444"];

const charts = {};
const memCharts = {};

mount(async (page) => {
  setBreadcrumbs([
    { label: "Runs", href: "/runs" },
    { label: `${bucket} / ${configDir}`, href: `/bucket/${encodeURIComponent(bucket)}` },
    { label: "Compare" },
  ]);
  page.innerHTML = template();
  bindActions();

  if (ids.length < 2) {
    document.getElementById("body").innerHTML = `
      <div class="empty-state">
        <div class="text-[14px] font-medium">Pick at least two runs to compare</div>
        <a href="/bucket/${encodeURIComponent(bucket)}" class="text-[12px] text-indigo-500 hover:text-indigo-400">Go back to bucket</a>
      </div>`;
    return;
  }

  // Fetch all runs in parallel.
  const details = await Promise.all(
    ids.map((id) =>
      api
        .runDetail(bucket, configDir, id)
        .then((d) => ({ id, ...d }))
        .catch(() => null),
    ),
  );
  const ok = details.filter(Boolean);
  if (ok.length < 2) {
    document.getElementById("body").innerHTML = `
      <div class="empty-state text-stone-500 text-[13px]">Could not load enough runs to compare.</div>`;
    return;
  }

  renderHeader(ok);
  renderStatsTable(ok);
  initCharts();
  renderCharts(ok);

  return () => {
    for (const c of Object.values(charts)) {
      try { c.destroy(); } catch {}
    }
    for (const c of Object.values(memCharts)) {
      try { c.destroy(); } catch {}
    }
  };
});

function template() {
  return `
    <div class="px-8 py-7 max-w-[1400px] mx-auto">
      <div class="flex items-end justify-between gap-6 mb-6 flex-wrap">
        <div class="min-w-0">
          <div class="text-[11px] uppercase tracking-wider text-stone-400 num">${escapeHtml(bucket)} / ${escapeHtml(configDir)}</div>
          <h1 class="text-[22px] font-semibold tracking-tight mt-1">Comparing ${ids.length} runs</h1>
          <p id="metaSub" class="text-[12px] text-stone-500 dark:text-stone-400 mt-1">—</p>
        </div>
        <a href="/bucket/${encodeURIComponent(bucket)}" class="text-[12px] px-3 py-2 rounded border border-stone-200 dark:border-ink-800 hover:border-indigo-400 transition-colors flex items-center gap-2">
          ${icon("back", { size: 13 })}<span>Back to bucket</span>
        </a>
      </div>

      <div id="body">
        <section id="legend" class="mb-5"></section>
        <section id="statsTable" class="mb-6"></section>

        <section class="border border-stone-200 dark:border-ink-800 rounded-md bg-white dark:bg-ink-900 mb-5">
          <header class="px-5 h-11 flex items-center border-b border-stone-100 dark:border-ink-800">
            <h2 class="text-[12px] uppercase tracking-wider text-stone-500 dark:text-stone-400 font-semibold">HTTP &amp; VUs</h2>
          </header>
          <div class="grid md:grid-cols-2 gap-px bg-stone-100 dark:bg-ink-800">
            <div class="bg-white dark:bg-ink-900 p-4">
              <div class="text-[10px] uppercase tracking-wider text-stone-400 mb-2">Requests / sec</div>
              <div class="h-[200px]"><canvas id="cRps"></canvas></div>
            </div>
            <div class="bg-white dark:bg-ink-900 p-4">
              <div class="text-[10px] uppercase tracking-wider text-stone-400 mb-2">Latency p95 (ms)</div>
              <div class="h-[200px]"><canvas id="cP95"></canvas></div>
            </div>
            <div class="bg-white dark:bg-ink-900 p-4">
              <div class="text-[10px] uppercase tracking-wider text-stone-400 mb-2">Errors / sec</div>
              <div class="h-[200px]"><canvas id="cErr"></canvas></div>
            </div>
            <div class="bg-white dark:bg-ink-900 p-4">
              <div class="text-[10px] uppercase tracking-wider text-stone-400 mb-2">Active VUs</div>
              <div class="h-[200px]"><canvas id="cVus"></canvas></div>
            </div>
          </div>
        </section>

        <section id="memSection" class="border border-stone-200 dark:border-ink-800 rounded-md bg-white dark:bg-ink-900 mb-5" hidden>
          <header class="px-5 h-11 flex items-center border-b border-stone-100 dark:border-ink-800">
            <h2 class="text-[12px] uppercase tracking-wider text-stone-500 dark:text-stone-400 font-semibold">Runtime · memory &amp; CPU</h2>
          </header>
          <div class="grid md:grid-cols-2 gap-px bg-stone-100 dark:bg-ink-800">
            <div class="bg-white dark:bg-ink-900 p-4">
              <div class="text-[10px] uppercase tracking-wider text-stone-400 mb-2">Heap (MB)</div>
              <div class="h-[200px]"><canvas id="cHeap"></canvas></div>
            </div>
            <div class="bg-white dark:bg-ink-900 p-4">
              <div class="text-[10px] uppercase tracking-wider text-stone-400 mb-2">CPU %</div>
              <div class="h-[200px]"><canvas id="cCpu"></canvas></div>
            </div>
            <div class="bg-white dark:bg-ink-900 p-4">
              <div class="text-[10px] uppercase tracking-wider text-stone-400 mb-2">Event loop p99 (ms)</div>
              <div class="h-[200px]"><canvas id="cEld"></canvas></div>
            </div>
            <div class="bg-white dark:bg-ink-900 p-4">
              <div class="text-[10px] uppercase tracking-wider text-stone-400 mb-2">Active handles</div>
              <div class="h-[200px]"><canvas id="cHnd"></canvas></div>
            </div>
          </div>
        </section>
      </div>
    </div>`;
}

function bindActions() {}

function runColor(i) {
  return RUN_COLORS[i % RUN_COLORS.length];
}

function runLabel(d, i) {
  const dt = d.meta?.startedAt ? new Date(d.meta.startedAt).toLocaleString() : d.id;
  return `${String.fromCharCode(65 + i)} · ${dt}`;
}

function renderHeader(details) {
  document.getElementById("metaSub").textContent =
    details
      .map((d, i) => `${String.fromCharCode(65 + i)}: ${fmtRelTime(d.meta?.startedAt)}`)
      .join("  ·  ");
}

function legend(details) {
  return details
    .map(
      (d, i) =>
        `<span class="inline-flex items-center gap-2 text-[12px] mr-4">
          <span class="inline-block w-3 h-3 rounded-sm" style="background:${runColor(i)}"></span>
          <span class="font-medium">${String.fromCharCode(65 + i)}</span>
          <span class="text-stone-500 dark:text-stone-400">${escapeHtml(new Date(d.meta?.startedAt || 0).toLocaleString())}</span>
        </span>`,
    )
    .join("");
}

function extractStats(detail) {
  const m = detail.summary?.metrics || {};
  const meta = detail.meta || {};
  return {
    duration:
      meta.startedAt && meta.endedAt ? (meta.endedAt - meta.startedAt) / 1000 : null,
    requests: m.http_reqs?.values?.count ?? null,
    rps: m.http_reqs?.values?.rate ?? null,
    p50: m.http_req_duration?.values?.med ?? null,
    p95: m.http_req_duration?.values?.["p(95)"] ?? null,
    p99: m.http_req_duration?.values?.["p(99)"] ?? null,
    errors: m.errors?.values?.count ?? null,
    failedRate: m.http_req_failed?.values?.rate ?? null,
    peakHeap: m.peak_heap_mb?.values?.value ?? null,
    peakRss: m.peak_rss_mb?.values?.value ?? null,
    peakCpu: m.peak_cpu_percent?.values?.value ?? null,
    avgCpu: m.avg_cpu_percent?.values?.avg ?? null,
    cooldownHeap: m.cooldown_heap_mb?.values?.value ?? null,
    eldP99: m.event_loop_delay_p99_ms?.values?.value ?? null,
    gcMax: m.gc_max_ms?.values?.value ?? null,
  };
}

function renderStatsTable(details) {
  document.getElementById("legend").innerHTML = legend(details);

  const stats = details.map(extractStats);
  // Table rows: name, format, lowerBetter (for delta coloring)
  const ROWS = [
    ["Duration", "duration", "s", false],
    ["Requests", "requests", "n", false],
    ["RPS", "rps", "f1", false],
    ["p50 (ms)", "p50", "f1", true],
    ["p95 (ms)", "p95", "f1", true],
    ["p99 (ms)", "p99", "f1", true],
    ["Errors", "errors", "n", true],
    ["Peak heap (MB)", "peakHeap", "f1", true],
    ["Peak RSS (MB)", "peakRss", "f1", true],
    ["Peak CPU %", "peakCpu", "f1", true],
    ["Avg CPU %", "avgCpu", "f1", true],
    ["Cooldown heap (MB)", "cooldownHeap", "f1", true],
    ["Event loop p99 (ms)", "eldP99", "f1", true],
    ["GC max (ms)", "gcMax", "f1", true],
  ];

  const fmt = (k, v) => {
    if (v === null || v === undefined) return "—";
    if (k === "s") return fmtSeconds(v);
    if (k === "f1") return Number(v).toFixed(1);
    if (k === "n") return Number(v).toLocaleString();
    return String(v);
  };

  const colorDelta = (delta, lowerBetter) => {
    if (delta === null || delta === undefined || !isFinite(delta) || delta === 0)
      return "text-stone-500";
    const better = lowerBetter ? delta < 0 : delta > 0;
    return better ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400";
  };

  const baselineIdx = 0;
  const rows = ROWS.filter((r) => stats.some((s) => s[r[1]] !== null))
    .map(([label, key, fmtKind, lowerBetter]) => {
      const baseV = stats[baselineIdx][key];
      const cells = stats
        .map((s, i) => {
          const v = s[key];
          let deltaCell = "";
          if (i > 0 && baseV !== null && v !== null) {
            const d = v - baseV;
            const pct = baseV !== 0 ? (d / baseV) * 100 : null;
            const arrow = d > 0 ? "▲" : d < 0 ? "▼" : "";
            const cls = colorDelta(d, lowerBetter);
            const pctStr = pct !== null ? `${pct >= 0 ? "+" : ""}${pct.toFixed(1)}%` : "";
            deltaCell = `<div class="text-[10px] num ${cls} mt-0.5">${arrow} ${pctStr}</div>`;
          }
          return `<td class="px-4 py-2.5 num text-right align-top">
            <div class="${i === baselineIdx ? "font-medium" : ""}">${fmt(fmtKind, v)}</div>
            ${deltaCell}
          </td>`;
        })
        .join("");
      return `<tr class="border-b border-stone-100 dark:border-ink-800">
        <th class="text-left px-4 py-2.5 text-[12px] font-medium text-stone-700 dark:text-stone-300">${escapeHtml(label)}</th>
        ${cells}
      </tr>`;
    })
    .join("");

  const headerCells = stats
    .map(
      (_, i) =>
        `<th class="px-4 py-2 text-right">
          <span class="inline-flex items-center gap-2">
            <span class="inline-block w-2.5 h-2.5 rounded-sm" style="background:${runColor(i)}"></span>
            ${String.fromCharCode(65 + i)}${i === 0 ? '<span class="text-[10px] text-stone-400 ml-1">(baseline)</span>' : ""}
          </span>
        </th>`,
    )
    .join("");

  document.getElementById("statsTable").innerHTML = `
    <div class="border border-stone-200 dark:border-ink-800 rounded-md bg-white dark:bg-ink-900 overflow-hidden">
      <table class="w-full text-[12px]">
        <thead>
          <tr class="text-[10px] uppercase tracking-wider text-stone-500 dark:text-stone-400 border-b border-stone-100 dark:border-ink-800">
            <th class="text-left px-4 py-2 font-medium">Metric</th>
            ${headerCells}
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
}

function initCharts() {
  charts.rps = makeLineChart("cRps", []);
  charts.p95 = makeLineChart("cP95", []);
  charts.err = makeLineChart("cErr", []);
  charts.vus = makeLineChart("cVus", []);
  memCharts.heap = makeLineChart("cHeap", []);
  memCharts.cpu = makeLineChart("cCpu", []);
  memCharts.eld = makeLineChart("cEld", []);
  memCharts.hnd = makeLineChart("cHnd", []);
}

function renderCharts(details) {
  const xMax = Math.max(
    ...details.map((d) => {
      const t = d.ticks || [];
      return t.length ? Math.ceil((t[t.length - 1].t - t[0].t) / 1000) + 1 : 0;
    }),
    1,
  );
  setAxisMax(charts, xMax);
  setAxisMax(memCharts, xMax);

  const buildSets = (key, accessor) =>
    details.map((d, i) => {
      const ticks = d.ticks || [];
      if (ticks.length === 0) return null;
      const t0 = ticks[0].t;
      const data = [];
      for (const tk of ticks) {
        const x = (tk.t - t0) / 1000;
        const y = accessor(tk);
        if (y !== undefined && y !== null) data.push({ x, y });
      }
      return {
        label: String.fromCharCode(65 + i),
        data,
        borderColor: runColor(i),
        backgroundColor: runColor(i) + "26", // ~15% alpha
      };
    }).filter(Boolean);

  charts.rps.data.datasets = buildSets("rps", (t) => t.rps);
  charts.p95.data.datasets = buildSets("p95", (t) => Math.round(t.p95));
  charts.err.data.datasets = buildSets("errors", (t) => t.errors);
  charts.vus.data.datasets = buildSets("vus", (t) => t.vus);

  // Memory section — show only if any run has memory data.
  const heapSets = buildSets("heap", (t) => t.memory?.heapMB);
  const hasMem = heapSets.some((s) => s.data.length > 0);
  document.getElementById("memSection").hidden = !hasMem;
  if (hasMem) {
    memCharts.heap.data.datasets = heapSets;
    memCharts.cpu.data.datasets = buildSets("cpu", (t) => t.memory?.cpuPercent);
    memCharts.eld.data.datasets = buildSets("eld", (t) => t.memory?.eldP99);
    memCharts.hnd.data.datasets = buildSets("hnd", (t) => t.memory?.handles);
  }

  for (const c of Object.values(charts)) c.update();
  for (const c of Object.values(memCharts)) c.update();
}

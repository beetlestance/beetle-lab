import { mount, setBreadcrumbs } from "./shell.js";
import { api, escapeHtml, fmtRelTime, fmtSeconds, totalDurationSec, reportUrl } from "./api.js";
import { icon } from "./icons.js";
import { makeLineChart, setAxisMax } from "./charts.js";

// URL: /run/:bucket/:configDir/:id
const m = location.pathname.match(/^\/run\/([^/]+)\/([^/]+)\/([^/]+)$/);
if (!m) {
  document.getElementById("page-content").textContent = "Invalid run URL.";
  throw new Error("invalid url");
}
const bucket = decodeURIComponent(m[1]);
const configDir = decodeURIComponent(m[2]);
const runId = decodeURIComponent(m[3]);

let charts = {};
let memCharts = {};
let chartsInited = false;
let runStartT = null;
let runDurationSec = null;
let ws = null;
let isLive = false;
const series = makeSeries();
const memSeries = makeMemSeries();

mount(async (page) => {
  setBreadcrumbs([
    { label: "Runs", href: "/runs" },
    { label: `${bucket} / ${configDir}` },
  ]);
  page.innerHTML = template();

  bindActions();

  // Decide: live (in-memory) vs replay (from disk)?
  let live = null;
  try {
    const all = await api.liveRuns();
    live = all.find((r) => r.id === runId && r.status === "running");
  } catch {}

  if (live) {
    await initLive(live);
  } else {
    await initReplay();
  }

  // Cleanup on navigation away — close any live WebSocket and destroy charts
  // so we don't leak memory across page swaps.
  return () => {
    if (ws) {
      try { ws.close(); } catch {}
      ws = null;
    }
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
      <div class="flex items-start justify-between gap-6 mb-6 flex-wrap">
        <div class="min-w-0">
          <div class="text-[11px] uppercase tracking-wider text-stone-400 flex items-center gap-1.5 num">
            <a href="/bucket/${encodeURIComponent(bucket)}" class="hover:text-indigo-500 transition-colors">${escapeHtml(bucket)}</a>
            <span class="text-stone-300 dark:text-ink-700">/</span>
            <span>${escapeHtml(configDir)}</span>
          </div>
          <h1 id="runTitle" class="text-[20px] font-semibold tracking-tight mt-1 truncate font-mono">${escapeHtml(runId)}</h1>
          <div id="runMeta" class="text-[12px] text-stone-500 dark:text-stone-400 num mt-1">—</div>
        </div>
        <div class="flex items-center gap-2 shrink-0">
          <span id="runStatus" class="tag bg-stone-500/10 text-stone-500">…</span>
          <a id="reportLink" href="#" target="_blank" rel="noopener" class="hidden text-[12px] px-3 py-2 rounded border border-stone-200 dark:border-ink-800 hover:border-indigo-400 transition-colors flex items-center gap-2">
            ${icon("external", { size: 13 })}<span>Full report</span>
          </a>
          <button id="stopBtn" class="hidden text-[12px] px-3 py-2 rounded border border-rose-500 bg-rose-500 text-white hover:bg-rose-600 transition-colors flex items-center gap-2">
            ${icon("square", { size: 12 })}<span>Stop</span>
          </button>
        </div>
      </div>

      <div id="stats" class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 mb-6"></div>

      <section class="border border-stone-200 dark:border-ink-800 rounded-md bg-white dark:bg-ink-900 mb-5">
        <header class="px-5 h-11 flex items-center border-b border-stone-100 dark:border-ink-800">
          <h2 class="text-[12px] uppercase tracking-wider text-stone-500 dark:text-stone-400 font-semibold">HTTP & VUs</h2>
        </header>
        <div class="grid md:grid-cols-2 gap-px bg-stone-100 dark:bg-ink-800">
          <div class="bg-white dark:bg-ink-900 p-4">
            <div class="text-[10px] uppercase tracking-wider text-stone-400 mb-2">Requests / sec</div>
            <div class="h-[180px]"><canvas id="cRps"></canvas></div>
          </div>
          <div class="bg-white dark:bg-ink-900 p-4">
            <div class="text-[10px] uppercase tracking-wider text-stone-400 mb-2">Latency (ms)</div>
            <div class="h-[180px]"><canvas id="cLat"></canvas></div>
          </div>
          <div class="bg-white dark:bg-ink-900 p-4">
            <div class="text-[10px] uppercase tracking-wider text-stone-400 mb-2">Errors / sec</div>
            <div class="h-[180px]"><canvas id="cErr"></canvas></div>
          </div>
          <div class="bg-white dark:bg-ink-900 p-4">
            <div class="text-[10px] uppercase tracking-wider text-stone-400 mb-2">Active VUs</div>
            <div class="h-[180px]"><canvas id="cVus"></canvas></div>
          </div>
        </div>
      </section>

      <section id="memSection" class="border border-stone-200 dark:border-ink-800 rounded-md bg-white dark:bg-ink-900 mb-5" hidden>
        <header class="px-5 h-11 flex items-center border-b border-stone-100 dark:border-ink-800">
          <h2 class="text-[12px] uppercase tracking-wider text-stone-500 dark:text-stone-400 font-semibold">Runtime · memory & CPU</h2>
        </header>
        <div class="grid md:grid-cols-2 gap-px bg-stone-100 dark:bg-ink-800">
          <div class="bg-white dark:bg-ink-900 p-4">
            <div class="text-[10px] uppercase tracking-wider text-stone-400 mb-2">Heap / RSS (MB)</div>
            <div class="h-[180px]"><canvas id="cHeap"></canvas></div>
          </div>
          <div class="bg-white dark:bg-ink-900 p-4">
            <div class="text-[10px] uppercase tracking-wider text-stone-400 mb-2">CPU %</div>
            <div class="h-[180px]"><canvas id="cCpu"></canvas></div>
          </div>
          <div class="bg-white dark:bg-ink-900 p-4">
            <div class="text-[10px] uppercase tracking-wider text-stone-400 mb-2">Event loop delay (ms)</div>
            <div class="h-[180px]"><canvas id="cEld"></canvas></div>
          </div>
          <div class="bg-white dark:bg-ink-900 p-4">
            <div class="text-[10px] uppercase tracking-wider text-stone-400 mb-2">Active handles</div>
            <div class="h-[180px]"><canvas id="cHnd"></canvas></div>
          </div>
        </div>
      </section>

      <section class="border border-stone-200 dark:border-ink-800 rounded-md bg-white dark:bg-ink-900">
        <header class="px-5 h-11 flex items-center justify-between border-b border-stone-100 dark:border-ink-800">
          <h2 class="text-[12px] uppercase tracking-wider text-stone-500 dark:text-stone-400 font-semibold">Logs</h2>
          <button id="clearLogs" class="text-[11px] text-stone-500 hover:text-ink-950 dark:hover:text-stone-100">clear</button>
        </header>
        <pre id="logs" class="logs px-5 py-3 max-h-[280px] overflow-y-auto"></pre>
      </section>
    </div>`;
}

function bindActions() {
  document.getElementById("stopBtn").addEventListener("click", async () => {
    if (!confirm("Stop this run?")) return;
    try {
      await api.stopRun(runId);
    } catch (e) {
      alert(`Could not stop: ${e.message}`);
    }
  });
  document.getElementById("clearLogs").addEventListener("click", () => {
    document.getElementById("logs").textContent = "";
  });
}

// ---------- Live ----------
async function initLive(live) {
  isLive = true;
  document.getElementById("stopBtn").classList.remove("hidden");
  setStatusTag("running");
  document.getElementById("runMeta").textContent =
    `Started ${fmtRelTime(live.startedAt)}${live.target ? ` · target ${live.target}` : ""}`;

  // Try to derive duration from the config so the chart axis is stable.
  try {
    const cfg = await api.readFile(bucket, live.configRel);
    runDurationSec = totalDurationSec(cfg) || null;
  } catch {}

  initCharts();
  attachWS(runId);
}

// ---------- Replay (from disk) ----------
async function initReplay() {
  let detail;
  try {
    detail = await api.runDetail(bucket, configDir, runId);
  } catch (e) {
    document.getElementById("runMeta").textContent = `(${e.message})`;
    return;
  }
  const meta = detail.meta || {};
  setStatusTag(meta.status || "completed");
  document.getElementById("runMeta").innerHTML =
    `Started <span class="font-medium">${escapeHtml(meta.startedAt ? new Date(meta.startedAt).toLocaleString() : "—")}</span>` +
    `${meta.endedAt ? ` · duration ${fmtSeconds((meta.endedAt - meta.startedAt) / 1000)}` : ""}` +
    `${meta.target ? ` · target ${escapeHtml(meta.target)}` : ""}` +
    `${meta.error ? `<br><span class="text-rose-500">${escapeHtml(meta.error)}</span>` : ""}`;

  if (detail.summaryTxt) {
    const link = document.getElementById("reportLink");
    link.href = reportUrl(bucket, configDir, runId);
    link.classList.remove("hidden");
    link.classList.add("flex");
  }

  // Stats
  renderStats(detail);

  // Charts
  initCharts();
  const ticks = detail.ticks || [];
  const t0 = ticks.length ? ticks[0].t : 0;
  const tN = ticks.length ? ticks[ticks.length - 1].t : 0;
  runDurationSec = ticks.length ? Math.ceil((tN - t0) / 1000) + 1 : null;
  setAxisMax(charts, runDurationSec);
  setAxisMax(memCharts, runDurationSec);
  let hasMemory = false;
  for (const tk of ticks) {
    const x = (tk.t - t0) / 1000;
    pushSeries(x, tk);
    if (tk.memory) hasMemory = true;
  }
  if (hasMemory) document.getElementById("memSection").hidden = false;
  applyChartData();

  // Logs (capped to last ~500 lines for perf)
  const lines = (detail.log || "").split(/\r?\n/).slice(-500).filter(Boolean);
  document.getElementById("logs").textContent = lines.join("\n");
}

// ---------- WS for live ----------
function attachWS(id) {
  const proto = location.protocol === "https:" ? "wss" : "ws";
  ws = new WebSocket(`${proto}://${location.host}/ws?run=${encodeURIComponent(id)}`);
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.type === "tick") onTick(msg);
    else if (msg.type === "log") onLog(msg);
    else if (msg.type === "status") onStatus(msg);
    else if (msg.type === "summary") onSummary(msg);
  };
}

function onTick(t) {
  if (runStartT === null) runStartT = t.t;
  const x = (t.t - runStartT) / 1000;
  pushSeries(x, t);
  if (runDurationSec && x > runDurationSec) {
    runDurationSec = Math.ceil(x) + 1;
    setAxisMax(charts, runDurationSec);
    setAxisMax(memCharts, runDurationSec);
  }
  if (t.memory && document.getElementById("memSection").hidden) {
    if (Object.keys(t.memory).length) document.getElementById("memSection").hidden = false;
  }
  applyChartData();
}

function onLog(l) {
  const log = document.getElementById("logs");
  const wasAtBottom = log.scrollTop + log.clientHeight >= log.scrollHeight - 6;
  const ts = new Date(l.t).toLocaleTimeString();
  log.appendChild(document.createTextNode(`${ts}  ${l.line}\n`));
  while (log.childNodes.length > 800) log.removeChild(log.firstChild);
  if (wasAtBottom) log.scrollTop = log.scrollHeight;
}

async function onStatus(s) {
  if (!s.status) return;
  setStatusTag(s.status);
  if (s.status === "completed" || s.status === "failed" || s.status === "stopped") {
    document.getElementById("stopBtn").classList.add("hidden");
    isLive = false;
    // Pull fresh detail (with summary + report link) once it's done.
    try {
      const detail = await api.runDetail(bucket, configDir, runId);
      if (detail.summaryTxt) {
        const link = document.getElementById("reportLink");
        link.href = reportUrl(bucket, configDir, runId);
        link.classList.remove("hidden");
        link.classList.add("flex");
      }
      renderStats(detail);
    } catch {}
  }
}

function onSummary() {}

// ---------- Stats grid ----------
function renderStats(detail) {
  const meta = detail.meta || {};
  const stats =
    detail.summary && detail.summary.metrics
      ? extractStats(detail.summary)
      : meta.status
      ? null
      : null;
  const dur =
    meta.startedAt && meta.endedAt
      ? fmtSeconds((meta.endedAt - meta.startedAt) / 1000)
      : "—";
  const cells = [
    ["Duration", dur, "stone"],
    ["Requests", stats?.requests?.toLocaleString() ?? "—", "indigo"],
    ["RPS", stats ? stats.rps.toFixed(1) : "—", "indigo"],
    ["p95 (ms)", stats ? stats.p95.toFixed(1) : "—", "warm"],
    ["p99 (ms)", stats ? stats.p99.toFixed(1) : "—", "warm"],
    ["Errors", stats?.errors ?? 0, stats?.errors ? "rose" : "stone"],
  ];
  document.getElementById("stats").innerHTML = cells
    .map(
      ([label, value, accent]) => `
      <div class="border border-stone-200 dark:border-ink-800 rounded-md bg-white dark:bg-ink-900 p-3.5 relative overflow-hidden pop-in">
        <div class="absolute inset-y-0 left-0 w-[2px] bg-${accent}-500"></div>
        <div class="text-[10px] uppercase tracking-wider text-stone-500 dark:text-stone-400 font-medium">${escapeHtml(label)}</div>
        <div class="num text-[18px] font-semibold mt-1 tracking-tight">${escapeHtml(String(value))}</div>
      </div>`,
    )
    .join("");
}

function extractStats(summary) {
  const m = summary.metrics || {};
  return {
    requests: m.http_reqs?.values?.count || 0,
    rps: m.http_reqs?.values?.rate || 0,
    p50: m.http_req_duration?.values?.med || 0,
    p95: m.http_req_duration?.values?.["p(95)"] || 0,
    p99: m.http_req_duration?.values?.["p(99)"] || 0,
    errors: m.errors?.values?.count || 0,
  };
}

// ---------- Charts ----------
function initCharts() {
  if (chartsInited) return;
  chartsInited = true;
  charts.rps = makeLineChart("cRps", [
    { label: "rps", data: [], borderColor: "#6366f1", backgroundColor: "rgba(99,102,241,0.18)", fill: true },
  ]);
  charts.lat = makeLineChart("cLat", [
    { label: "p50", data: [], borderColor: "#10b981" },
    { label: "p95", data: [], borderColor: "#f59e0b" },
    { label: "p99", data: [], borderColor: "#ef4444" },
  ]);
  charts.err = makeLineChart("cErr", [
    { label: "errors/s", data: [], borderColor: "#ef4444", backgroundColor: "rgba(239,68,68,0.16)", fill: true },
  ]);
  charts.vus = makeLineChart("cVus", [
    { label: "vus", data: [], borderColor: "#a855f7", backgroundColor: "rgba(168,85,247,0.16)", fill: true },
  ]);
  memCharts.heap = makeLineChart("cHeap", [
    { label: "heap MB", data: [], borderColor: "#6366f1" },
    { label: "rss MB", data: [], borderColor: "#10b981" },
  ]);
  memCharts.cpu = makeLineChart("cCpu", [
    { label: "process", data: [], borderColor: "#f59e0b" },
    { label: "system", data: [], borderColor: "#94a3b8" },
  ]);
  memCharts.eld = makeLineChart("cEld", [
    { label: "mean", data: [], borderColor: "#10b981" },
    { label: "p99", data: [], borderColor: "#ef4444" },
  ]);
  memCharts.hnd = makeLineChart("cHnd", [
    { label: "handles", data: [], borderColor: "#a855f7", backgroundColor: "rgba(168,85,247,0.16)", fill: true },
  ]);
  setAxisMax(charts, runDurationSec);
  setAxisMax(memCharts, runDurationSec);
}

function makeSeries() {
  return { rps: [], p50: [], p95: [], p99: [], errors: [], vus: [] };
}
function makeMemSeries() {
  return { heap: [], rss: [], cpu: [], sysCpu: [], eldMean: [], eldP99: [], handles: [] };
}

function pushSeries(x, t) {
  series.rps.push({ x, y: t.rps });
  series.p50.push({ x, y: Math.round(t.p50) });
  series.p95.push({ x, y: Math.round(t.p95) });
  series.p99.push({ x, y: Math.round(t.p99) });
  series.errors.push({ x, y: t.errors });
  series.vus.push({ x, y: t.vus });
  if (t.memory) {
    if (t.memory.heapMB !== undefined) memSeries.heap.push({ x, y: +t.memory.heapMB.toFixed(2) });
    if (t.memory.rssMB !== undefined) memSeries.rss.push({ x, y: +t.memory.rssMB.toFixed(2) });
    if (t.memory.cpuPercent !== undefined) memSeries.cpu.push({ x, y: +t.memory.cpuPercent.toFixed(1) });
    if (t.memory.systemCpu !== undefined) memSeries.sysCpu.push({ x, y: +t.memory.systemCpu.toFixed(1) });
    if (t.memory.eldMean !== undefined) memSeries.eldMean.push({ x, y: +t.memory.eldMean.toFixed(2) });
    if (t.memory.eldP99 !== undefined) memSeries.eldP99.push({ x, y: +t.memory.eldP99.toFixed(2) });
    if (t.memory.handles !== undefined) memSeries.handles.push({ x, y: t.memory.handles });
  }
}

function applyChartData() {
  if (!chartsInited) return;
  charts.rps.data.datasets[0].data = series.rps;
  charts.lat.data.datasets[0].data = series.p50;
  charts.lat.data.datasets[1].data = series.p95;
  charts.lat.data.datasets[2].data = series.p99;
  charts.err.data.datasets[0].data = series.errors;
  charts.vus.data.datasets[0].data = series.vus;
  for (const c of Object.values(charts)) c.update("none");
  memCharts.heap.data.datasets[0].data = memSeries.heap;
  memCharts.heap.data.datasets[1].data = memSeries.rss;
  memCharts.cpu.data.datasets[0].data = memSeries.cpu;
  memCharts.cpu.data.datasets[1].data = memSeries.sysCpu;
  memCharts.eld.data.datasets[0].data = memSeries.eldMean;
  memCharts.eld.data.datasets[1].data = memSeries.eldP99;
  memCharts.hnd.data.datasets[0].data = memSeries.handles;
  for (const c of Object.values(memCharts)) c.update("none");
}

function setStatusTag(status) {
  const map = {
    completed: ["bg-emerald-500/10", "text-emerald-600 dark:text-emerald-400"],
    failed: ["bg-rose-500/10", "text-rose-600 dark:text-rose-400"],
    stopped: ["bg-amber-500/10", "text-amber-600 dark:text-amber-400"],
    running: ["bg-indigo-500/10", "text-indigo-600 dark:text-indigo-400 pulse"],
  };
  const [bg, fg] = map[status] || ["bg-stone-500/10", "text-stone-500"];
  const el = document.getElementById("runStatus");
  el.className = `tag ${bg} ${fg}`;
  el.textContent = status;
}

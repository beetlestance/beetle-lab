import { mount, setBreadcrumbs } from "./shell.js";
import { api, escapeHtml, fmtRelTime, fmtSeconds, totalDurationSec } from "./api.js";
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
let droppedTotal = 0;
// Distinct k6 warnings seen in the log stream, in arrival order. Surfaced as
// a yellow banner above the stats grid so the QA user doesn't have to scan
// log.txt to find "Insufficient VUs", high-cardinality, etc.
const warningsSeen = new Map(); // message -> { count, firstAt, msg, hint }
const series = makeSeries();
const memSeries = makeMemSeries();
// Detail snapshot (summary + summaryTxt) — used by Export and inline report.
let lastDetail = { summary: null, summaryTxt: null, ticks: null, meta: null };

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
          <button id="compareBtn" class="hidden text-[12px] px-3 py-2 rounded border border-stone-200 dark:border-ink-800 hover:border-indigo-400 transition-colors flex items-center gap-2">
            ${icon("runs", { size: 13 })}<span>Compare</span>
          </button>
          <div class="relative">
            <button id="exportBtn" class="hidden text-[12px] px-3 py-2 rounded border border-stone-200 dark:border-ink-800 hover:border-indigo-400 transition-colors flex items-center gap-2">
              ${icon("download", { size: 13 })}<span>Export</span>${icon("chevron", { size: 11, className: "opacity-70" })}
            </button>
            <div id="exportMenu" class="hidden absolute right-0 top-full mt-1 z-10 min-w-[160px] rounded border border-stone-200 dark:border-ink-700 bg-white dark:bg-ink-900 shadow-lg overflow-hidden text-[12px]">
              <button data-export="txt" class="w-full text-left px-3 py-2 hover:bg-stone-100 dark:hover:bg-ink-800 transition-colors flex items-center gap-2">${icon("file", { size: 12, className: "text-stone-400" })}<span>Report (.txt)</span></button>
              <button data-export="json" class="w-full text-left px-3 py-2 hover:bg-stone-100 dark:hover:bg-ink-800 transition-colors flex items-center gap-2">${icon("file", { size: 12, className: "text-stone-400" })}<span>Summary (.json)</span></button>
              <button data-export="csv" class="w-full text-left px-3 py-2 hover:bg-stone-100 dark:hover:bg-ink-800 transition-colors flex items-center gap-2">${icon("file", { size: 12, className: "text-stone-400" })}<span>Metrics (.csv)</span></button>
              <div class="border-t border-stone-100 dark:border-ink-800"></div>
              <button data-export="eject" class="w-full text-left px-3 py-2 hover:bg-stone-100 dark:hover:bg-ink-800 transition-colors flex items-center gap-2" title="Self-contained k6 script with config + payloads inlined">${icon("code", { size: 12, className: "text-stone-400" })}<span>Eject to k6 script (.js)</span></button>
            </div>
          </div>
          <button id="stopBtn" class="hidden text-[12px] px-3 py-2 rounded border border-rose-500 bg-rose-500 text-white hover:bg-rose-600 transition-colors flex items-center gap-2">
            ${icon("square", { size: 12 })}<span>Stop</span>
          </button>
        </div>
      </div>

      <div id="runBanner" hidden></div>
      <div id="droppedBanner" hidden></div>
      <div id="warningsBanner" hidden></div>

      <div id="stats" class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-7 gap-3 mb-6"></div>

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

      <section id="configSection" class="border border-stone-200 dark:border-ink-800 rounded-md bg-white dark:bg-ink-900 mb-5" hidden>
        <button id="configToggle" class="w-full px-5 h-11 flex items-center justify-between border-b border-stone-100 dark:border-ink-800 text-left">
          <div class="flex items-center gap-3">
            <span data-arrow class="inline-block transition-transform duration-200" style="transform:rotate(0deg)">${icon("chevron", { size: 12, className: "text-stone-400" })}</span>
            <h2 class="text-[12px] uppercase tracking-wider text-stone-500 dark:text-stone-400 font-semibold">Config used at run time</h2>
            <span id="configHashTag" class="tag bg-stone-500/10 text-stone-500 num"></span>
          </div>
          <span class="text-[11px] text-stone-500" data-label>expand</span>
        </button>
        <div id="configWrap" class="expand">
          <div class="expand-inner">
            <div id="configBody" class="px-5 py-4 overflow-x-auto"></div>
          </div>
        </div>
      </section>

      <section id="reportSection" class="border border-stone-200 dark:border-ink-800 rounded-md bg-white dark:bg-ink-900 mb-5" hidden>
        <button id="reportToggle" class="w-full px-5 h-11 flex items-center justify-between border-b border-stone-100 dark:border-ink-800 text-left">
          <div class="flex items-center gap-3">
            <span data-arrow class="inline-block transition-transform duration-200" style="transform:rotate(90deg)">${icon("chevron", { size: 12, className: "text-stone-400" })}</span>
            <h2 class="text-[12px] uppercase tracking-wider text-stone-500 dark:text-stone-400 font-semibold">Performance report</h2>
          </div>
          <span class="text-[11px] text-stone-500" data-label>collapse</span>
        </button>
        <div id="reportWrap" class="expand open">
          <div class="expand-inner">
            <div id="reportBody" class="px-5 py-4 overflow-x-auto"></div>
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

      <div id="compareModal" class="hidden fixed inset-0 cmdk-mask z-50 items-start justify-center pt-[14vh]">
        <div class="cmdk-shell w-[640px] max-w-[92vw] bg-white dark:bg-ink-900 border border-stone-200 dark:border-ink-700 rounded-lg overflow-hidden">
          <div class="px-4 h-12 flex items-center justify-between border-b border-stone-200 dark:border-ink-800">
            <div class="text-[13px] font-medium">Compare with another run</div>
            <button id="compareCancel" class="text-[11px] text-stone-500 hover:text-ink-950 dark:hover:text-stone-100">esc</button>
          </div>
          <div id="compareList" class="max-h-[50vh] overflow-y-auto py-1"></div>
        </div>
      </div>
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

  // Export menu
  const exportBtn = document.getElementById("exportBtn");
  const exportMenu = document.getElementById("exportMenu");
  exportBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    exportMenu.classList.toggle("hidden");
  });
  document.addEventListener("click", () => exportMenu.classList.add("hidden"));
  exportMenu.querySelectorAll("[data-export]").forEach((b) =>
    b.addEventListener("click", (e) => {
      e.stopPropagation();
      exportMenu.classList.add("hidden");
      doExport(b.dataset.export);
    }),
  );

  // Compare modal
  const compareBtn = document.getElementById("compareBtn");
  const modal = document.getElementById("compareModal");
  compareBtn.addEventListener("click", openCompare);
  document.getElementById("compareCancel").addEventListener("click", closeCompare);
  modal.addEventListener("click", (e) => {
    if (e.target === modal) closeCompare();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeCompare();
  });

  // Smooth collapse/expand pattern: toggle .open on a .expand wrapper that
  // animates grid-template-rows 0fr -> 1fr (defined in main.css).
  bindAccordion("reportToggle", "reportWrap");
  bindAccordion("configToggle", "configWrap");
}

function bindAccordion(toggleId, wrapId) {
  const btn = document.getElementById(toggleId);
  const wrap = document.getElementById(wrapId);
  if (!btn || !wrap) return;
  btn.addEventListener("click", () => {
    const willOpen = !wrap.classList.contains("open");
    wrap.classList.toggle("open", willOpen);
    const label = btn.querySelector("[data-label]");
    if (label) label.textContent = willOpen ? "collapse" : "expand";
    const arrow = btn.querySelector("[data-arrow]");
    if (arrow) arrow.style.transform = willOpen ? "rotate(90deg)" : "rotate(0deg)";
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

  // Compare button is meaningful even while live (against past runs of same config).
  document.getElementById("compareBtn").classList.remove("hidden");
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

  lastDetail = detail;
  reflectExportableState();
  renderInlineReport(detail.summaryTxt);
  renderConfigSnapshot(detail);
  renderBanner(meta);

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
  let dropped = 0;
  for (const tk of ticks) {
    const x = (tk.t - t0) / 1000;
    pushSeries(x, tk);
    if (tk.memory) hasMemory = true;
    if (tk.dropped) dropped += tk.dropped;
  }
  if (hasMemory) document.getElementById("memSection").hidden = false;
  if (dropped > 0) {
    droppedTotal = dropped;
    renderDroppedBanner(dropped);
  }
  applyChartData();

  // Logs (capped to last ~500 lines for perf). Walk the full log first to
  // pick up any warnings/errors for the banner; only the tail is shown.
  const allLines = (detail.log || "").split(/\r?\n/).filter(Boolean);
  for (const line of allLines) noteWarningFromLine(line, meta.startedAt);
  document.getElementById("logs").textContent = allLines.slice(-500).join("\n");
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
  if (t.dropped) {
    droppedTotal += t.dropped;
    renderDroppedBanner(droppedTotal);
  }
  applyChartData();
}

// dropped_iterations is k6's signal that the configured arrival rate is
// outrunning the VU pool — iterations get scheduled but no VU is free to
// execute them. The end-of-run summary surfaces this, but by then the user
// has lost a minute or more of mis-shaped traffic. Banner it live the moment
// the first drop arrives so they can stop, bump preAllocatedVUs/maxVUs, and
// rerun.
function renderDroppedBanner(total) {
  const el = document.getElementById("droppedBanner");
  if (!el || total <= 0) return;
  el.hidden = false;
  // Build the banner DOM once. Subsequent calls only swap the count and the
  // "iteration"/"iterations" pluralization so the pop-in animation doesn't
  // re-fire on every tick and the surrounding layout doesn't reflow.
  let count = el.querySelector("[data-dropped-count]");
  if (!count) {
    el.innerHTML = `
      <div class="mb-4 border border-rose-300/60 dark:border-rose-800/40 bg-rose-50/50 dark:bg-rose-900/15 rounded-md p-3 flex items-start gap-3 pop-in">
        ${icon("zap", { size: 16, className: "text-rose-600 dark:text-rose-400 mt-0.5" })}
        <div class="text-[12.5px] leading-[1.55] text-rose-800 dark:text-rose-200 flex-1">
          <div class="font-semibold mb-0.5"><span class="num" data-dropped-count>0</span> dropped iteration<span data-dropped-plural>s</span> — VU pool too small.</div>
          <div>k6 wanted to fire more requests than the pre-allocated VUs could handle. The actual request rate is lower than the target. Stop the run and bump <code class="font-mono">preAllocatedVUs</code> / <code class="font-mono">maxVUs</code> in the config.</div>
        </div>
      </div>`;
    count = el.querySelector("[data-dropped-count]");
  }
  count.textContent = total.toLocaleString();
  const plural = el.querySelector("[data-dropped-plural]");
  if (plural) plural.textContent = total === 1 ? "" : "s";
}

function onLog(l) {
  const log = document.getElementById("logs");
  const wasAtBottom = log.scrollTop + log.clientHeight >= log.scrollHeight - 6;
  const ts = new Date(l.t).toLocaleTimeString();
  log.appendChild(document.createTextNode(`${ts}  ${l.line}\n`));
  while (log.childNodes.length > 800) log.removeChild(log.firstChild);
  if (wasAtBottom) log.scrollTop = log.scrollHeight;
  noteWarningFromLine(l.line, l.t);
}

// k6 logs warnings as `level=warning msg="..."`. Pull the message out and
// surface it once in the warnings banner with a one-line hint. We also catch
// `level=error msg="..."` since fatal errors are worth flagging the same way.
function noteWarningFromLine(line, t) {
  if (!line || (line.indexOf("level=warning") === -1 && line.indexOf("level=error") === -1))
    return;
  const isErr = line.indexOf("level=error") !== -1;
  const msgMatch = line.match(/msg="([^"]+)"/) || line.match(/msg=([^\s]+)/);
  if (!msgMatch) return;
  const msg = msgMatch[1];
  if (warningsSeen.has(msg)) {
    const w = warningsSeen.get(msg);
    w.count += 1;
    renderWarningsBanner();
    return;
  }
  warningsSeen.set(msg, {
    count: 1,
    firstAt: t,
    msg,
    level: isErr ? "error" : "warning",
    hint: hintForWarning(msg),
  });
  renderWarningsBanner();
}

// Map common k6 warnings to a one-line "this is what you do about it" hint.
function hintForWarning(msg) {
  if (/Insufficient VUs/i.test(msg))
    return "Bump preAllocatedVUs / maxVUs in the config. Drops from this point are not real load — they're scheduling deficits.";
  if (/unique time series/i.test(msg) || /high-cardinality/i.test(msg))
    return "URL-based metric tags hit k6's 100k limit. Already mitigated: requests are tagged with the endpoint name. If you still see this, an old run before v1.1 of k6-studio is the culprit.";
  if (/cannot initialize more/i.test(msg))
    return "k6 wanted more VUs than maxVUs allowed. Increase maxVUs.";
  if (/dropped/i.test(msg))
    return "See the dropped-iterations banner above.";
  return null;
}

function renderWarningsBanner() {
  const el = document.getElementById("warningsBanner");
  if (!el) return;
  if (warningsSeen.size === 0) {
    el.hidden = true;
    el.innerHTML = "";
    return;
  }
  el.hidden = false;
  const items = [...warningsSeen.values()]
    .map(
      (w) =>
        `<li class="flex items-start gap-2 py-1">
          <span class="inline-block w-1 h-1 mt-2 shrink-0 rounded-full ${w.level === "error" ? "bg-rose-500" : "bg-amber-500"}"></span>
          <div class="min-w-0">
            <div class="font-mono text-[11.5px] break-words">${escapeHtml(w.msg)}${w.count > 1 ? ` <span class="text-amber-700/60 dark:text-amber-300/60 num">×${w.count}</span>` : ""}</div>
            ${w.hint ? `<div class="text-[11px] text-amber-800/80 dark:text-amber-200/80 mt-0.5">${escapeHtml(w.hint)}</div>` : ""}
          </div>
        </li>`,
    )
    .join("");
  el.innerHTML = `
    <div class="mb-4 border border-amber-300/60 dark:border-amber-800/40 bg-amber-50/50 dark:bg-amber-900/15 rounded-md p-3 flex items-start gap-3">
      ${icon("zap", { size: 16, className: "text-amber-600 dark:text-amber-400 mt-0.5" })}
      <div class="text-[12.5px] leading-[1.55] text-amber-800 dark:text-amber-200 flex-1 min-w-0">
        <div class="font-semibold mb-1">k6 raised ${warningsSeen.size} ${warningsSeen.size === 1 ? "warning" : "warnings"}</div>
        <ul class="list-none m-0 p-0">${items}</ul>
      </div>
    </div>`;
}

async function onStatus(s) {
  if (!s.status) return;
  setStatusTag(s.status);
  if (s.status === "completed" || s.status === "failed" || s.status === "stopped") {
    document.getElementById("stopBtn").classList.add("hidden");
    isLive = false;
    // Pull fresh detail (with summary + rendered report) once it's done.
    try {
      const detail = await api.runDetail(bucket, configDir, runId);
      lastDetail = detail;
      reflectExportableState();
      renderInlineReport(detail.summaryTxt);
      renderConfigSnapshot(detail);
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
  // Transport failures (HTTP 5xx, timeouts, network) live in http_req_failed
  // as "passes" (k6's quirk). Validation failures live in our custom errors
  // counter, incremented when a per-endpoint check (status / status2xx /
  // bodyContains) returns false. They tell different stories and conflating
  // them hides real problems — split them into separate tiles.
  const transport = stats?.transportFails ?? 0;
  const validation = stats?.errors ?? 0;
  const cells = [
    ["Duration", dur, "stone", null],
    ["Requests", stats?.requests?.toLocaleString() ?? "—", "indigo", null],
    ["RPS", stats ? stats.rps.toFixed(1) : "—", "indigo", null],
    ["p95 (ms)", stats ? stats.p95.toFixed(1) : "—", "warm", null],
    ["p99 (ms)", stats ? stats.p99.toFixed(1) : "—", "warm", null],
    [
      "Transport",
      transport.toLocaleString(),
      transport ? "rose" : "stone",
      "Non-2xx responses + network failures (k6 http_req_failed). Watch this for service errors and timeouts.",
    ],
    [
      "Validation",
      validation.toLocaleString(),
      validation ? "rose" : "stone",
      "Failed per-endpoint checks (status / status2xx / bodyContains). The HTTP layer succeeded but the response didn't match what the config asserted.",
    ],
  ];
  document.getElementById("stats").innerHTML = cells
    .map(
      ([label, value, accent, tip]) => `
      <div class="border border-stone-200 dark:border-ink-800 rounded-md bg-white dark:bg-ink-900 p-3.5 relative overflow-hidden pop-in"${tip ? ` title="${escapeHtml(tip)}"` : ""}>
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
    // k6 reports "passes" as the count of FAILED requests for http_req_failed
    // (the rate variant flips it). Use passes for absolute numbers.
    transportFails: m.http_req_failed?.values?.passes || 0,
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
    { label: "p99", data: [], borderColor: "#f59e0b" },
    { label: "max", data: [], borderColor: "#ef4444" },
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
  return { heap: [], rss: [], cpu: [], sysCpu: [], eldMean: [], eldP99: [], eldMax: [], handles: [] };
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
    if (t.memory.eldMax !== undefined) memSeries.eldMax.push({ x, y: +t.memory.eldMax.toFixed(2) });
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
  memCharts.eld.data.datasets[2].data = memSeries.eldMax;
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

// ---------- Inline report ----------
function renderInlineReport(text) {
  const section = document.getElementById("reportSection");
  const body = document.getElementById("reportBody");
  if (!text) {
    section.hidden = true;
    return;
  }
  section.hidden = false;
  body.innerHTML = highlightReport(text);
}

// Lightweight syntax pass: section headers, rules, verdict pills.
function highlightReport(text) {
  const lines = text.split(/\r?\n/);
  const out = [];
  for (const raw of lines) {
    const l = raw;
    let cls = "text-stone-700 dark:text-stone-300";
    let content = escapeHtml(l);
    if (/^=+$/.test(l.trim())) {
      cls = "text-stone-300 dark:text-ink-700";
    } else if (/^-+$/.test(l.trim())) {
      cls = "text-stone-300 dark:text-ink-700";
    } else if (/^\s*\[.+\]\s*$/.test(l)) {
      cls = "text-indigo-600 dark:text-indigo-400 font-semibold";
    } else if (/\bNODE\.JS PERFORMANCE ANALYSIS REPORT\b/.test(l)) {
      cls = "text-ink-950 dark:text-stone-50 font-bold";
    } else if (/\[OK\]/.test(l)) {
      cls = "text-emerald-600 dark:text-emerald-400";
    } else if (/\[!\]/.test(l)) {
      cls = "text-rose-600 dark:text-rose-400";
    } else if (/\[~\]/.test(l)) {
      cls = "text-amber-600 dark:text-amber-400";
    } else if (/\[i\]/.test(l)) {
      cls = "text-sky-600 dark:text-sky-400";
    } else if (/^\s+✓/.test(l)) {
      cls = "text-emerald-600 dark:text-emerald-400";
    } else if (/^\s+✗/.test(l)) {
      cls = "text-rose-600 dark:text-rose-400";
    }
    out.push(`<span class="block whitespace-pre ${cls}">${content || "&nbsp;"}</span>`);
  }
  return `<div class="font-mono text-[12px] leading-[1.55]">${out.join("")}</div>`;
}

function reflectExportableState() {
  document.getElementById("exportBtn").classList.remove("hidden");
  document.getElementById("compareBtn").classList.remove("hidden");
}

// ---------- Export ----------
function doExport(kind) {
  if (kind === "txt") {
    const txt = lastDetail?.summaryTxt;
    if (!txt) {
      alert("No text report yet (run still in progress, or memory sampling was disabled).");
      return;
    }
    download(`${runId}.txt`, txt, "text/plain");
  } else if (kind === "json") {
    const obj = lastDetail?.summary;
    if (!obj) {
      alert("No summary JSON yet (run still in progress).");
      return;
    }
    download(`${runId}.summary.json`, JSON.stringify(obj, null, 2), "application/json");
  } else if (kind === "csv") {
    const ticks = lastDetail?.ticks || [];
    if (!ticks.length) {
      alert("No tick data to export.");
      return;
    }
    download(`${runId}.metrics.csv`, ticksToCsv(ticks), "text/csv");
  } else if (kind === "eject") {
    // Server has both the config snapshot and the bodyFile payloads — let it
    // assemble the self-contained k6 script and stream it as a download.
    const url = `/api/folders/${encodeURIComponent(bucket)}/runs/${encodeURIComponent(configDir)}/${encodeURIComponent(runId)}/eject.js`;
    const a = document.createElement("a");
    a.href = url;
    a.download = `${bucket}-${configDir}-${runId}.k6.js`;
    document.body.appendChild(a);
    a.click();
    a.remove();
  }
}

function ticksToCsv(ticks) {
  const headers = [
    "elapsed_s",
    "rps",
    "p50_ms",
    "p95_ms",
    "p99_ms",
    "errors",
    "vus",
    "heap_mb",
    "rss_mb",
    "cpu_pct",
    "eld_mean_ms",
    "eld_p99_ms",
    "handles",
  ];
  const t0 = ticks[0].t;
  const rows = [headers.join(",")];
  for (const t of ticks) {
    const m = t.memory || {};
    rows.push(
      [
        ((t.t - t0) / 1000).toFixed(1),
        t.rps,
        t.p50?.toFixed(2) ?? "",
        t.p95?.toFixed(2) ?? "",
        t.p99?.toFixed(2) ?? "",
        t.errors,
        t.vus,
        m.heapMB?.toFixed(2) ?? "",
        m.rssMB?.toFixed(2) ?? "",
        m.cpuPercent?.toFixed(1) ?? "",
        m.eldMean?.toFixed(2) ?? "",
        m.eldP99?.toFixed(2) ?? "",
        m.handles ?? "",
      ].join(","),
    );
  }
  return rows.join("\n");
}

function download(filename, content, mime) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 200);
}

// ---------- Compare modal ----------
async function openCompare() {
  const modal = document.getElementById("compareModal");
  const list = document.getElementById("compareList");
  modal.classList.remove("hidden");
  modal.classList.add("flex");
  list.innerHTML = `<div class="px-4 py-6 text-center text-stone-500 text-[12px]">Loading other runs…</div>`;
  let runs = [];
  try {
    const all = await api.history(bucket);
    runs = all.filter((r) => r.configDir === configDir && r.id !== runId);
  } catch {}
  if (runs.length === 0) {
    list.innerHTML = `<div class="px-4 py-6 text-center text-stone-500 text-[12px]">No other runs of this config yet.</div>`;
    return;
  }
  list.innerHTML = runs
    .slice(0, 30)
    .map((r) => {
      const stats = r.stats || {};
      const dur =
        r.startedAt && r.endedAt ? fmtSeconds((r.endedAt - r.startedAt) / 1000) : "—";
      const href = `/compare/${encodeURIComponent(bucket)}/${encodeURIComponent(configDir)}?a=${encodeURIComponent(runId)}&b=${encodeURIComponent(r.id)}`;
      return `<a href="${href}" class="w-full text-left px-4 py-2.5 hover:bg-stone-50 dark:hover:bg-ink-800 transition-colors flex items-center gap-3 border-b border-stone-100 dark:border-ink-800">
        <span class="status-square ${statusColor(r.status)}"></span>
        <div class="flex-1 min-w-0">
          <div class="text-[12px] num">${escapeHtml(new Date(r.startedAt).toLocaleString())}</div>
          <div class="text-[11px] text-stone-500 dark:text-stone-400 num">${dur} · ${stats.requests ?? "—"} req · p95 ${stats.p95 ? stats.p95.toFixed(1) + "ms" : "—"}</div>
        </div>
        <span class="text-[11px] text-indigo-500">Compare →</span>
      </a>`;
    })
    .join("");
}

function closeCompare() {
  const modal = document.getElementById("compareModal");
  modal.classList.add("hidden");
  modal.classList.remove("flex");
}

function statusColor(status) {
  return (
    {
      completed: "text-emerald-500",
      failed: "text-rose-500",
      stopped: "text-amber-500",
      running: "text-indigo-500",
    }[status] || "text-stone-400"
  );
}

// ---------- Config snapshot ----------
// ---------- Run banner ----------
// Surface meta-level conditions that aren't obvious from the stats grid
// (orphaned runs, threshold failures, etc.) right at the top of the page.
function renderBanner(meta) {
  const el = document.getElementById("runBanner");
  if (!el) return;
  if (!meta) {
    el.hidden = true;
    el.innerHTML = "";
    return;
  }
  if (meta.orphaned) {
    el.hidden = false;
    el.innerHTML = `
      <div class="mb-5 border border-amber-300/60 dark:border-amber-800/40 bg-amber-50/60 dark:bg-amber-900/15 rounded-md p-3 flex items-start gap-3">
        ${icon("info", { size: 16, className: "text-amber-600 dark:text-amber-400 mt-0.5" })}
        <div class="text-[12.5px] leading-[1.55] text-amber-800 dark:text-amber-200">
          <div class="font-semibold mb-0.5">This run was marked failed because k6-studio restarted mid-run.</div>
          <div>The k6 child process likely exited soon after, but the target service may have continued receiving load until then. Check the target's own logs and resource graphs around <span class="font-mono">${escapeHtml(meta.endedAt ? new Date(meta.endedAt).toLocaleString() : "—")}</span> to gauge actual impact. Charts and the report below reflect only what was captured before the restart.</div>
        </div>
      </div>`;
    return;
  }
  el.hidden = true;
  el.innerHTML = "";
}

function renderConfigSnapshot(detail) {
  const section = document.getElementById("configSection");
  const body = document.getElementById("configBody");
  const tag = document.getElementById("configHashTag");
  const cfg = detail.configSnapshot;
  if (!cfg) {
    section.hidden = true;
    return;
  }
  section.hidden = false;
  const hash = detail.meta?.configHash;
  if (hash) tag.textContent = "sha256 " + hash.slice(0, 12);
  // Pretty-print the config so users can audit what actually ran.
  const txt = JSON.stringify(cfg, null, 2);
  body.innerHTML = `<pre class="font-mono text-[12px] leading-[1.55] m-0 whitespace-pre">${escapeHtml(txt)}</pre>`;
}

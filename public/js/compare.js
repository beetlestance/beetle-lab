import { mount, setBreadcrumbs } from "./shell.js";
import { api, escapeHtml, fmtSeconds, fmtRelTime } from "./api.js";
import { icon } from "./icons.js";
import { makeLineChart, setAxisMax } from "./charts.js";

// URL: /compare/:bucket/:configDir?a=ID&b=ID[&c=ID&d=ID]
const m = location.pathname.match(/^\/compare\/([^/]+)\/([^/]+)$/);
if (!m) {
  document.getElementById("page-content").textContent = "Invalid compare URL.";
  throw new Error("invalid");
}
const bucket = decodeURIComponent(m[1]);
const configDir = decodeURIComponent(m[2]);

// Run colors (kept distinct so overlaid charts are readable).
const RUN_COLORS = ["#6366f1", "#f97316", "#10b981", "#ef4444"];
const SLOT_KEYS = ["a", "b", "c", "d"];

// Cached state.
let candidateRuns = []; // history rows for this configDir
let detailCache = new Map(); // id -> detail
let charts = {};
let memCharts = {};
let chartsInited = false;

// ---------- Section schema ----------
// `path` follows k6's summary metric shape: <name>.<field> -> metrics[name].values[field]
// `lowerBetter` controls which direction colors green vs rose in the delta column.
const SECTIONS = [
  {
    id: "throughput",
    label: "Throughput",
    open: true,
    rows: [
      { label: "Total requests", path: "http_reqs.count", fmt: "n" },
      { label: "Requests / sec", path: "http_reqs.rate", fmt: "f1" },
      { label: "Iterations", path: "iterations.count", fmt: "n" },
      { label: "Iterations / sec", path: "iterations.rate", fmt: "f1" },
      { label: "Data received (MB)", path: "data_received.count", fmt: "bytesMB" },
      { label: "Data sent (MB)", path: "data_sent.count", fmt: "bytesMB" },
    ],
  },
  {
    id: "latency",
    label: "Latency · HTTP request",
    open: true,
    rows: [
      { label: "Avg (ms)", path: "http_req_duration.avg", fmt: "f1", lowerBetter: true },
      { label: "p50 (ms)", path: "http_req_duration.med", fmt: "f1", lowerBetter: true },
      { label: "p90 (ms)", path: "http_req_duration.p(90)", fmt: "f1", lowerBetter: true },
      { label: "p95 (ms)", path: "http_req_duration.p(95)", fmt: "f1", lowerBetter: true },
      { label: "p99 (ms)", path: "http_req_duration.p(99)", fmt: "f1", lowerBetter: true },
      { label: "Min (ms)", path: "http_req_duration.min", fmt: "f1" },
      { label: "Max (ms)", path: "http_req_duration.max", fmt: "f1", lowerBetter: true },
    ],
  },
  {
    id: "iter",
    label: "Iteration timing",
    rows: [
      { label: "Avg (ms)", path: "iteration_duration.avg", fmt: "f1", lowerBetter: true },
      { label: "p95 (ms)", path: "iteration_duration.p(95)", fmt: "f1", lowerBetter: true },
      { label: "p99 (ms)", path: "iteration_duration.p(99)", fmt: "f1", lowerBetter: true },
      { label: "Max (ms)", path: "iteration_duration.max", fmt: "f1", lowerBetter: true },
    ],
  },
  {
    id: "errors",
    label: "Errors & checks",
    open: true,
    rows: [
      { label: "Custom errors", path: "errors.count", fmt: "n", lowerBetter: true },
      { label: "Errors / sec", path: "errors.rate", fmt: "f2", lowerBetter: true },
      { label: "Failed requests rate", path: "http_req_failed.rate", fmt: "pct", lowerBetter: true },
      { label: "Failed requests count", path: "http_req_failed.passes", fmt: "n", lowerBetter: true },
      { label: "Checks pass rate", path: "checks.rate", fmt: "pct" },
    ],
  },
  {
    id: "vus",
    label: "VUs",
    rows: [
      { label: "Final VUs", path: "vus.value", fmt: "n" },
      { label: "Max VUs", path: "vus_max.value", fmt: "n" },
    ],
  },
  {
    id: "memory",
    label: "Memory · V8 heap & RSS",
    rows: [
      { label: "Baseline heap (MB)", path: "baseline_heap_mb.value", fmt: "f1" },
      { label: "Final heap (MB)", path: "heap_inuse_bytes.value", fmt: "bytesMB", lowerBetter: true },
      { label: "Peak heap (MB)", path: "peak_heap_mb.value", fmt: "f1", lowerBetter: true },
      { label: "Cooldown heap (MB)", path: "cooldown_heap_mb.value", fmt: "f1", lowerBetter: true },
      { label: "Heap size limit (MB)", path: "heap_size_limit_mb.value", fmt: "f1" },
      { label: "Heap total (MB)", path: "heap_total_size_mb.value", fmt: "f1" },
      { label: "Baseline RSS (MB)", path: "baseline_rss_mb.value", fmt: "f1" },
      { label: "Final RSS (MB)", path: "rss_bytes.value", fmt: "bytesMB", lowerBetter: true },
      { label: "Peak RSS (MB)", path: "peak_rss_mb.value", fmt: "f1", lowerBetter: true },
      { label: "Cooldown RSS (MB)", path: "cooldown_rss_mb.value", fmt: "f1", lowerBetter: true },
      { label: "External (MB)", path: "external_bytes.value", fmt: "bytesMB" },
    ],
  },
  {
    id: "cpu",
    label: "CPU",
    rows: [
      { label: "Baseline %", path: "baseline_cpu_percent.value", fmt: "f1" },
      { label: "Final %", path: "cpu_percent.value", fmt: "f1" },
      { label: "Peak %", path: "peak_cpu_percent.value", fmt: "f1", lowerBetter: true },
      { label: "Average %", path: "avg_cpu_percent.avg", fmt: "f1", lowerBetter: true },
      { label: "Cooldown %", path: "cooldown_cpu.value", fmt: "f1", lowerBetter: true },
      { label: "System %", path: "system_cpu_percent.value", fmt: "f2" },
    ],
  },
  {
    id: "eld",
    label: "Event loop delay",
    rows: [
      { label: "Mean (ms)", path: "event_loop_delay_mean_ms.avg", fmt: "f2", lowerBetter: true },
      { label: "p90 (ms)", path: "event_loop_delay_p90_ms.value", fmt: "f2", lowerBetter: true },
      { label: "p99 (ms)", path: "event_loop_delay_p99_ms.value", fmt: "f2", lowerBetter: true },
      { label: "Max (ms)", path: "event_loop_delay_max_ms.value", fmt: "f2", lowerBetter: true },
    ],
  },
  {
    id: "gc",
    label: "Garbage collection",
    rows: [
      { label: "GC pauses", path: "gc_count.value", fmt: "n", lowerBetter: true },
      { label: "GC total (ms)", path: "gc_total_ms.value", fmt: "f2", lowerBetter: true },
      { label: "GC avg (ms)", path: "gc_avg_ms.value", fmt: "f2", lowerBetter: true },
      { label: "GC max (ms)", path: "gc_max_ms.value", fmt: "f2", lowerBetter: true },
    ],
  },
  {
    id: "cppheap",
    label: "C++ heap",
    rows: [
      { label: "Allocated (MB)", path: "cpp_heap_allocated_mb.value", fmt: "f1" },
      { label: "Used (MB)", path: "cpp_heap_used_mb.value", fmt: "f1" },
    ],
  },
  {
    id: "libuv",
    label: "libuv",
    rows: [
      { label: "Baseline handles", path: "baseline_handles.value", fmt: "n" },
      { label: "Final handles", path: "active_handles.value", fmt: "n", lowerBetter: true },
      { label: "Cooldown handles", path: "cooldown_handles.value", fmt: "n", lowerBetter: true },
      { label: "Active requests", path: "active_requests.value", fmt: "n" },
      { label: "Threadpool size", path: "uv_threadpool_size.value", fmt: "n" },
    ],
  },
  // Per-endpoint section is materialized at render time from ep_*_latency metrics.
  { id: "endpoints", label: "Per-endpoint latency", dynamic: "endpoints" },
];

mount(async (page) => {
  setBreadcrumbs([
    { label: "Runs", href: "/runs" },
    { label: `${bucket} / ${configDir}`, href: `/bucket/${encodeURIComponent(bucket)}#runs` },
    { label: "Compare" },
  ]);
  page.innerHTML = template();
  bindActions();

  try {
    const all = await api.history(bucket);
    candidateRuns = all.filter((r) => r.configDir === configDir);
  } catch {
    candidateRuns = [];
  }

  await refresh();
  window.addEventListener("popstate", refresh);

  return () => {
    window.removeEventListener("popstate", refresh);
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
      <div class="flex items-end justify-between gap-6 mb-5 flex-wrap">
        <div class="min-w-0">
          <div class="text-[11px] uppercase tracking-wider text-stone-400 num">${escapeHtml(bucket)} / ${escapeHtml(configDir)}</div>
          <h1 class="text-[22px] font-semibold tracking-tight mt-1">Compare runs</h1>
          <p class="text-[12px] text-stone-500 dark:text-stone-400 mt-1">Pick up to 4 runs of this config to overlay charts and diff stats.</p>
        </div>
        <a href="/bucket/${encodeURIComponent(bucket)}#runs" class="text-[12px] px-3 py-2 rounded border border-stone-200 dark:border-ink-800 hover:border-indigo-400 transition-colors flex items-center gap-2">
          ${icon("back", { size: 13 })}<span>Back to bucket</span>
        </a>
      </div>

      <section id="slots" class="mb-5"></section>
      <section id="configCheck" class="mb-5"></section>

      <div id="body"></div>

      <div id="diffModal" class="hidden fixed inset-0 cmdk-mask z-50 items-start justify-center pt-[8vh]">
        <div class="cmdk-shell w-[90vw] max-w-[1200px] h-[80vh] bg-white dark:bg-ink-900 border border-stone-200 dark:border-ink-700 rounded-lg overflow-hidden flex flex-col">
          <div class="px-4 h-12 flex items-center justify-between border-b border-stone-200 dark:border-ink-800 shrink-0">
            <div class="text-[13px] font-medium">Config diff</div>
            <button id="diffClose" class="text-[11px] text-stone-500 hover:text-ink-950 dark:hover:text-stone-100">esc</button>
          </div>
          <div id="diffBody" class="flex-1 overflow-auto"></div>
        </div>
      </div>
    </div>`;
}

function bindActions() {
  document.getElementById("diffClose")?.addEventListener("click", closeDiff);
  document.getElementById("diffModal")?.addEventListener("click", (e) => {
    if (e.target.id === "diffModal") closeDiff();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeDiff();
  });
}

function closeDiff() {
  const m = document.getElementById("diffModal");
  if (!m) return;
  m.classList.add("hidden");
  m.classList.remove("flex");
}

// ---------- Slots ----------
function selectedIds() {
  const params = new URLSearchParams(location.search);
  return SLOT_KEYS.map((k) => params.get(k) || "");
}

function renderSlots() {
  const ids = selectedIds();
  const slots = SLOT_KEYS.map((key, i) => {
    const sel = ids[i];
    const opts = ['<option value="">(empty)</option>']
      .concat(
        candidateRuns.map(
          (r) =>
            `<option value="${escapeHtml(r.id)}"${r.id === sel ? " selected" : ""}>${escapeHtml(slotOptionLabel(r))}</option>`,
        ),
      )
      .join("");
    return `
      <div class="flex items-center gap-2 border border-stone-200 dark:border-ink-800 rounded-md px-3 py-2 bg-white dark:bg-ink-900 min-w-0 flex-1">
        <span class="inline-block w-2.5 h-2.5 rounded-sm shrink-0" style="background:${runColor(i)}"></span>
        <span class="text-[11px] font-semibold text-stone-500 shrink-0">${key.toUpperCase()}</span>
        <select data-slot="${key}" class="text-[12px] bg-transparent outline-none border-0 cursor-pointer flex-1 min-w-0 text-stone-700 dark:text-stone-300">
          ${opts}
        </select>
      </div>`;
  }).join("");
  document.getElementById("slots").innerHTML = `
    <div class="flex gap-3 flex-wrap">${slots}</div>
    <div class="text-[11px] text-stone-500 mt-2">Showing ${candidateRuns.length} run${candidateRuns.length === 1 ? "" : "s"} of this config. Pick at least two slots to compare.</div>`;
  document.querySelectorAll("[data-slot]").forEach((sel) =>
    sel.addEventListener("change", (e) => onSlotChange(e.target.dataset.slot, e.target.value)),
  );
}

function slotOptionLabel(r) {
  const date = r.startedAt ? new Date(r.startedAt).toLocaleString() : r.id;
  const stats = r.stats || {};
  const dur = r.startedAt && r.endedAt ? fmtSeconds((r.endedAt - r.startedAt) / 1000) : "—";
  return `${date} · ${dur} · p95 ${stats.p95 ? stats.p95.toFixed(1) + "ms" : "—"}`;
}

function onSlotChange(slot, value) {
  const params = new URLSearchParams(location.search);
  if (value) params.set(slot, value);
  else params.delete(slot);
  const next = params.toString();
  window.history.pushState({}, "", `${location.pathname}${next ? "?" + next : ""}`);
  refresh();
}

// ---------- Refresh ----------
async function refresh() {
  renderSlots();
  const ids = selectedIds();
  const slotIds = ids.filter(Boolean);
  if (slotIds.length < 2) {
    document.getElementById("body").innerHTML = `
      <div class="empty-state">
        ${icon("filter", { size: 40, className: "text-stone-300 dark:text-ink-700" })}
        <div class="text-[14px] font-medium">Pick at least two runs to compare</div>
        <div class="text-[12px] text-stone-500 dark:text-stone-400 max-w-md text-center">Use the slot dropdowns above to select up to four runs of <span class="font-mono">${escapeHtml(configDir)}</span>.</div>
      </div>`;
    return;
  }

  const details = await Promise.all(
    ids.map((id) => (id ? loadDetail(id) : Promise.resolve(null))),
  );
  const ok = details.filter(Boolean);
  if (ok.length < 2) {
    document.getElementById("body").innerHTML = `
      <div class="empty-state text-stone-500 text-[13px]">Could not load enough runs to compare.</div>`;
    return;
  }

  renderConfigCheck(details);
  renderBody(details);
}

async function loadDetail(id) {
  if (detailCache.has(id)) return detailCache.get(id);
  try {
    const d = await api.runDetail(bucket, configDir, id);
    detailCache.set(id, { id, ...d });
    return detailCache.get(id);
  } catch {
    return null;
  }
}

// ---------- Render ----------
function renderBody(details) {
  const body = document.getElementById("body");
  body.innerHTML = `
    <div id="legend" class="mb-5"></div>
    <div id="sections" class="space-y-3 mb-6"></div>

    <section class="border border-stone-200 dark:border-ink-800 rounded-md bg-white dark:bg-ink-900 mb-5">
      <header class="px-5 h-11 flex items-center border-b border-stone-100 dark:border-ink-800">
        <h2 class="text-[12px] uppercase tracking-wider text-stone-500 dark:text-stone-400 font-semibold">Charts · HTTP &amp; VUs</h2>
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
        <h2 class="text-[12px] uppercase tracking-wider text-stone-500 dark:text-stone-400 font-semibold">Charts · Runtime</h2>
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
    </section>`;

  // Filter only the actually-selected runs (no nulls) for chart/table rendering.
  const ok = details.filter(Boolean);
  document.getElementById("legend").innerHTML = legend(ok);
  renderSections(ok);

  // Re-init charts because the body innerHTML reset destroyed canvases.
  for (const c of Object.values(charts)) try { c.destroy(); } catch {}
  for (const c of Object.values(memCharts)) try { c.destroy(); } catch {}
  charts = {};
  memCharts = {};
  chartsInited = false;
  initCharts();
  drawCharts(ok);
}

function legend(details) {
  return details
    .map((d, i) => {
      const realIdx = realSlotIndex(d, details);
      return `<span class="inline-flex items-center gap-2 text-[12px] mr-4">
        <span class="inline-block w-3 h-3 rounded-sm" style="background:${runColor(realIdx)}"></span>
        <span class="font-medium">${String.fromCharCode(65 + realIdx)}</span>
        <span class="text-stone-500 dark:text-stone-400">${escapeHtml(new Date(d.meta?.startedAt || 0).toLocaleString())}</span>
      </span>`;
    })
    .join("");
}

// Map a detail back to its slot index (A/B/C/D) so colors stay consistent
// even if a slot is left empty in the middle (e.g. A=X, B=null, C=Y).
function realSlotIndex(detail, details) {
  return details.indexOf(detail);
}

function runColor(i) {
  return RUN_COLORS[i % RUN_COLORS.length];
}

// ---------- Sections (collapsible, smooth) ----------
function renderSections(okDetails) {
  const root = document.getElementById("sections");
  const sections = expandSections(SECTIONS, okDetails);
  root.innerHTML = sections.map((s, i) => sectionCard(s, okDetails, i)).join("");
  // Wire toggles.
  root.querySelectorAll("[data-toggle]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const card = btn.closest("[data-section]");
      const wrap = card.querySelector("[data-expand]");
      const willOpen = !wrap.classList.contains("open");
      wrap.classList.toggle("open", willOpen);
      const arrow = btn.querySelector("[data-arrow]");
      if (arrow) arrow.style.transform = willOpen ? "rotate(90deg)" : "rotate(0deg)";
    });
  });
}

// Expand the dynamic per-endpoint section into static rows derived from the
// metric set actually present across the loaded runs.
function expandSections(schema, details) {
  const out = [];
  for (const sec of schema) {
    if (sec.dynamic === "endpoints") {
      const eps = collectEndpoints(details);
      if (!eps.length) continue;
      const rows = [];
      for (const ep of eps) {
        rows.push({ label: ep, _label: "p95 (ms) — " + ep, path: `ep_${ep}_latency.p(95)`, fmt: "f1", lowerBetter: true });
      }
      out.push({ ...sec, rows });
    } else {
      // Drop sections with zero data across all runs to keep the page tight.
      const anyValue = sec.rows.some((row) =>
        details.some((d) => getMetric(d, row.path) !== null && getMetric(d, row.path) !== undefined),
      );
      if (anyValue) out.push(sec);
    }
  }
  return out;
}

function collectEndpoints(details) {
  const set = new Set();
  for (const d of details) {
    const metrics = d.summary?.metrics || {};
    for (const k of Object.keys(metrics)) {
      const m2 = k.match(/^ep_(.+)_latency$/);
      if (m2) set.add(m2[1]);
    }
  }
  return [...set].sort();
}

function sectionCard(section, details, i) {
  const open = section.open || section.id === "throughput" || section.id === "latency" || section.id === "errors";
  const headerRow = headerCells(details);
  const bodyRows = section.rows
    .map((row) => statRowHtml(row, details))
    .filter(Boolean)
    .join("");
  return `
    <div data-section="${section.id}" class="border border-stone-200 dark:border-ink-800 rounded-md bg-white dark:bg-ink-900 overflow-hidden" style="animation-delay:${i * 18}ms">
      <button data-toggle class="w-full px-4 h-11 flex items-center justify-between border-b border-stone-100 dark:border-ink-800 text-left hover:bg-stone-50 dark:hover:bg-ink-800/40 transition-colors">
        <div class="flex items-center gap-3">
          <span data-arrow class="inline-block transition-transform duration-200" style="transform:rotate(${open ? 90 : 0}deg)">${icon("chevron", { size: 12, className: "text-stone-400" })}</span>
          <h3 class="text-[12px] uppercase tracking-wider text-stone-500 dark:text-stone-400 font-semibold">${escapeHtml(section.label)}</h3>
          <span class="text-[10px] text-stone-400 num">${section.rows.length} metric${section.rows.length === 1 ? "" : "s"}</span>
        </div>
      </button>
      <div data-expand class="expand${open ? " open" : ""}">
        <div class="expand-inner">
          <table class="w-full text-[12px]">
            <thead>
              <tr class="text-[10px] uppercase tracking-wider text-stone-500 dark:text-stone-400 border-b border-stone-100 dark:border-ink-800">
                <th class="text-left px-4 py-2 font-medium">Metric</th>
                ${headerRow}
              </tr>
            </thead>
            <tbody>${bodyRows}</tbody>
          </table>
        </div>
      </div>
    </div>`;
}

function headerCells(details) {
  return details
    .map(
      (_, i) =>
        `<th class="px-3 py-2 text-right">
          <span class="inline-flex items-center gap-2 num">
            <span class="inline-block w-2 h-2 rounded-sm" style="background:${runColor(i)}"></span>
            ${String.fromCharCode(65 + i)}${i === 0 ? '<span class="text-[10px] text-stone-400 ml-1">(base)</span>' : ""}
          </span>
        </th>`,
    )
    .join("");
}

function statRowHtml(row, details) {
  const vals = details.map((d) => getMetric(d, row.path));
  if (vals.every((v) => v === null || v === undefined)) return null;
  const baseV = vals[0];
  const lowerBetter = !!row.lowerBetter;
  const cells = vals
    .map((v, i) => {
      let deltaCell = "";
      if (i > 0 && baseV !== null && baseV !== undefined && v !== null && v !== undefined) {
        const d = v - baseV;
        const pct = baseV !== 0 ? (d / baseV) * 100 : null;
        const arrow = d > 0 ? "▲" : d < 0 ? "▼" : "";
        const better =
          d === 0 ? null : lowerBetter ? d < 0 : d > 0;
        const cls =
          better === null
            ? "text-stone-500"
            : better
            ? "text-emerald-600 dark:text-emerald-400"
            : "text-rose-600 dark:text-rose-400";
        const pctStr = pct !== null ? `${pct >= 0 ? "+" : ""}${pct.toFixed(1)}%` : "";
        deltaCell = `<div class="text-[10px] num ${cls} mt-0.5">${arrow} ${pctStr}</div>`;
      }
      return `<td class="px-3 py-2 num text-right align-top">
        <div class="${i === 0 ? "font-medium" : ""}">${formatMetric(row.fmt, v)}</div>
        ${deltaCell}
      </td>`;
    })
    .join("");
  return `<tr class="border-b border-stone-100 dark:border-ink-800 last:border-b-0">
    <th class="text-left px-4 py-2 text-[12px] font-medium text-stone-700 dark:text-stone-300">${escapeHtml(row.label)}</th>
    ${cells}
  </tr>`;
}

function getMetric(detail, path) {
  if (!detail) return null;
  const metrics = detail.summary?.metrics || {};
  const dot = path.indexOf(".");
  const name = path.slice(0, dot);
  const field = path.slice(dot + 1);
  const v = metrics[name]?.values?.[field];
  return v === undefined ? null : v;
}

function formatMetric(fmt, v) {
  if (v === null || v === undefined || (typeof v === "number" && !isFinite(v))) return "—";
  if (fmt === "n") return Number(v).toLocaleString();
  if (fmt === "f1") return Number(v).toFixed(1);
  if (fmt === "f2") return Number(v).toFixed(2);
  if (fmt === "pct") return (Number(v) * 100).toFixed(2) + "%";
  if (fmt === "bytesMB") return (Number(v) / 1048576).toFixed(1);
  return String(v);
}

// ---------- Config-match check + diff ----------
function renderConfigCheck(details) {
  const el = document.getElementById("configCheck");
  if (!el) return;
  const ok = details.filter(Boolean);
  if (ok.length < 2) {
    el.innerHTML = "";
    return;
  }
  const hashes = ok.map((d) => d.meta?.configHash || null);
  const haveAll = hashes.every(Boolean);
  const allEqual = haveAll && hashes.every((h) => h === hashes[0]);
  const someMissing = hashes.some((h) => !h);
  let banner;
  if (allEqual) {
    banner = `
      <div class="border border-emerald-300/50 dark:border-emerald-800/40 bg-emerald-50/40 dark:bg-emerald-900/10 rounded-md px-4 py-3 flex items-center gap-3">
        ${icon("check", { size: 16, className: "text-emerald-600 dark:text-emerald-400" })}
        <div class="flex-1">
          <div class="text-[13px] font-medium text-emerald-700 dark:text-emerald-300">Configs match</div>
          <div class="text-[11px] text-emerald-700/70 dark:text-emerald-400/70 num">All ${ok.length} runs used identical config (sha256 ${hashes[0].slice(0, 12)}…).</div>
        </div>
      </div>`;
  } else if (someMissing && !ok.some((d) => d.configSnapshot)) {
    banner = `
      <div class="border border-stone-200 dark:border-ink-800 bg-stone-50/40 dark:bg-ink-900/40 rounded-md px-4 py-3 flex items-center gap-3">
        ${icon("filter", { size: 14, className: "text-stone-500" })}
        <div class="flex-1">
          <div class="text-[13px] font-medium">Config history unavailable</div>
          <div class="text-[11px] text-stone-500 dark:text-stone-400">These runs predate config snapshotting.</div>
        </div>
      </div>`;
  } else {
    banner = `
      <div class="border border-amber-300/50 dark:border-amber-800/40 bg-amber-50/40 dark:bg-amber-900/10 rounded-md px-4 py-3 flex items-center gap-3">
        ${icon("zap", { size: 16, className: "text-amber-600 dark:text-amber-400" })}
        <div class="flex-1">
          <div class="text-[13px] font-medium text-amber-700 dark:text-amber-300">Configs differ</div>
          <div class="text-[11px] text-amber-700/70 dark:text-amber-400/70">${
            someMissing
              ? "At least one run has no snapshot (predates snapshotting)."
              : "Runs ran against different config content. Comparison may not be apples-to-apples."
          }</div>
        </div>
        <button id="diffOpen" class="text-[11px] px-3 py-1.5 rounded border border-amber-400/60 text-amber-700 dark:text-amber-300 hover:bg-amber-100/60 dark:hover:bg-amber-900/20 transition-colors flex items-center gap-1.5">
          ${icon("file", { size: 12 })}<span>View diff</span>
        </button>
      </div>`;
  }
  el.innerHTML = banner;
  document.getElementById("diffOpen")?.addEventListener("click", () => openDiff(ok));
}

function openDiff(details) {
  const m = document.getElementById("diffModal");
  const body = document.getElementById("diffBody");
  if (!m || !body) return;
  m.classList.remove("hidden");
  m.classList.add("flex");
  const renderConfig = (d) =>
    d.configSnapshot ? JSON.stringify(d.configSnapshot, null, 2) : "(no snapshot)";
  const blobs = details.map(renderConfig);
  const linesByCol = blobs.map((b) => b.split("\n"));
  const maxLines = Math.max(...linesByCol.map((l) => l.length));
  const diffMarks = new Array(maxLines).fill(false);
  for (let i = 0; i < maxLines; i++) {
    const baseline = linesByCol[0][i] ?? null;
    for (let c = 1; c < linesByCol.length; c++) {
      if ((linesByCol[c][i] ?? null) !== baseline) {
        diffMarks[i] = true;
        break;
      }
    }
  }
  const colHeader = (i) =>
    `<div class="px-3 py-2 text-[11px] uppercase tracking-wider font-semibold text-stone-500 dark:text-stone-400 border-b border-stone-200 dark:border-ink-800 sticky top-0 bg-white dark:bg-ink-900 flex items-center gap-2">
      <span class="inline-block w-2.5 h-2.5 rounded-sm" style="background:${runColor(i)}"></span>
      ${String.fromCharCode(65 + i)}${i === 0 ? " (baseline)" : ""}
    </div>`;
  const colBody = (col) =>
    `<pre class="font-mono text-[12px] leading-[1.55] m-0">${linesByCol[col]
      .map((line, i) => {
        const cls = diffMarks[i] ? "bg-amber-100/50 dark:bg-amber-900/15" : "";
        return `<span class="block whitespace-pre px-3 ${cls}"><span class="num text-stone-400 inline-block w-8 mr-3">${i + 1}</span>${escapeHtml(line) || "&nbsp;"}</span>`;
      })
      .join("")}</pre>`;
  const cols = details
    .map(
      (d, i) => `
      <div class="border-r border-stone-200 dark:border-ink-800 last:border-r-0 min-w-0">
        ${colHeader(i)}
        <div>${colBody(i)}</div>
      </div>`,
    )
    .join("");
  body.innerHTML = `
    <div class="grid h-full" style="grid-template-columns: repeat(${details.length}, minmax(0, 1fr));">${cols}</div>`;
}

// ---------- Charts ----------
function initCharts() {
  if (chartsInited) return;
  chartsInited = true;
  charts.rps = makeLineChart("cRps", []);
  charts.p95 = makeLineChart("cP95", []);
  charts.err = makeLineChart("cErr", []);
  charts.vus = makeLineChart("cVus", []);
  memCharts.heap = makeLineChart("cHeap", []);
  memCharts.cpu = makeLineChart("cCpu", []);
  memCharts.eld = makeLineChart("cEld", []);
  memCharts.hnd = makeLineChart("cHnd", []);
}

function drawCharts(ok) {
  const xMax = Math.max(
    ...ok.map((d) => {
      const t = d.ticks || [];
      return t.length ? Math.ceil((t[t.length - 1].t - t[0].t) / 1000) + 1 : 0;
    }),
    1,
  );
  setAxisMax(charts, xMax);
  setAxisMax(memCharts, xMax);

  const buildSets = (accessor) =>
    ok
      .map((d, i) => {
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
          backgroundColor: runColor(i) + "26",
        };
      })
      .filter(Boolean);

  charts.rps.data.datasets = buildSets((t) => t.rps);
  charts.p95.data.datasets = buildSets((t) => Math.round(t.p95));
  charts.err.data.datasets = buildSets((t) => t.errors);
  charts.vus.data.datasets = buildSets((t) => t.vus);

  const heapSets = buildSets((t) => t.memory?.heapMB);
  const hasMem = heapSets.some((s) => s.data.length > 0);
  document.getElementById("memSection").hidden = !hasMem;
  if (hasMem) {
    memCharts.heap.data.datasets = heapSets;
    memCharts.cpu.data.datasets = buildSets((t) => t.memory?.cpuPercent);
    memCharts.eld.data.datasets = buildSets((t) => t.memory?.eldP99);
    memCharts.hnd.data.datasets = buildSets((t) => t.memory?.handles);
  }

  for (const c of Object.values(charts)) c.update();
  for (const c of Object.values(memCharts)) c.update();
}

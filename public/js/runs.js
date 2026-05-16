import { mount, setBreadcrumbs } from "./shell.js";
import { api, escapeHtml, fmtRelTime, fmtSeconds, fmtBytes, sizeTextClass } from "./api.js";
import { icon } from "./icons.js";

let history = [];
let folders = [];
let filters = { folder: "", status: "", q: "" };

mount(async (page) => {
  setBreadcrumbs([{ label: "Runs" }]);
  page.innerHTML = template();
  await refresh();
  bind();
});

function template() {
  return `
    <div class="px-8 py-7 max-w-[1400px] mx-auto">
      <div class="flex items-end justify-between gap-6 mb-6 flex-wrap">
        <div>
          <h1 class="text-[22px] font-semibold tracking-tight">Runs</h1>
          <p class="text-stone-500 dark:text-stone-400 text-[13px] mt-0.5">Every run, across every bucket. Click any row to inspect charts and the full report.</p>
        </div>
        <div class="flex items-center gap-2">
          <div class="relative">
            <span class="absolute left-3 top-1/2 -translate-y-1/2 text-stone-400">${icon("search", { size: 14 })}</span>
            <input id="q" placeholder="Search bucket / config…" class="pl-9 pr-3 py-2 w-[260px] rounded border border-stone-200 dark:border-ink-800 bg-white dark:bg-ink-900 text-[13px] outline-none focus:border-indigo-400 dark:focus:border-indigo-500 transition-colors" />
          </div>
          <select id="folderFilter" class="text-[12px] py-2 px-3 rounded border border-stone-200 dark:border-ink-800 bg-white dark:bg-ink-900 outline-none focus:border-indigo-400 transition-colors">
            <option value="">All buckets</option>
          </select>
          <select id="statusFilter" class="text-[12px] py-2 px-3 rounded border border-stone-200 dark:border-ink-800 bg-white dark:bg-ink-900 outline-none focus:border-indigo-400 transition-colors">
            <option value="">All status</option>
            <option value="completed">Completed</option>
            <option value="failed">Failed</option>
            <option value="stopped">Stopped</option>
            <option value="running">Running</option>
          </select>
          <button id="refreshBtn" class="text-[12px] px-2.5 py-2 rounded border border-stone-200 dark:border-ink-800 hover:border-indigo-400 transition-colors text-stone-500 hover:text-ink-950 dark:hover:text-stone-100" title="Refresh">
            ${icon("refresh", { size: 13 })}
          </button>
        </div>
      </div>

      <div id="counts" class="text-[11px] text-stone-500 mb-3 num"></div>
      <div id="grid" class="border border-stone-200 dark:border-ink-800 rounded-md bg-white dark:bg-ink-900 overflow-hidden"></div>
    </div>`;
}

async function refresh() {
  [history, folders] = await Promise.all([
    api.history().catch(() => []),
    api.folders().catch(() => []),
  ]);
  populateFilters();
  render();
}

function populateFilters() {
  const sel = document.getElementById("folderFilter");
  const cur = sel.value;
  sel.innerHTML = `<option value="">All buckets</option>` + folders
    .map((f) => `<option value="${escapeHtml(f.name)}"${f.name === cur ? " selected" : ""}>${escapeHtml(f.name)}</option>`)
    .join("");
}

function bind() {
  document.getElementById("q").addEventListener("input", (e) => {
    filters.q = e.target.value.trim().toLowerCase();
    render();
  });
  document.getElementById("folderFilter").addEventListener("change", (e) => {
    filters.folder = e.target.value;
    render();
  });
  document.getElementById("statusFilter").addEventListener("change", (e) => {
    filters.status = e.target.value;
    render();
  });
  document.getElementById("refreshBtn").addEventListener("click", refresh);
}

function render() {
  const filtered = history.filter((r) => {
    if (filters.folder && r.bucket !== filters.folder) return false;
    if (filters.status && r.status !== filters.status) return false;
    if (filters.q) {
      const hay = `${r.bucket || ""} ${r.configRel || ""} ${r.id || ""}`.toLowerCase();
      if (!hay.includes(filters.q)) return false;
    }
    return true;
  });
  document.getElementById("counts").textContent =
    `${filtered.length} of ${history.length} runs`;

  const grid = document.getElementById("grid");
  if (filtered.length === 0) {
    grid.innerHTML = `<div class="empty-state text-stone-500 dark:text-stone-400 text-[13px]">No runs match the filters.</div>`;
    return;
  }
  grid.innerHTML = `
    <table class="w-full text-[13px]">
      <thead>
        <tr class="text-left text-[10px] uppercase tracking-wider text-stone-500 dark:text-stone-400 border-b border-stone-100 dark:border-ink-800 sticky top-0 bg-white dark:bg-ink-900">
          <th class="px-5 py-2.5 font-medium">Started</th>
          <th class="px-5 py-2.5 font-medium">Bucket</th>
          <th class="px-5 py-2.5 font-medium">Config</th>
          <th class="px-5 py-2.5 font-medium">Status</th>
          <th class="px-5 py-2.5 font-medium num text-right">Duration</th>
          <th class="px-5 py-2.5 font-medium num text-right">Reqs</th>
          <th class="px-5 py-2.5 font-medium num text-right">RPS</th>
          <th class="px-5 py-2.5 font-medium num text-right">p95</th>
          <th class="px-5 py-2.5 font-medium num text-right">Errors</th>
          <th class="px-5 py-2.5 font-medium num text-right">Size</th>
          <th class="px-5 py-2.5 font-medium"></th>
        </tr>
      </thead>
      <tbody>${filtered.map(row).join("")}</tbody>
    </table>`;

  grid.querySelectorAll("[data-runrow]").forEach((tr) => {
    tr.addEventListener("click", () => {
      const { bucket, configdir, id } = tr.dataset;
      location.href = `/run/${encodeURIComponent(bucket)}/${encodeURIComponent(configdir)}/${encodeURIComponent(id)}`;
    });
  });
  grid.querySelectorAll("[data-del]").forEach((b) => {
    b.addEventListener("click", async (e) => {
      e.stopPropagation();
      const { bucket, configdir, id } = b.dataset;
      if (!confirm("Delete this run?")) return;
      await api.deleteRun(bucket, configdir, id);
      await refresh();
    });
  });
}

function row(r) {
  const stats = r.stats || {};
  const dur = r.startedAt && r.endedAt ? fmtSeconds((r.endedAt - r.startedAt) / 1000) : "—";
  return `
    <tr data-runrow data-bucket="${escapeHtml(r.bucket)}" data-configdir="${escapeHtml(r.configDir)}" data-id="${escapeHtml(r.id)}" class="cursor-pointer border-b border-stone-100 dark:border-ink-800 hover:bg-stone-50 dark:hover:bg-ink-800/40 transition-colors">
      <td class="px-5 py-3 num text-stone-500 dark:text-stone-400" title="${escapeHtml(r.endedAt ? new Date(r.endedAt).toLocaleString() : "")}">${escapeHtml(r.startedAt ? new Date(r.startedAt).toLocaleString() : "—")}</td>
      <td class="px-5 py-3"><span class="font-medium">${escapeHtml(r.bucket)}</span></td>
      <td class="px-5 py-3 font-mono text-[12px] text-stone-600 dark:text-stone-300">${escapeHtml(r.configRel || r.configDir)}</td>
      <td class="px-5 py-3">${statusTag(r.status)}</td>
      <td class="px-5 py-3 num text-right">${dur}</td>
      <td class="px-5 py-3 num text-right">${stats.requests ?? "—"}</td>
      <td class="px-5 py-3 num text-right">${stats.rps ? stats.rps.toFixed(1) : "—"}</td>
      <td class="px-5 py-3 num text-right">${stats.p95 ? stats.p95.toFixed(1) : "—"}</td>
      <td class="px-5 py-3 num text-right ${stats.errors ? "text-rose-500" : ""}">${stats.errors ?? "—"}</td>
      <td class="px-5 py-3 num text-right ${sizeTextClass(r.sizeBytes)}" title="${escapeHtml(r.sizeBytes ? r.sizeBytes.toLocaleString() + " bytes" : "")}">${fmtBytes(r.sizeBytes)}</td>
      <td class="px-5 py-3 text-right">
        <button data-del data-bucket="${escapeHtml(r.bucket)}" data-configdir="${escapeHtml(r.configDir)}" data-id="${escapeHtml(r.id)}" class="text-stone-300 dark:text-ink-700 hover:text-rose-500 transition-colors" title="Delete run">
          ${icon("trash", { size: 13 })}
        </button>
      </td>
    </tr>`;
}

function statusTag(status) {
  const map = {
    completed: ["bg-emerald-500/10", "text-emerald-600 dark:text-emerald-400"],
    failed: ["bg-rose-500/10", "text-rose-600 dark:text-rose-400"],
    stopped: ["bg-amber-500/10", "text-amber-600 dark:text-amber-400"],
    running: ["bg-indigo-500/10", "text-indigo-600 dark:text-indigo-400 pulse"],
  };
  const [bg, fg] = map[status] || ["bg-stone-500/10", "text-stone-500"];
  return `<span class="tag ${bg} ${fg}">${escapeHtml(status || "?")}</span>`;
}

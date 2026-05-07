import { mount, setBreadcrumbs } from "./shell.js";
import { api, escapeHtml, fmtRelTime, fmtSeconds, totalDurationSec } from "./api.js";
import { icon } from "./icons.js";
import { sparkline } from "./sparkline.js";

const bucket = decodeURIComponent(location.pathname.replace(/^\/bucket\//, ""));

let folders = [];
let folder = null;
let history = [];
// Initial tab from URL hash (#runs / #configs / #files), default to configs.
const HASH_TABS = new Set(["configs", "files", "runs"]);
const initialHash = (location.hash || "").replace(/^#/, "");
let activeTab = HASH_TABS.has(initialHash) ? initialHash : "configs";

mount(async (page) => {
  setBreadcrumbs([
    { label: "Buckets", href: "/buckets" },
    { label: bucket || "—" },
  ]);
  page.innerHTML = template();

  await refresh();
  bindActions();
});

function template() {
  return `
    <div class="px-8 py-7 max-w-[1400px] mx-auto">
      <div class="flex items-end justify-between gap-6 mb-6">
        <div class="min-w-0">
          <div class="text-[11px] uppercase tracking-wider text-stone-400">Bucket</div>
          <h1 class="text-[24px] font-semibold tracking-tight truncate">${escapeHtml(bucket)}</h1>
          <div id="bucketMeta" class="text-[12px] text-stone-500 dark:text-stone-400 num mt-1">—</div>
        </div>
        <div class="flex items-center gap-2 shrink-0">
          <label class="text-[12px] px-3 py-2 rounded border border-stone-200 dark:border-ink-800 hover:border-indigo-400 dark:hover:border-indigo-500 transition-colors flex items-center gap-2 cursor-pointer">
            ${icon("file", { size: 13 })}<span>Upload files</span>
            <input id="uploadFiles" type="file" accept=".json,application/json" multiple hidden />
          </label>
          <label class="text-[12px] px-3 py-2 rounded border border-stone-200 dark:border-ink-800 hover:border-indigo-400 dark:hover:border-indigo-500 transition-colors flex items-center gap-2 cursor-pointer">
            ${icon("upload", { size: 13 })}<span>Upload folder</span>
            <input id="uploadFolder" type="file" webkitdirectory directory multiple hidden />
          </label>
          <button id="deleteBucket" title="Delete bucket" class="text-[12px] px-3 py-2 rounded border border-stone-200 dark:border-ink-800 hover:border-rose-400 hover:text-rose-500 transition-colors">
            ${icon("trash", { size: 13 })}
          </button>
        </div>
      </div>

      <div class="border-b border-stone-200 dark:border-ink-800 mb-5">
        <nav id="tabsBar" class="tabs-bar flex gap-6 text-[13px]">
          <button data-tab="configs" class="py-2.5 transition-colors hover:text-ink-950 dark:hover:text-stone-100">Configs</button>
          <button data-tab="files" class="py-2.5 transition-colors hover:text-ink-950 dark:hover:text-stone-100">Files</button>
          <button data-tab="runs" class="py-2.5 transition-colors hover:text-ink-950 dark:hover:text-stone-100">Runs</button>
          <span class="tab-indicator text-indigo-500"></span>
        </nav>
      </div>

      <div id="tabContent"></div>
    </div>`;
}

async function refresh() {
  [folders, history] = await Promise.all([
    api.folders().catch(() => []),
    api.history(bucket).catch(() => []),
  ]);
  folder = folders.find((f) => f.name === bucket);
  if (!folder) {
    document.getElementById("tabContent").innerHTML = `
      <div class="empty-state">
        <div class="text-[14px] font-medium">Bucket not found</div>
        <a href="/buckets" class="text-[12px] text-indigo-500 hover:text-indigo-400">Back to buckets</a>
      </div>`;
    return;
  }
  renderMeta();
  setActiveTab(activeTab);
}

function renderMeta() {
  document.getElementById("bucketMeta").textContent =
    `${(folder.configs || []).length} configs · ${folder.fileCount} file${folder.fileCount === 1 ? "" : "s"} · ${history.length} run${history.length === 1 ? "" : "s"}`;
}

function bindActions() {
  document.getElementById("uploadFiles").addEventListener("change", (e) => onUpload(e, false));
  document.getElementById("uploadFolder").addEventListener("change", (e) => onUpload(e, true));
  document.getElementById("deleteBucket").addEventListener("click", async () => {
    if (!confirm(`Delete bucket "${bucket}" and all its files and runs?`)) return;
    await api.deleteFolder(bucket);
    location.href = "/buckets";
  });
  document.querySelectorAll("#tabsBar [data-tab]").forEach((b) =>
    b.addEventListener("click", () => setActiveTab(b.dataset.tab)),
  );
}

function setActiveTab(tab) {
  activeTab = tab;
  // Reflect into URL so deep links and back-button respect the chosen tab.
  if (location.hash !== "#" + tab) {
    window.history.replaceState({}, "", `${location.pathname}${location.search}#${tab}`);
  }
  // Highlight active tab + slide indicator.
  const bar = document.getElementById("tabsBar");
  const buttons = bar.querySelectorAll("[data-tab]");
  buttons.forEach((b) => {
    const on = b.dataset.tab === tab;
    b.classList.toggle("text-ink-950", on);
    b.classList.toggle("dark:text-stone-100", on);
    b.classList.toggle("font-medium", on);
    b.classList.toggle("text-stone-500", !on);
    b.classList.toggle("dark:text-stone-400", !on);
  });
  const active = bar.querySelector(`[data-tab="${tab}"]`);
  const indicator = bar.querySelector(".tab-indicator");
  if (active && indicator) {
    indicator.style.left = active.offsetLeft + "px";
    indicator.style.width = active.offsetWidth + "px";
  }
  if (tab === "configs") renderConfigsTab();
  else if (tab === "files") renderFilesTab();
  else renderRunsTab();
}

// ---------- Tab: Configs ----------
async function renderConfigsTab() {
  const c = document.getElementById("tabContent");
  if (!folder.configs.length) {
    c.innerHTML = `
      <div class="empty-state">
        <svg width="120" height="80" viewBox="0 0 120 80" fill="none" stroke="currentColor" stroke-width="1.5" class="text-stone-400">
          <path d="M28 18h36l8 8v36a2 2 0 0 1-2 2H28a2 2 0 0 1-2-2V20a2 2 0 0 1 2-2z"/>
          <path d="M64 18v8h8"/>
          <line x1="34" y1="38" x2="58" y2="38"/>
          <line x1="34" y1="46" x2="50" y2="46"/>
        </svg>
        <div class="text-[14px] font-medium">No configs yet</div>
        <div class="text-[12px] text-stone-500 dark:text-stone-400 max-w-sm text-center">Upload a JSON config (or a folder of configs + payloads). Any JSON with an <span class="font-mono">endpoints[]</span> array becomes runnable.</div>
      </div>`;
    return;
  }

  c.innerHTML = `
    <div class="border border-stone-200 dark:border-ink-800 rounded-md bg-white dark:bg-ink-900 overflow-hidden">
      <table class="w-full text-[13px]">
        <thead>
          <tr class="text-left text-[10px] uppercase tracking-wider text-stone-500 dark:text-stone-400 border-b border-stone-100 dark:border-ink-800">
            <th class="px-5 py-2.5 font-medium">Config</th>
            <th class="px-5 py-2.5 font-medium">Executor</th>
            <th class="px-5 py-2.5 font-medium">Duration</th>
            <th class="px-5 py-2.5 font-medium">Last run</th>
            <th class="px-5 py-2.5 font-medium text-right"></th>
          </tr>
        </thead>
        <tbody id="cfgRows"></tbody>
      </table>
    </div>`;

  // Lazy-load each config to display executor/duration.
  const tbody = document.getElementById("cfgRows");
  for (const c of folder.configs) {
    const row = document.createElement("tr");
    row.className = "border-b border-stone-100 dark:border-ink-800 hover:bg-stone-50 dark:hover:bg-ink-800/40 transition-colors pop-in";
    row.innerHTML = `
      <td class="px-5 py-3 font-mono text-[12px]">${escapeHtml(c.path)}</td>
      <td class="px-5 py-3 text-stone-500 dark:text-stone-400">…</td>
      <td class="px-5 py-3 text-stone-500 dark:text-stone-400 num">…</td>
      <td class="px-5 py-3 text-stone-500 dark:text-stone-400 num">${lastRunText(c.path)}</td>
      <td class="px-5 py-3 text-right">
        <button data-cfg="${escapeHtml(c.path)}" class="run-btn text-[12px] px-3 py-1.5 rounded border border-indigo-500 bg-indigo-500 text-white hover:bg-indigo-600 transition-colors inline-flex items-center gap-1.5">
          ${icon("play", { size: 12 })}<span>Run</span>
        </button>
      </td>`;
    tbody.appendChild(row);
    api
      .readFile(bucket, c.path)
      .then((cfg) => {
        const tds = row.children;
        tds[1].textContent = cfg.executor || "ramping-vus";
        const total = totalDurationSec(cfg);
        tds[2].textContent = total ? fmtSeconds(total) : "—";
      })
      .catch(() => {});
    row.querySelector(".run-btn").addEventListener("click", (e) => {
      e.stopPropagation();
      onStartRun(c.path);
    });
  }
}

function lastRunText(configPath) {
  const last = history.find((r) => r.configRel === configPath);
  if (!last) return "—";
  return `${fmtRelTime(last.startedAt)} · ${last.status || "—"}`;
}

async function onStartRun(configRel) {
  // Open a small modal-ish prompt for the target URL.
  const last = history.find((r) => r.configRel === configRel);
  const target = prompt(`Start "${configRel}"\n\nTarget URL`, last?.target || "http://localhost:8080");
  if (target === null) return;
  try {
    const run = await api.startRun({ folder: bucket, config: configRel, target: target.trim() || undefined });
    location.href = `/run/${encodeURIComponent(run.bucket)}/${encodeURIComponent(run.configDir)}/${encodeURIComponent(run.id)}`;
  } catch (e) {
    alert(`Could not start run: ${e.message}`);
  }
}

// ---------- Tab: Files (browseable tree) ----------
async function renderFilesTab() {
  const c = document.getElementById("tabContent");
  c.innerHTML = `<div class="text-[12px] text-stone-500">Loading file tree…</div>`;
  // We don't have a tree endpoint, but we have folder.configs + folder.fileCount.
  // For browseability, we'll show known config paths grouped by directory.
  const tree = buildTreeFromConfigs(folder.configs.map((c) => c.path));
  c.innerHTML = `
    <div class="border border-stone-200 dark:border-ink-800 rounded-md bg-white dark:bg-ink-900 overflow-hidden">
      <header class="px-5 h-11 flex items-center justify-between border-b border-stone-100 dark:border-ink-800">
        <div class="text-[12px] uppercase tracking-wider text-stone-500 dark:text-stone-400 font-semibold">Files (configs detected)</div>
        <div class="text-[11px] text-stone-500 num">${folder.fileCount} total in this bucket</div>
      </header>
      <div class="p-3 font-mono text-[12px]">${renderTree(tree, 0)}</div>
      <div class="px-5 py-3 border-t border-stone-100 dark:border-ink-800 text-[11px] text-stone-500">
        File browser only enumerates JSON configs at the moment. Other files (payload bodies, etc.) are present but not listed here.
      </div>
    </div>`;
}

function buildTreeFromConfigs(paths) {
  const root = {};
  for (const p of paths) {
    const parts = p.split("/");
    let node = root;
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      const isLeaf = i === parts.length - 1;
      if (!node[part]) node[part] = isLeaf ? "file" : {};
      if (!isLeaf) node = node[part];
    }
  }
  return root;
}

function renderTree(node, depth) {
  const entries = Object.entries(node).sort(([a, av], [b, bv]) => {
    const aDir = typeof av === "object";
    const bDir = typeof bv === "object";
    if (aDir !== bDir) return aDir ? -1 : 1;
    return a.localeCompare(b);
  });
  return entries
    .map(([name, val]) => {
      const isDir = typeof val === "object";
      const indent = depth * 18;
      return `
        <div class="flex items-center gap-2 py-1 hover:bg-stone-50 dark:hover:bg-ink-800/40 transition-colors rounded-sm px-2" style="padding-left:${indent + 8}px">
          ${icon(isDir ? "folder" : "file", { size: 13, className: isDir ? "text-warm-500" : "text-stone-400" })}
          <span class="${isDir ? "text-stone-700 dark:text-stone-300" : "text-stone-600 dark:text-stone-400"}">${escapeHtml(name)}</span>
        </div>
        ${isDir ? renderTree(val, depth + 1) : ""}`;
    })
    .join("");
}

// ---------- Tab: Runs ----------
async function renderRunsTab() {
  const c = document.getElementById("tabContent");
  if (history.length === 0) {
    c.innerHTML = `
      <div class="empty-state">
        <div class="text-[13px] text-stone-500 dark:text-stone-400">No runs yet for this bucket.</div>
      </div>`;
    return;
  }
  c.innerHTML = `
    <div class="border border-stone-200 dark:border-ink-800 rounded-md bg-white dark:bg-ink-900 overflow-hidden">
      <table class="w-full text-[13px]">
        <thead>
          <tr class="text-left text-[10px] uppercase tracking-wider text-stone-500 dark:text-stone-400 border-b border-stone-100 dark:border-ink-800">
            <th class="px-5 py-2.5 font-medium">Started</th>
            <th class="px-5 py-2.5 font-medium">Config</th>
            <th class="px-5 py-2.5 font-medium">Status</th>
            <th class="px-5 py-2.5 font-medium num text-right">Reqs</th>
            <th class="px-5 py-2.5 font-medium num text-right">RPS</th>
            <th class="px-5 py-2.5 font-medium num text-right">p95</th>
            <th class="px-5 py-2.5 font-medium num text-right">Errors</th>
          </tr>
        </thead>
        <tbody>
          ${history.map((r) => runRow(r)).join("")}
        </tbody>
      </table>
    </div>`;
}

function runRow(r) {
  const stats = r.stats || {};
  return `
    <tr onclick="location.href='/run/${encodeURIComponent(r.bucket)}/${encodeURIComponent(r.configDir)}/${encodeURIComponent(r.id)}'" class="cursor-pointer border-b border-stone-100 dark:border-ink-800 hover:bg-stone-50 dark:hover:bg-ink-800/40 transition-colors">
      <td class="px-5 py-3 num text-stone-500 dark:text-stone-400">${escapeHtml(r.startedAt ? new Date(r.startedAt).toLocaleString() : "—")}</td>
      <td class="px-5 py-3 font-mono text-[12px]">${escapeHtml(r.configRel || r.configDir)}</td>
      <td class="px-5 py-3">${statusTag(r.status)}</td>
      <td class="px-5 py-3 num text-right">${stats.requests ?? "—"}</td>
      <td class="px-5 py-3 num text-right">${stats.rps ? stats.rps.toFixed(1) : "—"}</td>
      <td class="px-5 py-3 num text-right">${stats.p95 ? stats.p95.toFixed(1) : "—"}</td>
      <td class="px-5 py-3 num text-right ${stats.errors ? "text-rose-500" : ""}">${stats.errors ?? "—"}</td>
    </tr>`;
}

function statusTag(status) {
  const map = {
    completed: ["bg-emerald-500/10", "text-emerald-600 dark:text-emerald-400"],
    failed: ["bg-rose-500/10", "text-rose-600 dark:text-rose-400"],
    stopped: ["bg-amber-500/10", "text-amber-600 dark:text-amber-400"],
    running: ["bg-indigo-500/10", "text-indigo-600 dark:text-indigo-400"],
  };
  const [bg, fg] = map[status] || ["bg-stone-500/10", "text-stone-500"];
  return `<span class="tag ${bg} ${fg}">${escapeHtml(status || "?")}</span>`;
}

// ---------- Upload (merge into bucket) ----------
async function onUpload(e, isFolder) {
  const fileList = Array.from(e.target.files || []);
  if (fileList.length === 0) return;
  const files = [];
  for (const f of fileList) {
    const rel = isFolder ? f.webkitRelativePath || f.name : f.name;
    if (!rel || rel.includes(".DS_Store") || rel.startsWith("__MACOSX/")) continue;
    if (f.size > 30 * 1024 * 1024) {
      alert(`Skipping ${rel}: file is over 30MB`);
      continue;
    }
    const content = await f.text();
    files.push({ path: rel, content });
  }
  if (files.length === 0) return;
  e.target.value = "";
  try {
    await api.uploadFiles(bucket, files);
    await refresh();
  } catch (err) {
    alert(`Upload failed: ${err.message}`);
  }
}

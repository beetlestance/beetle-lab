import { mount, setBreadcrumbs } from "./shell.js";
import { api, escapeHtml, fmtRelTime } from "./api.js";
import { icon } from "./icons.js";
import { sparkline } from "./sparkline.js";

let folders = [];
let history = [];
let query = "";

mount(async (page) => {
  setBreadcrumbs([{ label: "Buckets" }]);
  page.innerHTML = template();

  document.getElementById("newBucketBtn").addEventListener("click", onNewBucket);
  document.getElementById("searchInput").addEventListener("input", (e) => {
    query = e.target.value.trim().toLowerCase();
    render();
  });

  await refresh();
});

function template() {
  return `
    <div class="px-8 py-7 max-w-[1400px] mx-auto">
      <div class="flex items-end justify-between mb-6 gap-6 flex-wrap">
        <div class="min-w-0">
          <h1 class="text-[22px] font-semibold tracking-tight">Buckets</h1>
          <p class="text-stone-500 dark:text-stone-400 text-[13px] mt-0.5">Each bucket holds a project's configs, payloads, and run history.</p>
        </div>
        <div class="flex items-center gap-2">
          <div class="relative">
            <span class="absolute left-3 top-1/2 -translate-y-1/2 text-stone-400">${icon("search", { size: 14 })}</span>
            <input id="searchInput" placeholder="Search buckets…" class="pl-9 pr-3 py-2 w-[260px] rounded border border-stone-200 dark:border-ink-800 bg-white dark:bg-ink-900 text-[13px] outline-none focus:border-indigo-400 dark:focus:border-indigo-500 transition-colors" />
          </div>
          <button id="newBucketBtn" class="text-[12px] px-3 py-2 rounded border border-indigo-500 bg-indigo-500 text-white hover:bg-indigo-600 transition-colors flex items-center gap-2">
            ${icon("plus", { size: 13 })}<span>New bucket</span>
          </button>
        </div>
      </div>
      <div id="grid"></div>
    </div>`;
}

async function refresh() {
  [folders, history] = await Promise.all([
    api.folders().catch(() => []),
    api.history().catch(() => []),
  ]);
  render();
}

function render() {
  const grid = document.getElementById("grid");
  const filtered = folders.filter((f) =>
    !query ? true : f.name.toLowerCase().includes(query),
  );
  if (folders.length === 0) {
    grid.innerHTML = emptyState();
    return;
  }
  if (filtered.length === 0) {
    grid.innerHTML = `<div class="empty-state text-stone-500 dark:text-stone-400 text-[13px]">No buckets match "${escapeHtml(query)}".</div>`;
    return;
  }
  grid.innerHTML = `
    <div class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
      ${filtered.map((f, i) => bucketCard(f, history, i)).join("")}
    </div>`;
  // Wire delete buttons.
  grid.querySelectorAll("[data-del]").forEach((btn) => {
    btn.addEventListener("click", async (e) => {
      e.preventDefault();
      e.stopPropagation();
      const name = btn.dataset.del;
      if (!confirm(`Delete bucket "${name}" and all its files and runs?`)) return;
      await api.deleteFolder(name);
      await refresh();
    });
  });
}

function bucketCard(f, history, idx) {
  const bucketRuns = history.filter((r) => r.bucket === f.name);
  const last = bucketRuns[0];
  // Sparkline: count of runs per hour over last 24h
  const buckets = new Array(24).fill(0);
  const now = Date.now();
  for (const r of bucketRuns) {
    if (!r.startedAt) continue;
    const h = Math.floor((now - r.startedAt) / 3600000);
    if (h >= 0 && h < 24) buckets[23 - h] += 1;
  }
  const totalRuns = bucketRuns.length;
  const failRate =
    bucketRuns.length === 0
      ? 0
      : bucketRuns.filter((r) => r.status === "failed").length / bucketRuns.length;
  const accentClass = failRate > 0.2 ? "text-rose-500" : "text-indigo-500";

  return `
    <a href="/bucket/${encodeURIComponent(f.name)}" class="block border border-stone-200 dark:border-ink-800 rounded-md bg-white dark:bg-ink-900 hover:border-indigo-300 dark:hover:border-indigo-700 transition-colors overflow-hidden group" style="animation-delay:${idx * 25}ms">
      <div class="px-5 pt-4 pb-3 flex items-start justify-between gap-3">
        <div class="min-w-0 flex-1">
          <div class="font-semibold tracking-tight text-[15px] truncate">${escapeHtml(f.name)}</div>
          <div class="text-[11px] text-stone-500 dark:text-stone-400 mt-0.5 num">
            ${(f.configs || []).length} cfg · ${f.fileCount} file${f.fileCount === 1 ? "" : "s"}${
              totalRuns ? ` · ${totalRuns} run${totalRuns === 1 ? "" : "s"}` : ""
            }
          </div>
        </div>
        <button data-del="${escapeHtml(f.name)}" title="Delete bucket" class="text-stone-300 dark:text-ink-700 hover:text-rose-500 dark:hover:text-rose-400 opacity-0 group-hover:opacity-100 transition-opacity">
          ${icon("trash", { size: 14 })}
        </button>
      </div>
      <div class="px-5 pb-4">
        ${
          (f.configs || []).slice(0, 3).map((c) =>
            `<div class="flex items-center gap-2 text-[12px] py-1 text-stone-600 dark:text-stone-400 truncate">
              <span class="w-1 h-1 bg-stone-400 dark:bg-ink-700"></span>
              <span class="truncate">${escapeHtml(c.path)}</span>
            </div>`
          ).join("") ||
          `<div class="text-[12px] text-stone-400 italic py-1">No configs yet.</div>`
        }
        ${
          (f.configs || []).length > 3
            ? `<div class="text-[11px] text-stone-400 mt-1">+ ${(f.configs || []).length - 3} more</div>`
            : ""
        }
      </div>
      <div class="px-5 py-3 border-t border-stone-100 dark:border-ink-800 flex items-center justify-between">
        <div class="${accentClass}">${sparkline(buckets, { width: 90, height: 22 })}</div>
        <div class="text-[11px] text-stone-500 dark:text-stone-400 num">
          ${last ? `${escapeHtml(fmtRelTime(last.startedAt))} · ${escapeHtml(last.status || "—")}` : "no runs"}
        </div>
      </div>
    </a>`;
}

async function onNewBucket() {
  const name = prompt("Bucket name");
  if (!name || !name.trim()) return;
  try {
    await api.createFolder(name.trim());
    await refresh();
  } catch (e) {
    alert(`Could not create bucket: ${e.message}`);
  }
}

function emptyState() {
  return `
    <div class="empty-state">
      <svg width="120" height="80" viewBox="0 0 120 80" fill="none" stroke="currentColor" stroke-width="1.5" class="text-stone-400">
        <rect x="14" y="20" width="36" height="48" rx="2"/>
        <rect x="56" y="28" width="36" height="40" rx="2"/>
        <rect x="98" y="36" width="14" height="32" rx="2"/>
        <line x1="14" y1="76" x2="112" y2="76"/>
        <line x1="22" y1="32" x2="42" y2="32"/>
        <line x1="22" y1="40" x2="36" y2="40"/>
      </svg>
      <div class="text-[14px] font-medium">No buckets yet</div>
      <div class="text-[12px] text-stone-500 dark:text-stone-400 max-w-sm text-center">A bucket holds a project's configs and payload files. Create one to get started.</div>
      <button onclick="document.getElementById('newBucketBtn').click()" class="mt-2 text-[12px] px-3 py-2 rounded border border-indigo-500 bg-indigo-500 text-white hover:bg-indigo-600 transition-colors flex items-center gap-2">
        ${icon("plus", { size: 13 })}<span>New bucket</span>
      </button>
    </div>`;
}

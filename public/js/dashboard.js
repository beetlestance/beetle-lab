import { mount, setBreadcrumbs } from "./shell.js";
import { api, escapeHtml, fmtRelTime, reportUrl } from "./api.js";
import { icon } from "./icons.js";
import { sparkline } from "./sparkline.js";

mount(async (page) => {
  setBreadcrumbs([{ label: "Dashboard" }]);
  page.innerHTML = template();

  const [folders, history, liveRuns] = await Promise.all([
    api.folders().catch(() => []),
    api.history().catch(() => []),
    api.liveRuns().catch(() => []),
  ]);

  renderStats(folders, history, liveRuns);
  renderActivity(history);
  renderRecent(history);
  renderRunningRuns(liveRuns);
});

function template() {
  return `
    <div class="px-8 py-7 max-w-[1400px] mx-auto">
      <div class="flex items-end justify-between mb-7">
        <div>
          <h1 class="text-[22px] font-semibold tracking-tight">Overview</h1>
          <p class="text-stone-500 dark:text-stone-400 text-[13px] mt-0.5">Load test buckets, recent runs, and what's running right now.</p>
        </div>
        <a href="/buckets" class="text-[12px] px-3 py-2 rounded border border-stone-200 dark:border-ink-800 hover:border-indigo-400 dark:hover:border-indigo-500 transition-colors flex items-center gap-2">
          ${icon("plus", { size: 13 })}<span>New bucket</span>
        </a>
      </div>

      <div id="stats" class="grid grid-cols-2 md:grid-cols-4 gap-3 mb-8"></div>

      <section id="running" class="mb-8" hidden></section>

      <div class="grid lg:grid-cols-3 gap-5 mb-8">
        <div class="lg:col-span-2 border border-stone-200 dark:border-ink-800 rounded-md bg-white dark:bg-ink-900">
          <header class="px-5 h-12 flex items-center justify-between border-b border-stone-100 dark:border-ink-800">
            <h2 class="text-[12px] uppercase tracking-wider text-stone-500 dark:text-stone-400 font-semibold">Recent runs</h2>
            <a href="/runs" class="text-[11px] text-indigo-500 hover:text-indigo-400">View all →</a>
          </header>
          <div id="recent"></div>
        </div>
        <div class="border border-stone-200 dark:border-ink-800 rounded-md bg-white dark:bg-ink-900">
          <header class="px-5 h-12 flex items-center border-b border-stone-100 dark:border-ink-800">
            <h2 class="text-[12px] uppercase tracking-wider text-stone-500 dark:text-stone-400 font-semibold">Activity (24h)</h2>
          </header>
          <div id="activity" class="p-5"></div>
        </div>
      </div>
    </div>`;
}

function statCard(label, value, hint, accent = "indigo") {
  return `
    <div class="border border-stone-200 dark:border-ink-800 rounded-md bg-white dark:bg-ink-900 p-4 relative overflow-hidden">
      <div class="absolute inset-y-0 left-0 w-[3px] bg-${accent}-500"></div>
      <div class="text-[10px] uppercase tracking-wider text-stone-500 dark:text-stone-400 font-medium">${escapeHtml(label)}</div>
      <div class="num text-[26px] font-semibold mt-1.5 tracking-tight">${escapeHtml(String(value))}</div>
      ${hint ? `<div class="text-[11px] text-stone-500 dark:text-stone-500 mt-1">${escapeHtml(hint)}</div>` : ""}
    </div>`;
}

function renderStats(folders, history, liveRuns) {
  const totalConfigs = folders.reduce((s, f) => s + (f.configs || []).length, 0);
  const today = Date.now() - 86400000;
  const last24h = history.filter((r) => (r.startedAt || 0) >= today).length;
  const failed24 = history.filter((r) => (r.startedAt || 0) >= today && r.status === "failed").length;
  const running = liveRuns.filter((r) => r.status === "running").length;
  document.getElementById("stats").innerHTML =
    statCard("Buckets", folders.length, `${totalConfigs} configs total`, "indigo") +
    statCard("Runs (24h)", last24h, history.length ? `${history.length} all-time` : "no runs yet", "warm") +
    statCard("Failed (24h)", failed24, failed24 ? "needs attention" : "none", failed24 ? "rose" : "emerald") +
    statCard("Running now", running, running ? "live" : "idle", running ? "emerald" : "stone");
}

function renderActivity(history) {
  const buckets = new Array(24).fill(0);
  const now = Date.now();
  for (const r of history) {
    if (!r.startedAt) continue;
    const hoursAgo = Math.floor((now - r.startedAt) / 3600000);
    if (hoursAgo >= 0 && hoursAgo < 24) buckets[23 - hoursAgo] += 1;
  }
  const max = Math.max(1, ...buckets);
  const bars = buckets
    .map((v, i) => {
      const h = 6 + (v / max) * 64;
      return `<div title="${v} run${v === 1 ? "" : "s"}, ${24 - i}h ago" class="flex-1 bg-indigo-500/80 hover:bg-indigo-400 transition-colors rounded-sm" style="height:${h}px"></div>`;
    })
    .join("");
  document.getElementById("activity").innerHTML = `
    <div class="h-[80px] flex items-end gap-[3px]">${bars}</div>
    <div class="flex justify-between text-[10px] text-stone-400 mt-2 num">
      <span>24h ago</span><span>now</span>
    </div>`;
}

function renderRecent(history) {
  const recent = history.slice(0, 8);
  if (recent.length === 0) {
    document.getElementById("recent").innerHTML = `
      <div class="empty-state">
        ${emptyArt()}
        <div class="text-[13px] text-stone-500 dark:text-stone-400">No runs yet. Create a bucket and start one.</div>
      </div>`;
    return;
  }
  const rows = recent
    .map((r) => {
      const stats = r.stats || {};
      return `
        <a href="/run/${encodeURIComponent(r.bucket)}/${encodeURIComponent(r.configDir)}/${encodeURIComponent(r.id)}" class="grid grid-cols-[auto_1fr_auto_auto_auto] gap-4 items-center px-5 py-3 border-b border-stone-100 dark:border-ink-800 hover:bg-stone-50 dark:hover:bg-ink-800/40 transition-colors">
          ${statusIndicator(r.status)}
          <div class="min-w-0">
            <div class="text-[13px] font-medium truncate">${escapeHtml(r.configRel || r.configDir)}</div>
            <div class="text-[11px] text-stone-500 dark:text-stone-400 truncate">${escapeHtml(r.bucket)}</div>
          </div>
          <div class="text-[11px] text-stone-500 dark:text-stone-400 num">${escapeHtml(fmtRelTime(r.startedAt))}</div>
          <div class="text-[11px] num text-stone-600 dark:text-stone-300">${stats.requests ?? "—"} req</div>
          <div class="text-[11px] num text-stone-600 dark:text-stone-300">p95 ${stats.p95 ? stats.p95.toFixed(1) + "ms" : "—"}</div>
        </a>`;
    })
    .join("");
  document.getElementById("recent").innerHTML = rows;
}

function renderRunningRuns(liveRuns) {
  const running = liveRuns.filter((r) => r.status === "running");
  if (running.length === 0) return;
  const el = document.getElementById("running");
  el.hidden = false;
  el.innerHTML = `
    <div class="border border-emerald-300/40 dark:border-emerald-700/40 bg-emerald-50/40 dark:bg-emerald-900/10 rounded-md">
      <header class="px-5 h-11 flex items-center justify-between border-b border-emerald-200/40 dark:border-emerald-800/40">
        <div class="flex items-center gap-2 text-[12px] uppercase tracking-wider text-emerald-700 dark:text-emerald-400 font-semibold">
          <span class="w-2 h-2 rounded-full bg-emerald-500 pulse"></span> Running now
        </div>
        <span class="text-[11px] text-emerald-700/70 dark:text-emerald-400/70">${running.length} active</span>
      </header>
      ${running
        .map(
          (r) => `
        <a href="/run/${encodeURIComponent(r.bucket)}/${encodeURIComponent(r.configDir || "")}/${encodeURIComponent(r.id)}" class="flex items-center gap-3 px-5 py-3 hover:bg-emerald-50 dark:hover:bg-emerald-900/20 transition-colors">
          <span class="status-square text-emerald-500"></span>
          <div class="min-w-0 flex-1">
            <div class="text-[13px] font-medium truncate">${escapeHtml(r.configRel || "")}</div>
            <div class="text-[11px] text-stone-500 dark:text-stone-400">${escapeHtml(r.bucket || "")}</div>
          </div>
          <span class="text-[11px] text-stone-500 num">${escapeHtml(fmtRelTime(r.startedAt))}</span>
        </a>`,
        )
        .join("")}
    </div>`;
}

function statusIndicator(status) {
  const map = {
    completed: "text-emerald-500",
    failed: "text-rose-500",
    stopped: "text-amber-500",
    running: "text-indigo-500 pulse",
  };
  const cls = map[status] || "text-stone-400";
  return `<span class="status-square ${cls}" title="${escapeHtml(status || "")}"></span>`;
}

function emptyArt() {
  return `<svg width="68" height="48" viewBox="0 0 68 48" fill="none" stroke="currentColor" stroke-width="1.4" class="text-stone-400">
    <rect x="2" y="6" width="22" height="36" rx="2"/>
    <rect x="28" y="14" width="22" height="28" rx="2"/>
    <rect x="54" y="22" width="12" height="20" rx="2"/>
    <line x1="2" y1="46" x2="68" y2="46"/>
  </svg>`;
}

import { icon } from "./icons.js";
import { api, escapeHtml, fmtRelTime } from "./api.js";

// Wire up theme on load (before paint). The inline <head> script handles the
// initial flash; here we make sure the <html> class agrees with localStorage
// for the theme toggle.
const THEME_KEY = "k6studio.theme";
const initialTheme = localStorage.getItem(THEME_KEY) || "dark";
document.documentElement.classList.toggle("dark", initialTheme === "dark");

// ---------- Sidebar + topbar layout injection ----------
const NAV = [
  { href: "/", label: "Dashboard", iconName: "home" },
  { href: "/buckets", label: "Buckets", iconName: "buckets" },
  { href: "/runs", label: "Runs", iconName: "runs" },
  { divider: true },
  { href: "/docs", label: "Docs", iconName: "book" },
  { href: "/integrations", label: "Integrations", iconName: "code" },
];

function currentPathPrefix() {
  const p = location.pathname;
  if (p === "/") return "/";
  if (p.startsWith("/compare")) return "/runs";
  if (p.startsWith("/run/")) return "/runs";
  if (p.startsWith("/runs")) return "/runs";
  if (p.startsWith("/bucket")) return "/buckets";
  if (p.startsWith("/docs")) return "/docs";
  if (p.startsWith("/integrations")) return "/integrations";
  return p;
}

let shellBuilt = false;
let prevCleanup = null;

function buildShell() {
  const root = document.body;
  const shell = document.createElement("div");
  shell.className = "flex h-screen min-h-0";
  shell.innerHTML = `
    <aside class="w-[210px] shrink-0 border-r border-stone-200 dark:border-ink-800 bg-stone-50 dark:bg-ink-950 flex flex-col">
      <a href="/" class="px-4 h-14 flex items-center gap-2 border-b border-stone-200 dark:border-ink-800 hover:bg-stone-100 dark:hover:bg-ink-900 transition-colors">
        <div class="w-6 h-6 grid place-items-center bg-indigo-500 text-white" style="clip-path:polygon(0 0,100% 0,85% 100%,0% 100%)">
          ${icon("zap", { size: 14 })}
        </div>
        <div class="font-semibold text-[13px] tracking-wide">k6-studio</div>
      </a>
      <nav id="sideNav" class="flex-1 px-2 py-3 space-y-0.5">
        ${NAV.map((n) => {
          if (n.divider) {
            return '<div class="my-2 border-t border-stone-200 dark:border-ink-800/60"></div>';
          }
          return `<a href="${n.href}" data-nav="${n.href}" class="nav-item flex items-center gap-2.5 px-2.5 py-2 text-[13px] rounded-sm transition-colors text-stone-600 dark:text-stone-400 hover:bg-stone-100 dark:hover:bg-ink-900 hover:text-ink-950 dark:hover:text-stone-100">
            ${icon(n.iconName, { size: 16 })}
            <span>${n.label}</span>
          </a>`;
        }).join("")}
      </nav>
      <div class="border-t border-stone-200 dark:border-ink-800">
        <div class="px-3 pt-3 pb-1.5 flex items-center justify-between">
          <span class="text-[11px] font-mono text-stone-500 dark:text-stone-500">v1.0</span>
          <button id="cmdkOpen" class="flex items-center gap-1 px-1.5 py-0.5 rounded-sm text-[11px] text-stone-500 dark:text-stone-500 border border-stone-300 dark:border-ink-700 hover:bg-stone-100 dark:hover:bg-ink-900" title="Search (⌘K)">
            ${icon("command", { size: 11 })}<span class="font-mono">K</span>
          </button>
        </div>
        <div class="px-3 pb-3 text-[10px] text-stone-400 dark:text-stone-500 flex items-center gap-1">
          <span>powered by</span>
          <span class="font-semibold tracking-wide text-stone-600 dark:text-stone-300">Beetlestance</span>
        </div>
      </div>
    </aside>
    <main class="flex-1 min-w-0 flex flex-col bg-white dark:bg-ink-950">
      <header class="h-14 border-b border-stone-200 dark:border-ink-800 px-5 flex items-center gap-3 bg-white dark:bg-ink-950">
        <div id="breadcrumbs" class="flex items-center gap-2 text-[13px] text-stone-600 dark:text-stone-400 min-w-0 flex-1"></div>
        <button id="cmdkBtn" class="hidden md:flex items-center gap-2 text-[12px] px-2.5 py-1.5 rounded border border-stone-200 dark:border-ink-800 text-stone-500 dark:text-stone-400 hover:border-stone-400 dark:hover:border-ink-600 transition-colors">
          ${icon("search", { size: 13 })}
          <span>Search…</span>
          <span class="ml-2 px-1.5 py-0.5 rounded text-[10px] bg-stone-100 dark:bg-ink-800 font-mono">⌘K</span>
        </button>
        <button id="themeToggle" class="grid place-items-center w-8 h-8 rounded text-stone-600 dark:text-stone-400 hover:bg-stone-100 dark:hover:bg-ink-900" title="Toggle theme">
          <span data-theme-icon></span>
        </button>
      </header>
      <section id="page" class="flex-1 overflow-auto bg-grid"></section>
    </main>
    <div id="cmdk" class="fixed inset-0 cmdk-mask hidden items-start justify-center pt-[14vh] z-50">
      <div class="cmdk-shell w-[640px] max-w-[92vw] bg-white dark:bg-ink-900 border border-stone-200 dark:border-ink-700 rounded-lg overflow-hidden">
        <div class="flex items-center gap-2 px-3 h-12 border-b border-stone-200 dark:border-ink-800">
          ${icon("search", { size: 16, className: "text-stone-400" })}
          <input id="cmdkInput" placeholder="Find a bucket, config, or run…" class="flex-1 bg-transparent outline-none text-[14px] placeholder-stone-400" />
          <kbd class="text-[10px] px-1.5 py-0.5 rounded bg-stone-100 dark:bg-ink-800 font-mono">esc</kbd>
        </div>
        <div id="cmdkList" class="max-h-[50vh] overflow-auto py-1"></div>
      </div>
    </div>`;
  // Replace existing layout root, but preserve any pre-injected #page content.
  const existing = document.getElementById("page-content");
  root.innerHTML = "";
  root.appendChild(shell);
  if (existing) document.getElementById("page").appendChild(existing);

  applyThemeIcon();
  document.getElementById("themeToggle").addEventListener("click", toggleTheme);
  document.getElementById("cmdkBtn")?.addEventListener("click", openCmdk);
  document.getElementById("cmdkOpen")?.addEventListener("click", openCmdk);

  document.addEventListener("keydown", (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
      e.preventDefault();
      openCmdk();
    }
    if (e.key === "Escape") closeCmdk();
  });

  setupSpaNav();
}

// SPA-style navigation: keep sidebar/topbar mounted, fetch the destination
// page, and dynamically import its module so only #page is replaced.
async function navigateTo(href, push = true) {
  if (href === location.pathname + location.search + location.hash) return;
  const pageEl = document.getElementById("page");
  if (pageEl) {
    pageEl.style.transition = "opacity .12s ease";
    pageEl.style.opacity = "0";
    await new Promise((r) => setTimeout(r, 120));
  }
  let html;
  try {
    const res = await fetch(href, { headers: { Accept: "text/html" } });
    if (!res.ok) throw new Error(String(res.status));
    html = await res.text();
  } catch {
    location.href = href;
    return;
  }
  const doc = new DOMParser().parseFromString(html, "text/html");
  // Find the page-specific module — every page has exactly one
  // <script type="module" src="/js/<page>.js">.
  const script = doc.querySelector('script[type="module"][src^="/js/"]');
  if (!script) {
    location.href = href;
    return;
  }
  if (push) history.pushState({ k6: true }, "", href);
  document.title = doc.title;
  // Cache-bust so the imported module re-evaluates with new URL state.
  const src = script.getAttribute("src");
  const mod = src + (src.includes("?") ? "&" : "?") + "_t=" + Date.now();
  try {
    await import(mod);
  } catch (e) {
    console.error("nav import failed", e);
    location.href = href;
  }
}

function setupSpaNav() {
  document.addEventListener("click", (e) => {
    if (e.defaultPrevented) return;
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
    const a = e.target.closest("a");
    if (!a) return;
    if (a.target === "_blank" || a.hasAttribute("download")) return;
    if (!a.href) return;
    let url;
    try { url = new URL(a.href, location.href); } catch { return; }
    if (url.host !== location.host) return;
    // Skip the report endpoint — it's a server-rendered standalone page.
    if (url.pathname.startsWith("/report/")) return;
    // Hash-only links on the same page: smooth-scroll to the anchor instead
    // of refetching the page.
    if (url.pathname === location.pathname && url.search === location.search) {
      if (url.hash && url.hash !== location.hash) {
        e.preventDefault();
        const target = document.getElementById(url.hash.slice(1));
        if (target) target.scrollIntoView({ behavior: "smooth", block: "start" });
        window.history.pushState({}, "", url.hash);
      }
      return;
    }
    e.preventDefault();
    navigateTo(url.pathname + url.search + url.hash);
  });
  window.addEventListener("popstate", () => {
    navigateTo(location.pathname + location.search + location.hash, false);
  });
  // bfcache restore: ensure opacity isn't stuck at 0.
  window.addEventListener("pageshow", (e) => {
    if (e.persisted) {
      const pageEl = document.getElementById("page");
      if (pageEl) pageEl.style.opacity = "";
    }
  });
}

function applyThemeIcon() {
  const isDark = document.documentElement.classList.contains("dark");
  const el = document.querySelector("[data-theme-icon]");
  if (el) el.innerHTML = isDark ? icon("sun", { size: 16 }) : icon("moon", { size: 16 });
}

function toggleTheme() {
  const next = document.documentElement.classList.contains("dark") ? "light" : "dark";
  document.documentElement.classList.toggle("dark", next === "dark");
  localStorage.setItem(THEME_KEY, next);
  applyThemeIcon();
}

// ---------- Breadcrumbs ----------
export function setBreadcrumbs(crumbs) {
  const el = document.getElementById("breadcrumbs");
  if (!el) return;
  el.innerHTML = crumbs
    .map((c, i) => {
      const isLast = i === crumbs.length - 1;
      const text = escapeHtml(c.label);
      const link = c.href && !isLast
        ? `<a href="${c.href}" class="hover:text-ink-950 dark:hover:text-stone-100 transition-colors truncate">${text}</a>`
        : `<span class="${isLast ? "text-ink-950 dark:text-stone-100 font-medium truncate" : "truncate"}">${text}</span>`;
      const sep = isLast
        ? ""
        : `<span class="text-stone-300 dark:text-stone-600 select-none">/</span>`;
      return `${link}${sep}`;
    })
    .join("");
}

// ---------- Page mount helper ----------
// Pages call `mount(async (pageEl) => { ... return cleanup })` which fills the
// content area. The shell is built once; subsequent calls (after SPA-style
// navigation) just refresh the active-nav state and run the renderer.
export async function mount(renderer) {
  if (prevCleanup) {
    try { prevCleanup(); } catch {}
    prevCleanup = null;
  }
  if (!shellBuilt) {
    buildShell();
    shellBuilt = true;
  }
  refreshActiveNav();
  const pageEl = document.getElementById("page");
  pageEl.innerHTML = "";
  pageEl.style.opacity = "";
  const result = await renderer(pageEl);
  if (typeof result === "function") prevCleanup = result;
}

function refreshActiveNav() {
  const cur = currentPathPrefix();
  document.querySelectorAll('[data-nav]').forEach((a) => {
    const isActive = a.dataset.nav === cur;
    a.classList.toggle("bg-stone-200/70", isActive);
    a.classList.toggle("dark:bg-ink-800", isActive);
    a.classList.toggle("text-ink-950", isActive);
    a.classList.toggle("dark:text-stone-50", isActive);
    a.classList.toggle("font-medium", isActive);
    a.classList.toggle("text-stone-600", !isActive);
    a.classList.toggle("dark:text-stone-400", !isActive);
  });
}

// ---------- Cmd-K command palette ----------
let cmdkData = null; // { folders, runs }

async function loadCmdkData() {
  if (cmdkData) return cmdkData;
  try {
    const [folders, runs] = await Promise.all([
      api.folders().catch(() => []),
      api.history().catch(() => []),
    ]);
    cmdkData = { folders, runs };
  } catch {
    cmdkData = { folders: [], runs: [] };
  }
  return cmdkData;
}

function openCmdk() {
  const wrap = document.getElementById("cmdk");
  if (!wrap) return;
  wrap.classList.remove("hidden");
  wrap.classList.add("flex");
  loadCmdkData().then(() => renderCmdk(""));
  const input = document.getElementById("cmdkInput");
  input.value = "";
  setTimeout(() => input.focus(), 30);
  input.oninput = () => renderCmdk(input.value);
}

function closeCmdk() {
  const wrap = document.getElementById("cmdk");
  if (!wrap) return;
  wrap.classList.add("hidden");
  wrap.classList.remove("flex");
}

function renderCmdk(q) {
  const list = document.getElementById("cmdkList");
  const query = q.trim().toLowerCase();
  const { folders = [], runs = [] } = cmdkData || {};
  const matchedFolders = folders
    .filter((f) => !query || f.name.toLowerCase().includes(query))
    .slice(0, 8);
  const matchedConfigs = [];
  for (const f of folders) {
    for (const c of f.configs || []) {
      const haystack = `${f.name}/${c.path}`.toLowerCase();
      if (!query || haystack.includes(query)) {
        matchedConfigs.push({ folder: f.name, config: c.path });
        if (matchedConfigs.length >= 8) break;
      }
    }
    if (matchedConfigs.length >= 8) break;
  }
  const matchedRuns = runs
    .filter(
      (r) =>
        !query ||
        (r.bucket || "").toLowerCase().includes(query) ||
        (r.configRel || "").toLowerCase().includes(query) ||
        (r.id || "").toLowerCase().includes(query),
    )
    .slice(0, 6);

  const section = (title, body) =>
    body
      ? `<div class="px-3 pt-2 pb-1 text-[10px] uppercase tracking-wider text-stone-400">${title}</div>${body}`
      : "";

  const folderRows = matchedFolders
    .map(
      (f) =>
        `<a href="/bucket/${encodeURIComponent(f.name)}" class="flex items-center gap-2.5 px-3 py-1.5 hover:bg-stone-100 dark:hover:bg-ink-800 text-[13px]">
          ${icon("folder", { size: 14, className: "text-stone-400" })}
          <span class="flex-1">${escapeHtml(f.name)}</span>
          <span class="text-[11px] text-stone-400">${(f.configs || []).length} cfg</span>
        </a>`,
    )
    .join("");

  const configRows = matchedConfigs
    .map(
      (c) =>
        `<a href="/bucket/${encodeURIComponent(c.folder)}#${encodeURIComponent(c.config)}" class="flex items-center gap-2.5 px-3 py-1.5 hover:bg-stone-100 dark:hover:bg-ink-800 text-[13px]">
          ${icon("file", { size: 14, className: "text-stone-400" })}
          <span class="text-stone-400">${escapeHtml(c.folder)} /</span>
          <span class="flex-1">${escapeHtml(c.config)}</span>
        </a>`,
    )
    .join("");

  const runRows = matchedRuns
    .map(
      (r) =>
        `<a href="/run/${encodeURIComponent(r.bucket)}/${encodeURIComponent(r.configDir)}/${encodeURIComponent(r.id)}" class="flex items-center gap-2.5 px-3 py-1.5 hover:bg-stone-100 dark:hover:bg-ink-800 text-[13px]">
          ${icon("runs", { size: 14, className: "text-stone-400" })}
          <span class="text-stone-400">${escapeHtml(r.bucket)} /</span>
          <span class="flex-1 truncate">${escapeHtml(r.configRel || r.configDir)}</span>
          <span class="text-[11px] text-stone-400">${escapeHtml(fmtRelTime(r.startedAt))}</span>
        </a>`,
    )
    .join("");

  list.innerHTML =
    section("Buckets", folderRows) +
    section("Configs", configRows) +
    section("Runs", runRows) ||
    `<div class="px-3 py-6 text-center text-[12px] text-stone-400">No matches.</div>`;

  if (!folderRows && !configRows && !runRows) {
    list.innerHTML = `<div class="px-3 py-6 text-center text-[12px] text-stone-400">No matches.</div>`;
  }
}

// Close cmdk by clicking the mask
document.addEventListener("click", (e) => {
  const wrap = document.getElementById("cmdk");
  if (!wrap || wrap.classList.contains("hidden")) return;
  if (e.target === wrap) closeCmdk();
});

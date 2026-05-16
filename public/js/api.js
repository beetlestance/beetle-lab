// Centralized fetch helpers.
async function jsonFetch(url, init) {
  const res = await fetch(url, init);
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    let err;
    try {
      err = JSON.parse(text).error;
    } catch {
      err = text;
    }
    throw new Error(err || res.statusText);
  }
  const ct = res.headers.get("content-type") || "";
  if (ct.includes("application/json")) return res.json();
  return res.text();
}

export const api = {
  folders: () => jsonFetch("/api/folders"),
  createFolder: (name) =>
    jsonFetch("/api/folders", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    }),
  deleteFolder: (name) =>
    jsonFetch(`/api/folders/${encodeURIComponent(name)}`, { method: "DELETE" }),
  uploadFiles: (name, files) =>
    jsonFetch(`/api/folders/${encodeURIComponent(name)}/files`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ files }),
    }),
  readFile: (name, rel) =>
    jsonFetch(
      `/api/folders/${encodeURIComponent(name)}/files/${rel
        .split("/")
        .map(encodeURIComponent)
        .join("/")}`,
    ),
  deleteFile: (name, rel) =>
    jsonFetch(
      `/api/folders/${encodeURIComponent(name)}/files/${rel
        .split("/")
        .map(encodeURIComponent)
        .join("/")}`,
      { method: "DELETE" },
    ),
  liveRuns: () => jsonFetch("/api/runs"),
  liveRun: (id) => jsonFetch(`/api/runs/${encodeURIComponent(id)}`),
  startRun: ({ folder, config, target }) =>
    jsonFetch("/api/runs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ folder, config, target }),
    }),
  stopRun: (id) =>
    jsonFetch(`/api/runs/${encodeURIComponent(id)}/stop`, { method: "POST" }),
  history: (folder) =>
    jsonFetch(
      `/api/runs-history${folder ? `?folder=${encodeURIComponent(folder)}` : ""}`,
    ),
  runDetail: (bucket, configDir, id) =>
    jsonFetch(
      `/api/folders/${encodeURIComponent(bucket)}/runs/${encodeURIComponent(configDir)}/${encodeURIComponent(id)}`,
    ),
  deleteRun: (bucket, configDir, id) =>
    jsonFetch(
      `/api/folders/${encodeURIComponent(bucket)}/runs/${encodeURIComponent(configDir)}/${encodeURIComponent(id)}`,
      { method: "DELETE" },
    ),
};

export function reportUrl(bucket, configDir, id) {
  return `/report/${encodeURIComponent(bucket)}/${encodeURIComponent(configDir)}/${encodeURIComponent(id)}`;
}

export function fmtRelTime(ms) {
  if (!ms) return "—";
  const diff = Math.max(0, (Date.now() - ms) / 1000);
  if (diff < 60) return `${Math.round(diff)}s ago`;
  if (diff < 3600) return `${Math.round(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.round(diff / 3600)}h ago`;
  return `${Math.round(diff / 86400)}d ago`;
}

export function fmtBytes(n) {
  if (n === null || n === undefined || !isFinite(n)) return "—";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

// Pick a Tailwind text color class given a byte count — used to highlight
// run rows that are using a lot of disk. amber > 100 MB, rose > 1 GB.
export function sizeTextClass(n) {
  if (!n) return "";
  if (n >= 1024 * 1024 * 1024) return "text-rose-600 dark:text-rose-400 font-medium";
  if (n >= 100 * 1024 * 1024) return "text-amber-600 dark:text-amber-400";
  return "";
}

export function fmtSeconds(s) {
  s = Math.max(0, Math.round(s));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const r = s % 60;
  if (m < 60) return r ? `${m}m${r}s` : `${m}m`;
  const h = Math.floor(m / 60);
  const mm = m % 60;
  return mm ? `${h}h${mm}m` : `${h}h`;
}

export function parseDurationS(s) {
  if (!s) return 0;
  const re = /(\d+(?:\.\d+)?)([smhd])/g;
  const factors = { s: 1, m: 60, h: 3600, d: 86400 };
  let total = 0;
  let m;
  while ((m = re.exec(String(s))) !== null)
    total += parseFloat(m[1]) * factors[m[2]];
  return total;
}

export function totalDurationSec(cfg) {
  if (!cfg) return 0;
  const load =
    cfg.executor === "constant-arrival-rate"
      ? parseDurationS(cfg.loadDuration)
      : (cfg.stages || []).reduce((sum, s) => sum + parseDurationS(s.duration), 0);
  const cooldown = cfg.memorySampling?.enabled
    ? cfg.memorySampling.cooldownSeconds || 0
    : 0;
  return load + cooldown;
}

export function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]),
  );
}

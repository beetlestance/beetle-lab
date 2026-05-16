import express from "express";
import { WebSocketServer } from "ws";
import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Runner, loadTicks } from "./runner.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 4567);
const FOLDERS_DIR = path.join(__dirname, "configs");
const RUNS_SUBDIR = "runs"; // each bucket has its own runs/ subdirectory

await fs.mkdir(FOLDERS_DIR, { recursive: true });
await migrateLooseConfigs();
await markOrphanedRunsAsFailed();

const runner = new Runner();
const app = express();
app.use(express.json({ limit: "50mb" }));
app.use(express.static(path.join(__dirname, "public")));

// Page routes — each serves a real HTML file with shared shell injected by JS.
const PUBLIC = path.join(__dirname, "public");
const sendPage = (file) => (_req, res) => res.sendFile(path.join(PUBLIC, file));
app.get("/", sendPage("index.html"));
app.get("/buckets", sendPage("buckets.html"));
app.get("/bucket/:name", sendPage("bucket.html"));
app.get("/runs", sendPage("runs.html"));
app.get("/run/:bucket/:configDir/:id", sendPage("run.html"));
app.get("/compare/:bucket/:configDir", sendPage("compare.html"));
app.get("/docs", sendPage("docs.html"));
app.get("/integrations", sendPage("integrations.html"));

// AI skill — a Claude/agent-friendly markdown spec describing every k6-studio
// HTTP endpoint and the WebSocket protocol so an LLM can drive the tool.
app.get("/integrations/k6-studio.skill.md", (_req, res) => {
  res.type("text/markdown").send(buildAiSkill());
});

function buildAiSkill() {
  return `# k6-studio — agent skill

You are operating against a local k6-studio instance over plain HTTP and a
WebSocket. Use this skill when the user asks you to start, inspect, compare,
export, or manage HTTP load tests, especially against Node.js services where
memory / CPU / event-loop / GC profiling is needed.

## Base URL

Default: \`http://localhost:4567\`. Ask the user if they're running on a
different port. All API endpoints below are relative to this base.

## Concepts

- **Bucket**: A named workspace holding configs, payload files, and run
  history for a project. On disk: \`configs/<bucket>/\`.
- **Config**: A JSON file inside a bucket whose top-level has a non-empty
  \`endpoints[]\` array. Multiple configs can live in the same bucket and
  share payload files.
- **Run**: A single k6 execution of a config. Output goes to
  \`configs/<bucket>/runs/<configDir>/<runId>/\`. \`configDir\` is the config's
  relative path with \`/\` → \`__\` and \`.json\` stripped.

## REST endpoints

### Buckets

- \`GET /api/folders\` → list buckets, each with \`name\`, \`mtime\`,
  \`fileCount\`, \`configs[]\` (path + mtime).
- \`POST /api/folders\` body \`{ "name": "bucket-name" }\` → create bucket.
- \`DELETE /api/folders/:name\` → delete bucket and ALL its runs.

### Files

- \`POST /api/folders/:name/files\` body \`{ "files": [{ "path": "...", "content": "..." }] }\`
  Merge-uploads files into the bucket. Existing files at the same path are overwritten.
  \`runs/...\` paths are reserved and silently skipped.
- \`GET /api/folders/:name/files/<rel>\` → read a file (returned as JSON if it parses, else text).
- \`DELETE /api/folders/:name/files/<rel>\` → delete a file.

### Runs

- \`POST /api/runs\` body \`{ "folder": "<bucket>", "config": "<config-rel-path>", "target": "http://..." }\`
  → starts a new run. Returns the run snapshot \`{ id, status, bucket, configRel, configDir, target, startedAt }\`.
- \`POST /api/runs/:id/stop\` → stop a running run (skips cooldown).
- \`GET /api/runs\` → list **active** in-memory runs (current process). Status is
  \`running\` for in-flight runs.
- \`GET /api/runs/:id\` → live snapshot + \`tickHistory\` + \`logs\`.
- \`GET /api/runs-history?folder=<bucket>\` → past runs from disk. Each row
  carries \`bucket\`, \`configDir\`, \`configRel\`, \`status\`, \`startedAt\`,
  \`endedAt\`, \`stats\` (requests, rps, p50/p95/p99, errors, failedRate).
- \`GET /api/folders/:bucket/runs/:configDir/:id\` → full detail:
  \`{ meta, summary, summaryTxt, ticks[], log, hasMemory, configSnapshot }\`.
  - \`meta.configHash\` is the SHA-256 of the config JSON at run time.
  - \`configSnapshot\` is the parsed config copied at run start.
  - \`summary\` is the raw k6 \`handleSummary\` payload.
  - \`summaryTxt\` is the rendered Node.js performance report.
  - \`ticks[]\` is per-second aggregated metrics: \`{ t, rps, p50, p95, p99, errors, vus, memory: {...} }\`.
- \`DELETE /api/folders/:bucket/runs/:configDir/:id\` → delete one run.

### Reports

- \`GET /report/:bucket/:configDir/:id\` → standalone HTML report page.

## WebSocket /ws?run=<id>

Connect after starting a run to stream live data. Messages:

- \`{ "type": "hello", "run": {...snapshot...} }\` — sent immediately on connect, then
  any \`tickHistory\` and recent log lines are replayed.
- \`{ "type": "tick", "t": <ms>, "rps": ..., "p50": ..., "p95": ..., "p99": ..., "errors": ..., "vus": ..., "memory": {...} }\`
  every second.
- \`{ "type": "log", "t": <ms>, "line": "..." }\` for each log line.
- \`{ "type": "status", "status": "running" | "completed" | "failed" | "stopped", ... }\`.
- \`{ "type": "summary", "data": {...} }\` after the run finishes.

## Config JSON shape

\`\`\`jsonc
{
  "executor": "constant-arrival-rate",   // or "ramping-vus"
  "rate": 30, "timeUnit": "1s", "loadDuration": "3m",
  "preAllocatedVUs": 15, "maxVUs": 60,
  // OR for ramping-vus:
  // "stages": [{ "duration": "30s", "vus": 50 }, ...]

  "target": "http://localhost:8080",     // optional — overridable per run
  "healthPath": "/health",                // optional — wait for 200 before load
  "tokens": ["..."],                      // optional — substituted into headers

  "memorySampling": {
    "enabled": true,
    "intervalSeconds": 2,
    "endpoint": "/debug/procstats",       // returns Node.js runtime stats
    "cooldownSeconds": 180                // optional — wait this long after load
                                          //   to detect memory leaks
  },

  "thresholds": { ... },                  // optional k6 thresholds

  "endpoints": [
    {
      "name": "get_user",
      "method": "GET",
      "path": "/v1/users/123",
      "weight": 10,
      "params": { "include": "profile" },
      "headers": { "Authorization": "Bearer \${token}" },
      "checks": { "status": 200, "bodyContains": "id" }
    },
    {
      "name": "post_event",
      "method": "POST",
      "path": "/v1/events",
      "weight": 1,
      "body": { "type": "click" },
      // or "bodyFile": "./payload/big-event.json" (resolved against the config's dir)
      "checks": { "status2xx": true }
    }
  ]
}
\`\`\`

## Workflows

### Start a run and wait for it to finish

\`\`\`text
1. POST /api/runs { folder, config, target } -> { id, configDir }
2. Open WS /ws?run=<id>
3. Read ticks until { type: "status", status: "completed" | "failed" | "stopped" }
4. Optionally GET /api/folders/<bucket>/runs/<configDir>/<id> for the summaryTxt + summary
\`\`\`

### Compare two runs of the same config

\`\`\`text
1. GET /api/runs-history?folder=<bucket> — filter by configDir to get same-config runs
2. Pick two run ids
3. For each, GET /api/folders/<bucket>/runs/<configDir>/<id> for full detail
4. Compare summary.metrics directly, or open
   /compare/<bucket>/<configDir>?a=<idA>&b=<idB> in a browser
\`\`\`

### Export a report

- TXT report:    \`GET /api/folders/<bucket>/runs/<configDir>/<id>\` → \`summaryTxt\`
- JSON summary:  same response → \`summary\`
- CSV metrics:   same response → \`ticks\` (build a CSV client-side)
- Standalone:    \`GET /report/<bucket>/<configDir>/<id>\` (returns HTML)

## Metric meanings (Node.js services)

- \`http_reqs.count\` / \`.rate\` — total requests / per-second throughput.
- \`http_req_duration.p(95)\` — p95 latency in ms. Watch trend across runs.
- \`http_req_failed.rate\` — fraction of failed requests.
- \`heap_inuse_bytes\` — V8 heap currently used; rising monotonically across
  runs is a leak indicator. Compare to \`baseline_heap_mb\` and
  \`cooldown_heap_mb\`.
- \`peak_heap_mb\` / \`peak_rss_mb\` / \`peak_cpu_percent\` — high-water marks.
- \`event_loop_delay_p99_ms\` — JS thread blocking. >100ms is bad.
- \`gc_max_ms\` — longest GC pause. >100ms causes user-perceptible lag.
- \`active_handles\` — libuv handles open. Monotonic growth across runs →
  unclosed connections / timers.
- \`cooldown_*\` — sampled after \`memorySampling.cooldownSeconds\` of idle.
  If close to baseline, no leak. If close to peak, suspect a leak.

## Conventions

- Always quote \`bucket\`, \`configDir\`, and \`runId\` in URLs (they may contain
  characters needing escape).
- Don't \`rm -rf configs/\` — that's user data. Use the API to delete.
- A "run" exists on disk as soon as it starts, even before completion.
  meta.json is written first; summary.json + summary.txt only after exit.
`;
}

function safeName(name) {
  return (
    String(name || "")
      .replace(/[^a-zA-Z0-9_.-]/g, "_")
      .replace(/^[._]+/, "")
      .slice(0, 100) || "folder"
  );
}

function safeRelPath(p) {
  return String(p || "")
    .split(/[\\/]/)
    .filter((s) => s && s !== "." && s !== "..")
    .map((s) => s.replace(/[^a-zA-Z0-9_.-]/g, "_"))
    .join("/");
}

function folderDir(name) {
  return path.join(FOLDERS_DIR, safeName(name));
}

// Map a config's relative path inside a bucket to the run-history subdir
// name. Slashes are encoded so loadtest/config-constant.json and
// foo/config-constant.json don't collide.
function configDirName(rel) {
  return String(rel || "")
    .replace(/\.json$/i, "")
    .replace(/[\\/]/g, "__")
    .replace(/[^a-zA-Z0-9_.-]/g, "_") || "config";
}

async function listFolders() {
  const entries = await fs.readdir(FOLDERS_DIR, { withFileTypes: true });
  const out = [];
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    const dir = path.join(FOLDERS_DIR, e.name);
    const stat = await fs.stat(dir);
    const { configs, fileCount } = await scanFolder(dir);
    out.push({ name: e.name, mtime: stat.mtimeMs, fileCount, configs });
  }
  out.sort((a, b) => b.mtime - a.mtime);
  return out;
}

async function scanFolder(dir) {
  const configs = [];
  let fileCount = 0;
  async function walk(current, rel) {
    let entries;
    try {
      entries = await fs.readdir(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      // The runs/ subtree at the bucket root is reserved for run output;
      // it shouldn't show up in file counts or config detection.
      if (rel === "" && e.name === RUNS_SUBDIR) continue;
      const full = path.join(current, e.name);
      const childRel = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) {
        await walk(full, childRel);
      } else if (e.isFile()) {
        fileCount += 1;
        if (e.name.endsWith(".json")) {
          try {
            const txt = await fs.readFile(full, "utf8");
            const json = JSON.parse(txt);
            if (Array.isArray(json.endpoints) && json.endpoints.length > 0) {
              const stat = await fs.stat(full);
              configs.push({ path: childRel, mtime: stat.mtimeMs });
            }
          } catch {}
        }
      }
    }
  }
  await walk(dir, "");
  configs.sort((a, b) => a.path.localeCompare(b.path));
  return { configs, fileCount };
}

// Any meta.json reporting status="running" at boot is orphaned — the server
// (and therefore its child k6 process) terminated before the run finished.
// Rewrite as failed so the UI doesn't show a stale "running" badge forever.
async function markOrphanedRunsAsFailed() {
  let buckets;
  try {
    buckets = await fs.readdir(FOLDERS_DIR, { withFileTypes: true });
  } catch {
    return;
  }
  for (const b of buckets) {
    if (!b.isDirectory()) continue;
    const runsRoot = path.join(FOLDERS_DIR, b.name, RUNS_SUBDIR);
    let configDirs;
    try {
      configDirs = await fs.readdir(runsRoot, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const c of configDirs) {
      if (!c.isDirectory()) continue;
      const cdir = path.join(runsRoot, c.name);
      let runs;
      try {
        runs = await fs.readdir(cdir, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const r of runs) {
        if (!r.isDirectory()) continue;
        const metaPath = path.join(cdir, r.name, "meta.json");
        let meta;
        try {
          meta = JSON.parse(await fs.readFile(metaPath, "utf8"));
        } catch {
          continue;
        }
        if (meta.status !== "running") continue;
        meta.status = "failed";
        meta.error = "server stopped before run finished";
        meta.endedAt = meta.endedAt || Date.now();
        try {
          await fs.writeFile(metaPath, JSON.stringify(meta, null, 2));
          console.log(`marked orphaned run as failed: ${b.name}/${c.name}/${r.name}`);
        } catch {}
      }
    }
  }
}

async function migrateLooseConfigs() {
  const entries = await fs.readdir(FOLDERS_DIR, { withFileTypes: true });
  for (const e of entries) {
    if (!e.isFile() || !e.name.endsWith(".json")) continue;
    const baseName = safeName(e.name.replace(/\.json$/, ""));
    const targetDir = path.join(FOLDERS_DIR, baseName);
    try {
      await fs.access(targetDir);
      continue;
    } catch {}
    await fs.mkdir(targetDir, { recursive: true });
    await fs.rename(path.join(FOLDERS_DIR, e.name), path.join(targetDir, "config.json"));
    console.log(`migrated ${e.name} -> ${baseName}/config.json`);
  }
}

app.get("/api/folders", async (_req, res) => {
  res.json(await listFolders());
});

app.post("/api/folders", async (req, res) => {
  const { name } = req.body || {};
  if (!name) return res.status(400).json({ error: "name required" });
  const dirName = safeName(name);
  const dir = path.join(FOLDERS_DIR, dirName);
  try {
    await fs.access(dir);
    return res.status(409).json({ error: "folder already exists" });
  } catch {}
  await fs.mkdir(dir, { recursive: true });
  res.json({ name: dirName });
});

app.delete("/api/folders/:name", async (req, res) => {
  const dir = folderDir(req.params.name);
  try {
    await fs.rm(dir, { recursive: true, force: true });
    res.json({ ok: true });
  } catch {
    res.status(404).json({ error: "not found" });
  }
});

app.post("/api/folders/:name/files", async (req, res) => {
  const dir = folderDir(req.params.name);
  try {
    await fs.access(dir);
  } catch {
    return res.status(404).json({ error: "folder not found" });
  }
  const { files } = req.body || {};
  if (!Array.isArray(files) || files.length === 0) {
    return res.status(400).json({ error: "files[] required" });
  }
  let added = 0;
  let skipped = 0;
  for (const f of files) {
    if (typeof f.path !== "string" || typeof f.content !== "string") continue;
    const rel = safeRelPath(f.path);
    if (!rel) continue;
    if (rel === RUNS_SUBDIR || rel.startsWith(`${RUNS_SUBDIR}/`)) {
      skipped += 1;
      continue;
    }
    const dest = path.join(dir, rel);
    await fs.mkdir(path.dirname(dest), { recursive: true });
    await fs.writeFile(dest, f.content);
    added += 1;
  }
  res.json({ added, skipped });
});

app.get("/api/folders/:name/files/*", async (req, res) => {
  const dir = folderDir(req.params.name);
  const rel = safeRelPath(req.params[0]);
  if (!rel) return res.status(400).json({ error: "path required" });
  try {
    const content = await fs.readFile(path.join(dir, rel), "utf8");
    res.type("application/json").send(content);
  } catch {
    res.status(404).json({ error: "not found" });
  }
});

app.delete("/api/folders/:name/files/*", async (req, res) => {
  const dir = folderDir(req.params.name);
  const rel = safeRelPath(req.params[0]);
  if (!rel) return res.status(400).json({ error: "path required" });
  try {
    await fs.unlink(path.join(dir, rel));
    res.json({ ok: true });
  } catch {
    res.status(404).json({ error: "not found" });
  }
});

app.get("/api/runs", (_req, res) => {
  res.json(runner.list());
});

// History (persisted on disk). Use /api/runs-history?folder=<bucket> to filter.
app.get("/api/runs-history", async (req, res) => {
  const filter = req.query.folder ? safeName(req.query.folder) : null;
  const out = [];
  let buckets;
  try {
    buckets = await fs.readdir(FOLDERS_DIR, { withFileTypes: true });
  } catch {
    return res.json([]);
  }
  for (const b of buckets) {
    if (!b.isDirectory()) continue;
    if (filter && b.name !== filter) continue;
    const rows = await readRunsForBucket(b.name);
    out.push(...rows);
  }
  out.sort((a, b) => (b.startedAt || 0) - (a.startedAt || 0));
  res.json(out);
});

async function readRunsForBucket(bucket) {
  const runsRoot = path.join(FOLDERS_DIR, bucket, RUNS_SUBDIR);
  let configDirs;
  try {
    configDirs = await fs.readdir(runsRoot, { withFileTypes: true });
  } catch {
    return [];
  }
  const rows = [];
  for (const c of configDirs) {
    if (!c.isDirectory()) continue;
    const cdir = path.join(runsRoot, c.name);
    let runs;
    try {
      runs = await fs.readdir(cdir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const r of runs) {
      if (!r.isDirectory()) continue;
      const runDir = path.join(cdir, r.name);
      const row = await readRunRow(bucket, c.name, r.name, runDir);
      if (row) rows.push(row);
    }
  }
  return rows;
}

async function readRunRow(bucket, configDir, id, runDir) {
  let meta = null;
  try {
    meta = JSON.parse(await fs.readFile(path.join(runDir, "meta.json"), "utf8"));
  } catch {}
  let stats = null;
  try {
    const summary = JSON.parse(await fs.readFile(path.join(runDir, "summary.json"), "utf8"));
    stats = extractRunStats(summary);
  } catch {}
  if (!meta && !stats) return null;
  const sizeBytes = await dirSize(runDir);
  return {
    id,
    bucket,
    configDir,
    configRel: meta?.configRel || configDir,
    status: meta?.status || (stats ? "completed" : "unknown"),
    exitCode: meta?.exitCode ?? null,
    error: meta?.error || null,
    target: meta?.target || null,
    startedAt: meta?.startedAt || null,
    endedAt: meta?.endedAt || null,
    stats,
    sizeBytes,
  };
}

// Recursive directory size. Used by run history rows so the UI can surface
// disk usage per run — important because k6's raw metrics.jsonl can balloon
// to multi-GB on long high-RPS runs.
async function dirSize(dir) {
  let total = 0;
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return 0;
  }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      total += await dirSize(p);
    } else if (e.isFile()) {
      try {
        const st = await fs.stat(p);
        total += st.size;
      } catch {}
    }
  }
  return total;
}

function extractRunStats(summary) {
  const m = summary?.metrics || {};
  const reqs = m.http_reqs?.values || {};
  const dur = m.http_req_duration?.values || {};
  const errs = m.errors?.values || {};
  const failed = m.http_req_failed?.values || {};
  return {
    requests: reqs.count || 0,
    rps: reqs.rate || 0,
    avg: dur.avg || 0,
    p50: dur.med || 0,
    p95: dur["p(95)"] || 0,
    p99: dur["p(99)"] || 0,
    errors: errs.count || 0,
    failedRate: failed.rate || 0,
  };
}

// Read a single historical run: meta + summary + replayed per-second ticks.
app.get("/api/folders/:bucket/runs/:configDir/:id", async (req, res) => {
  const bucket = safeName(req.params.bucket);
  const cdir = safeName(req.params.configDir);
  const id = safeName(req.params.id);
  const runDir = path.join(FOLDERS_DIR, bucket, RUNS_SUBDIR, cdir, id);
  let meta = null;
  let summary = null;
  let summaryTxt = null;
  try {
    meta = JSON.parse(await fs.readFile(path.join(runDir, "meta.json"), "utf8"));
  } catch {}
  try {
    summary = JSON.parse(await fs.readFile(path.join(runDir, "summary.json"), "utf8"));
  } catch {}
  try {
    summaryTxt = await fs.readFile(path.join(runDir, "summary.txt"), "utf8");
  } catch {}
  if (!meta && !summary) return res.status(404).json({ error: "run not found" });
  const ticks = await loadTicks(runDir);
  const hasMemory = ticks.some((t) => t.memory && t.memory.heapMB !== undefined);
  let log = "";
  try {
    log = await fs.readFile(path.join(runDir, "log.txt"), "utf8");
  } catch {}
  // Snapshot of the config used at run time. Older runs predating snapshots
  // may not have one — clients should treat configSnapshot as optional.
  let configSnapshot = null;
  try {
    configSnapshot = JSON.parse(
      await fs.readFile(path.join(runDir, "config.snapshot.json"), "utf8"),
    );
  } catch {}
  res.json({ meta, summary, summaryTxt, ticks, log, hasMemory, configSnapshot });
});

// Standalone report page: full TXT report rendered as a static HTML page.
app.get("/report/:bucket/:configDir/:id", async (req, res) => {
  const bucket = safeName(req.params.bucket);
  const cdir = safeName(req.params.configDir);
  const id = safeName(req.params.id);
  const runDir = path.join(FOLDERS_DIR, bucket, RUNS_SUBDIR, cdir, id);
  let meta = null;
  let txt = "";
  try {
    meta = JSON.parse(await fs.readFile(path.join(runDir, "meta.json"), "utf8"));
  } catch {}
  try {
    txt = await fs.readFile(path.join(runDir, "summary.txt"), "utf8");
  } catch {
    txt = "(summary.txt not found — run may have not finished, or memory sampling was disabled and no text report was emitted)";
  }
  const title = meta
    ? `${meta.bucket || bucket} / ${meta.configRel || cdir} · ${id}`
    : `${bucket} / ${cdir} · ${id}`;
  const escape = (s) =>
    String(s).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]);
  const html = `<!doctype html>
<html><head>
<meta charset="utf-8">
<title>Report — ${escape(title)}</title>
<style>
  body { background:#0e1116; color:#e6edf3; font-family: ui-monospace, "JetBrains Mono", Menlo, monospace; margin:0; padding:24px; }
  header { display:flex; gap:14px; align-items:baseline; padding-bottom:14px; border-bottom:1px solid #2a313c; margin-bottom:18px; }
  h1 { font-size:14px; margin:0; font-family:-apple-system,BlinkMacSystemFont,sans-serif; }
  .links a { color:#4f8cff; text-decoration:none; margin-right:14px; font-size:12px; font-family:-apple-system,sans-serif; }
  .links a:hover { text-decoration:underline; }
  pre { white-space:pre-wrap; line-height:1.55; font-size:13px; }
</style>
</head><body>
<header>
  <h1>${escape(title)}</h1>
  <div class="links">
    <a href="/api/folders/${encodeURIComponent(bucket)}/runs/${encodeURIComponent(cdir)}/${encodeURIComponent(id)}">JSON detail</a>
    <a href="/">&larr; back</a>
  </div>
</header>
<pre>${escape(txt)}</pre>
</body></html>`;
  res.type("html").send(html);
});

app.delete("/api/folders/:bucket/runs/:configDir/:id", async (req, res) => {
  const bucket = safeName(req.params.bucket);
  const cdir = safeName(req.params.configDir);
  const id = safeName(req.params.id);
  const runDir = path.join(FOLDERS_DIR, bucket, RUNS_SUBDIR, cdir, id);
  try {
    await fs.rm(runDir, { recursive: true, force: true });
    res.json({ ok: true });
  } catch {
    res.status(404).json({ error: "not found" });
  }
});

app.get("/api/runs/:id", (req, res) => {
  const run = runner.get(req.params.id);
  if (!run) return res.status(404).json({ error: "not found" });
  res.json({
    ...run.snapshot(),
    ticks: run.tickHistory,
    logs: run.logLines.slice(-500),
  });
});

app.post("/api/runs", async (req, res) => {
  const { folder, config, target } = req.body || {};
  if (!folder || !config) {
    return res.status(400).json({ error: "folder and config required" });
  }
  const dir = folderDir(folder);
  const rel = safeRelPath(config);
  const configPath = path.join(dir, rel);
  try {
    const txt = await fs.readFile(configPath, "utf8");
    const parsed = JSON.parse(txt);
    if (!Array.isArray(parsed.endpoints)) {
      return res.status(400).json({ error: "config has no endpoints[]" });
    }
  } catch {
    return res.status(404).json({ error: "config not found" });
  }
  const runsDir = path.join(dir, RUNS_SUBDIR, configDirName(rel));
  const run = await runner.create({
    configPath,
    target,
    runsDir,
    bucket: safeName(folder),
    configRel: rel,
  });
  res.json(run.snapshot());
});

app.post("/api/runs/:id/stop", (req, res) => {
  const run = runner.get(req.params.id);
  if (!run) return res.status(404).json({ error: "not found" });
  run.stop();
  res.json({ ok: true });
});

const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: "/ws" });

wss.on("connection", (ws, req) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const runId = url.searchParams.get("run");
  if (!runId) {
    ws.close(1008, "run query param required");
    return;
  }
  const run = runner.get(runId);
  if (!run) {
    ws.close(1008, "run not found");
    return;
  }

  const send = (type, payload) => {
    if (ws.readyState !== ws.OPEN) return;
    ws.send(JSON.stringify({ type, ...payload }));
  };

  send("hello", { run: run.snapshot() });
  for (const t of run.tickHistory) send("tick", t);
  for (const l of run.logLines.slice(-200)) send("log", l);
  if (run.status !== "running") send("status", { status: run.status, error: run.error });

  const onTick = (t) => send("tick", t);
  const onLog = (l) => send("log", l);
  const onStatus = (s) => send("status", s);
  const onSummary = (s) => send("summary", { data: s });

  run.on("tick", onTick);
  run.on("log", onLog);
  run.on("status", onStatus);
  run.on("summary", onSummary);

  ws.on("close", () => {
    run.off("tick", onTick);
    run.off("log", onLog);
    run.off("status", onStatus);
    run.off("summary", onSummary);
  });
});

server.listen(PORT, () => {
  console.log(`k6-studio running at http://localhost:${PORT}`);
});

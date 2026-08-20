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
export, or manage HTTP load tests — especially against Node.js services
where memory / CPU / event-loop / GC profiling matters.

## Base URL

Default: \`http://localhost:4567\`. Ask the user if they're running on a
different port. All API endpoints below are relative to this base.

## Concepts

- **Bucket**: A named workspace holding configs, payload files, run history,
  and an optional per-bucket \`.env\`. On disk: \`configs/<bucket>/\`.
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
  Place a \`.env\` at \`configs/<bucket>/.env\` (KEY=value lines) to make
  \`\${UPPER_SNAKE}\` placeholders in the config resolve at run-start time.
- \`GET /api/folders/:name/files/<rel>\` → read a file (returned as JSON if it parses, else text).
- \`DELETE /api/folders/:name/files/<rel>\` → delete a file.

### Runs

- \`POST /api/runs\` body \`{ "folder": "<bucket>", "config": "<config-rel-path>", "target": "http://..." }\`
  → starts a new run. Returns the snapshot
  \`{ id, status, bucket, configRel, configDir, target, startedAt, configHash }\`.
- \`POST /api/runs/:id/stop\` → stop a running run (skips k6 teardown / cooldown
  via two SIGINTs, SIGKILL fallback at 5s).
- \`GET /api/runs\` → list **active** in-memory runs (current process).
- \`GET /api/runs/:id\` → live snapshot + \`tickHistory\` + recent logs.
- \`GET /api/runs-history?folder=<bucket>\` → past runs from disk. Each row:
  \`bucket\`, \`configDir\`, \`configRel\`, \`status\`, \`startedAt\`, \`endedAt\`,
  \`stats\` (requests, rps, p50/p95/p99, errors, failedRate), \`sizeBytes\`.
- \`GET /api/folders/:bucket/runs/:configDir/:id\` → full detail:
  \`{ meta, summary, summaryTxt, ticks[], log, hasMemory, configSnapshot }\`.
  - \`meta.configHash\` — SHA-256 of the **resolved** config (after \`.env\`
    substitution). Two runs with matching hashes are apples-to-apples.
  - \`meta.orphaned\` — \`true\` if the run was reaped on server boot (k6-studio
    crashed mid-run). Treat results as a prefix of what really happened.
  - \`configSnapshot\` — the resolved config that actually ran (env-vars
    substituted in).
  - \`summary\` — raw k6 \`handleSummary\` payload.
  - \`summaryTxt\` — rendered Node.js performance report (verdicts + sections).
  - \`ticks[]\` — per-second buckets:
    \`{ t, rps, p50, p95, p99, errors, vus, dropped, memory: {...} }\`.
- \`GET /api/folders/:bucket/runs/:configDir/:id/eject.js\` → self-contained k6
  script with the config + payloads inlined. Run with \`k6 run <file>\` outside
  the tool when the JSON shape can't represent your case.
- \`DELETE /api/folders/:bucket/runs/:configDir/:id\` → delete one run.

### Reports

- \`GET /report/:bucket/:configDir/:id\` → standalone HTML report page.

## WebSocket /ws?run=<id>

Connect after starting a run. The server replays history on connect, then
streams live events. Message types:

- \`{ "type": "hello", "run": {...snapshot...} }\` — first.
- \`{ "type": "tick", "t": <ms>, "rps", "p50", "p95", "p99", "errors", "vus",
    "dropped", "memory": { "heapMB", "rssMB", "cpuPercent",
                            "eldMean", "eldP99", "eldMax", "handles", ... } }\`
  every second. \`dropped > 0\` means the configured arrival rate exceeded
  the VU pool — bump \`preAllocatedVUs\` / \`maxVUs\`.
- \`{ "type": "log", "t": <ms>, "line": "..." }\`.
- \`{ "type": "status", "status": "running" | "completed" | "failed" | "stopped", ... }\`.
- \`{ "type": "summary", "data": {...} }\` after exit.

## Config JSON shape

\`\`\`jsonc
{
  // ---- Load shape: pick ONE of these ----
  //
  // (a) Legacy single-scenario top-level form:
  "executor": "constant-arrival-rate",
  "rate": 30, "timeUnit": "1s", "loadDuration": "3m",
  "preAllocatedVUs": 15, "maxVUs": 60,
  //
  // (b) Multi-scenario form (replaces top-level executor fields):
  // "scenarios": [
  //   { "name": "baseline", "executor": "constant-arrival-rate",
  //     "rate": 30, "loadDuration": "5m",
  //     "preAllocatedVUs": 30, "maxVUs": 100 },
  //   { "name": "burst", "executor": "ramping-arrival-rate",
  //     "startTime": "1m",
  //     "stages": [{ "duration": "10s", "rate": 1000 },
  //                { "duration": "30s", "rate": 1000 },
  //                { "duration": "10s", "rate": 0 }],
  //     "preAllocatedVUs": 200, "maxVUs": 800 }
  // ]
  //
  // Supported executors:
  //   constant-arrival-rate   fixed RPS for loadDuration
  //   ramping-arrival-rate    stage-based RPS targets
  //   ramping-vus             stage-based VU targets (throughput depends on server)
  //   shared-iterations       fire N total iterations and exit
  //   per-vu-iterations       fire N iterations per VU and exit
  //   constant-vus            steady VUs for duration
  //   ramp-until              SATURATION: ramp RPS up until stopCondition trips, then abort
  //     { "executor": "ramp-until",
  //       "stopCondition": "http_req_duration{p99} > 1000",
  //       "startRate": 50, "stepRate": 100, "stepDuration": "20s", "maxRate": 10000 }

  "target": "http://localhost:8080",      // overridable per run
  "healthPath": "/health",                // optional setup() probe

  // ---- Per-VU data parameterization ----
  // Use \${name.random()} or \${name.byVu()} in params/headers/path/body.
  // Append .field after the call for objects (CSV rows, JSON-of-objects).
  "data": {
    "users": { "file": "./users.csv" },              // CSV → array of {col: val}
    "events": { "file": "./events.json" },           // JSON array
    "refs":  { "range": [1000, 9999] },              // inclusive ints
    "tags":  { "values": ["foo", "bar", "baz"] }     // inline
  },

  // ---- .env vars ----
  // Place configs/<bucket>/.env with KEY=value lines. \${UPPER_SNAKE}
  // refs anywhere in this JSON are substituted at run-start. The
  // resolved version is what gets snapshotted + hashed.
  // .env wins over process.env.

  "tokens": ["..."],                      // \${token} (lowercase) -> random pick

  "memorySampling": {
    "enabled": true,
    "intervalSeconds": 2,
    "endpoint": "/debug/procstats",
    "cooldownSeconds": 180                // 0 = no cooldown sample
  },

  "thresholds": { "http_req_duration": ["p(95)<500"] },

  // ---- External-tool hooks (off by default) ----
  // Disabled unless server has K6_STUDIO_HOOKS_ENABLED=1 AND the first
  // token of each command is in K6_STUDIO_HOOKS_ALLOWED_BINARIES.
  // Placeholders: <runid> <rundir> <bucket> <configrel> <configdir>.
  "hooks": {
    "preStart": "docker exec my-svc node /tmp/trace.js --clear",
    "onStart":  "docker exec -d my-svc sh -c 'node /tmp/trace.js > /tmp/trace.log &'",
    "onStop":   "docker cp my-svc:/tmp/slow.jsonl <rundir>/slow.jsonl"
  },

  "endpoints": [
    {
      "name":   "get_user",
      "method": "GET",
      "path":   "/v1/users/\${users.byVu().userId}",
      "weight": 10,
      "params":  { "ref": "\${refs.random()}", "tag": "\${tags.random()}" },
      "headers": { "Authorization": "Bearer \${token}",
                   "X-Trace-Id":   "\${TRACE_PREFIX}-\${users.byVu().userId}" },
      // Rich checks: status family + body + headers + JSONPath
      "checks": {
        "status2xx": true,
        "headers":  { "x-cache-status": "HIT" },
        "jsonPath": {
          "$.id":       { "exists": true },
          "$.total":    { ">=": 10 },
          "$.status":   "ok",
          "$.tags[0]":  { "matches": "^foo" }
        }
      }
    },
    {
      "name":    "post_event",
      "method":  "POST",
      "path":    "/v1/events",
      "body":    { "actorId": "\${users.byVu().userId}", "type": "click" },
      // OR "bodyFile": "./payload/big-event.json"
      "checks":  { "status2xx": true }
    }
  ]
}
\`\`\`

## Workflows

### Start a run and wait for it to finish

\`\`\`text
1. POST /api/runs { folder, config, target } -> { id, configDir, configHash }
2. Open WS /ws?run=<id>
3. Read ticks. Bail early if tick.dropped > 0 — config is mis-shaped.
4. Stop on { type:"status", status:"completed"|"failed"|"stopped" }.
5. GET /api/folders/<bucket>/runs/<configDir>/<id> for summaryTxt + summary.
\`\`\`

### Compare two runs of the same config

\`\`\`text
1. GET /api/runs-history?folder=<bucket>; filter rows by configDir.
2. Compare meta.configHash on the candidates — if they differ, the
   configs themselves changed, so the comparison is not apples-to-apples;
   warn the user.
3. For each, GET /api/folders/<bucket>/runs/<configDir>/<id> for detail.
4. Diff summary.metrics directly, or point the user at
   /compare/<bucket>/<configDir>?a=<idA>&b=<idB> in a browser.
\`\`\`

### Find the saturation rate

\`\`\`text
Use the "ramp-until" executor:
{
  "executor": "ramp-until",
  "stopCondition": "http_req_duration{p99} > 1000",
  "startRate": 50, "stepRate": 100, "stepDuration": "20s",
  "maxRate": 10000, "preAllocatedVUs": 200, "maxVUs": 2000,
  "endpoints": [...]
}
k6 aborts when the condition trips. The last completed stage in the run's
tick stream is roughly the saturation rate.
\`\`\`

### Extend beyond the JSON config

When the JSON shape doesn't fit, eject the run:

\`\`\`text
GET /api/folders/<bucket>/runs/<configDir>/<id>/eject.js
\`\`\`

Returns a single-file k6 script with config + payloads inlined. The user
edits and runs with \`k6 run <file>\`. Useful escape hatch.

## Metric meanings (Node.js services)

- \`http_reqs.count\` / \`.rate\` — total requests / per-second throughput.
- \`http_req_duration.p(95)\` — p95 latency in ms.
- \`http_req_failed.rate\` — fraction of HTTP-layer failures (5xx / network).
- \`errors.count\` — failed *checks* (validation-layer; config assertions).
  These are intentionally separate: a 200 with the wrong body shape only
  shows up in \`errors\`, while a 500 only in \`http_req_failed\`.
- \`dropped_iterations\` — arrival rate exceeded the VU pool. Non-zero is a
  **config bug**, not a service bug.
- \`heap_inuse_bytes\` — V8 heap currently used. Rising across runs = leak.
  Compare to \`baseline_heap_mb\` and \`cooldown_heap_mb\`.
- \`peak_heap_mb\` / \`peak_rss_mb\` / \`peak_cpu_percent\` — high-water marks.
- \`event_loop_delay_p99_ms\` / \`event_loop_delay_max_ms\` — JS thread
  blocking. >100ms p99 is bad. Many target services emit cumulative
  percentiles so max is the more reliable spike indicator.
- \`gc_max_ms\` — longest GC pause. >100ms is user-perceptible lag.
- \`active_handles\` — libuv handles open. Monotonic growth = unclosed
  connections / timers.
- \`cooldown_*\` — sampled after \`memorySampling.cooldownSeconds\` of idle.
  Close to baseline = no leak. Close to peak = suspect a leak.

## Conventions

- URL-encode \`bucket\`, \`configDir\`, and \`runId\`.
- Don't \`rm -rf configs/\` — that's user data. Use the API.
- A run exists on disk the moment it starts; \`meta.json\` is written first,
  \`summary.json\` / \`summary.txt\` / \`ticks.jsonl\` only after exit.
- If a run shows \`meta.orphaned: true\`, the server (not the test) was
  killed mid-run. Treat results as truncated; the target may have kept
  receiving load briefly after.
- When a config references \`\${KEY}\` and the value isn't in
  \`<bucket>/.env\` or \`process.env\`, the literal token is left in place
  (intentional — easier to spot a missing override).
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

// configs/ is a host-mounted volume. On Docker Desktop (macOS/Windows) every
// fs syscall crosses the VM boundary at ~4-5ms vs ~0.2ms on a native layer, so
// a sequential `for (…) await` walk over a few hundred files costs seconds.
// Fanning the same calls out concurrently hides that latency; the bound keeps
// us clear of EMFILE on buckets with thousands of run artifacts.
const FS_CONCURRENCY = 64;

async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  const workers = new Array(Math.min(limit, items.length)).fill(0).map(async () => {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      out[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return out;
}

async function listFolders() {
  const entries = await fs.readdir(FOLDERS_DIR, { withFileTypes: true });
  const dirs = entries.filter((e) => e.isDirectory());
  const out = await mapLimit(dirs, FS_CONCURRENCY, async (e) => {
    const dir = path.join(FOLDERS_DIR, e.name);
    const [stat, scan] = await Promise.all([fs.stat(dir), scanFolder(dir)]);
    return { name: e.name, mtime: stat.mtimeMs, fileCount: scan.fileCount, configs: scan.configs };
  });
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
    await mapLimit(entries, FS_CONCURRENCY, async (e) => {
      // The runs/ subtree at the bucket root is reserved for run output;
      // it shouldn't show up in file counts or config detection.
      if (rel === "" && e.name === RUNS_SUBDIR) return;
      const full = path.join(current, e.name);
      const childRel = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) {
        await walk(full, childRel);
      } else if (e.isFile()) {
        fileCount += 1;
        if (e.name.endsWith(".json")) {
          try {
            const [txt, stat] = await Promise.all([fs.readFile(full, "utf8"), fs.stat(full)]);
            const json = JSON.parse(txt);
            if (Array.isArray(json.endpoints) && json.endpoints.length > 0) {
              configs.push({ path: childRel, mtime: stat.mtimeMs });
            }
          } catch {}
        }
      }
    });
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
        meta.error =
          "server stopped before run finished — k6-studio was restarted mid-run; the target may have continued receiving load until the k6 child also exited.";
        meta.orphaned = true;
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
  const wanted = buckets.filter((b) => b.isDirectory() && (!filter || b.name === filter));
  const perBucket = await mapLimit(wanted, FS_CONCURRENCY, (b) => readRunsForBucket(b.name));
  for (const rows of perBucket) out.push(...rows);
  out.sort((a, b) => (b.startedAt || 0) - (a.startedAt || 0));
  res.json(out);
});

// A finished run directory is immutable, so its row (including the recursive
// size walk) only has to be computed once. Keyed by run dir; validated against
// the mtimes of meta.json and the run dir itself — two stats instead of a full
// subtree walk. The run dir mtime matters because the onStop hook can drop
// extra files in after meta.json is written.
const runRowCache = new Map();
const TERMINAL_STATUSES = new Set(["completed", "failed", "stopped"]);
// Don't freeze a row the instant it finishes; give onStop hooks time to land
// their files, otherwise we could cache a size taken mid-copy.
const RUN_CACHE_GRACE_MS = 30_000;

async function runDirValidator(runDir) {
  const [metaStat, dirStat] = await Promise.all([
    fs.stat(path.join(runDir, "meta.json")).catch(() => null),
    fs.stat(runDir).catch(() => null),
  ]);
  return `${metaStat?.mtimeMs ?? 0}:${metaStat?.size ?? 0}:${dirStat?.mtimeMs ?? 0}`;
}

async function readRunsForBucket(bucket) {
  const runsRoot = path.join(FOLDERS_DIR, bucket, RUNS_SUBDIR);
  let configDirs;
  try {
    configDirs = await fs.readdir(runsRoot, { withFileTypes: true });
  } catch {
    return [];
  }
  const dirs = configDirs.filter((c) => c.isDirectory());
  const perConfig = await mapLimit(dirs, FS_CONCURRENCY, async (c) => {
    const cdir = path.join(runsRoot, c.name);
    let runs;
    try {
      runs = await fs.readdir(cdir, { withFileTypes: true });
    } catch {
      return [];
    }
    const runDirs = runs.filter((r) => r.isDirectory());
    const rows = await mapLimit(runDirs, FS_CONCURRENCY, (r) =>
      readRunRow(bucket, c.name, r.name, path.join(cdir, r.name)),
    );
    return rows.filter(Boolean);
  });
  return perConfig.flat();
}

async function readRunRow(bucket, configDir, id, runDir) {
  const validator = await runDirValidator(runDir);
  const hit = runRowCache.get(runDir);
  if (hit && hit.validator === validator) return hit.row;

  let meta = null;
  try {
    meta = JSON.parse(await fs.readFile(path.join(runDir, "meta.json"), "utf8"));
  } catch {}
  let stats = null;
  try {
    const summary = JSON.parse(await fs.readFile(path.join(runDir, "summary.json"), "utf8"));
    stats = extractRunStats(summary);
  } catch {}
  if (!meta && !stats) {
    runRowCache.delete(runDir);
    return null;
  }
  const sizeBytes = await dirSize(runDir);
  const row = buildRunRow({ bucket, configDir, id, meta, stats, sizeBytes });

  const settled =
    TERMINAL_STATUSES.has(row.status) &&
    row.endedAt &&
    Date.now() - row.endedAt > RUN_CACHE_GRACE_MS;
  if (settled) runRowCache.set(runDir, { validator, row });
  else runRowCache.delete(runDir);
  return row;
}

function buildRunRow({ bucket, configDir, id, meta, stats, sizeBytes }) {
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
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return 0;
  }
  const sizes = await mapLimit(entries, FS_CONCURRENCY, async (e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return dirSize(p);
    if (!e.isFile()) return 0;
    try {
      const st = await fs.stat(p);
      return st.size;
    } catch {
      return 0;
    }
  });
  return sizes.reduce((a, b) => a + b, 0);
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
// Eject a run's config + payloads into a self-contained k6 script. The user
// downloads it, edits it freely, and runs `k6 run <file>` outside the tool
// when the JSON config no longer fits their use case. Bridges the casual /
// power-user gap without forcing them to rewrite from scratch.
app.get("/api/folders/:bucket/runs/:configDir/:id/eject.js", async (req, res) => {
  const bucket = safeName(req.params.bucket);
  const cdir = safeName(req.params.configDir);
  const id = safeName(req.params.id);
  const runDir = path.join(FOLDERS_DIR, bucket, RUNS_SUBDIR, cdir, id);
  let cfg;
  try {
    cfg = JSON.parse(
      await fs.readFile(path.join(runDir, "config.snapshot.json"), "utf8"),
    );
  } catch {
    return res.status(404).type("text/plain").send("config.snapshot.json not found");
  }
  // Resolve bodyFile refs against the *bucket dir* (where payloads live).
  const bucketDir = path.join(FOLDERS_DIR, bucket);
  for (const ep of cfg.endpoints || []) {
    if (ep.bodyFile) {
      try {
        const abs = ep.bodyFile.startsWith("/")
          ? ep.bodyFile
          : path.join(bucketDir, ep.bodyFile);
        const txt = await fs.readFile(abs, "utf8");
        ep.body = JSON.parse(txt);
        delete ep.bodyFile;
      } catch {
        // leave bodyFile reference if we can't read it
      }
    }
  }
  res
    .type("application/javascript")
    .set(
      "Content-Disposition",
      `attachment; filename="${bucket}-${cdir}-${id}.k6.js"`,
    )
    .send(renderEjectScript(cfg, { bucket, configDir: cdir, id }));
});

function renderEjectScript(cfg, meta) {
  return `// k6-studio eject — self-contained k6 script for ${meta.bucket} / ${meta.configDir} / ${meta.id}.
// Run with:  k6 run ${meta.bucket}-${meta.configDir}-${meta.id}.k6.js
//   Override target:  k6 run --env TARGET=http://localhost:9000 ${meta.bucket}-${meta.configDir}-${meta.id}.k6.js
//
// Generated from config.snapshot.json with payloads inlined. Edit freely — this
// file is yours.

const CONFIG = ${JSON.stringify(cfg, null, 2)};

${EJECT_SCRIPT_TEMPLATE}
`;
}

// The bulk of loadtest.js, parameterized over CONFIG instead of __ENV.CONFIG.
// Kept inline as a string so the ejected file is single-file portable. When
// loadtest.js changes shape this string must be re-derived from it.
const EJECT_SCRIPT_TEMPLATE = String.raw`
import http from "k6/http";
import { check, sleep } from "k6";
import { Counter, Trend } from "k6/metrics";
import { SharedArray } from "k6/data";
import exec from "k6/execution";
import { textSummary } from "https://jslib.k6.io/k6-summary/0.1.0/index.js";

const TARGET = __ENV.TARGET || CONFIG.target || "http://localhost:8080";
const config = CONFIG;
const errors = new Counter("errors");
const endpointLatency = {};
config.endpoints.forEach((ep) => {
  endpointLatency[ep.name] = new Trend("ep_" + ep.name + "_latency");
});

// ---- Data sources (per-VU parameterization) ----
// Ranges are lazy — never materialized — so namespaces of hundreds of
// millions of IDs don't OOM the VU at init.
const dataSources = {};
for (const [name, def] of Object.entries(config.data || {})) {
  if (def.range && Array.isArray(def.range)) {
    const [a, b] = def.range;
    dataSources[name] = { __range: true, a, b, length: b - a + 1 };
    continue;
  }
  dataSources[name] = new SharedArray(name, () => {
    if (Array.isArray(def.values)) return def.values;
    if (def.file) {
      const txt = open(def.file);
      if (def.file.endsWith(".csv")) {
        const lines = txt.split(/\r?\n/).filter((l) => l.length > 0);
        if (lines.length === 0) return [];
        const headers = lines[0].split(",").map((h) => h.trim());
        return lines.slice(1).map((line) => {
          const cells = line.split(",");
          const row = {};
          for (let i = 0; i < headers.length; i++) row[headers[i]] = (cells[i] || "").trim();
          return row;
        });
      }
      return JSON.parse(txt);
    }
    return [];
  });
}
function pickFromSource(src, mode, vu) {
  if (src && src.__range) {
    if (src.length <= 0) return undefined;
    let n;
    if (mode === "random") n = src.a + Math.floor(Math.random() * src.length);
    else if (mode === "byVu") n = src.a + ((vu - 1) % src.length);
    else return undefined;
    return n;
  }
  if (!src || src.length === 0) return undefined;
  let idx;
  if (mode === "random") idx = Math.floor(Math.random() * src.length);
  else if (mode === "byVu") idx = (vu - 1) % src.length;
  else return undefined;
  return src[idx];
}
const DATA_REF_RE = /\$\{([a-z][a-zA-Z0-9_]*)\.([a-zA-Z]+)\(\)(?:\.([a-zA-Z0-9_]+))?\}/g;
function expandTemplate(s, vu) {
  if (typeof s !== "string") return s;
  let out = s;
  if (out.includes("\${token}")) {
    const t = getRandomToken();
    out = out.split("\${token}").join(t || "");
  }
  out = out.replace(DATA_REF_RE, (m, name, mode, field) => {
    const v = pickFromSource(dataSources[name], mode, vu);
    if (v === undefined) return m;
    if (field !== undefined) return v && typeof v === "object" ? String(v[field] ?? "") : "";
    return String(v);
  });
  return out;
}
function expandValue(v, vu) {
  if (typeof v === "string") return expandTemplate(v, vu);
  if (Array.isArray(v)) return v.map((x) => expandValue(x, vu));
  if (v && typeof v === "object") {
    const out = {};
    for (const [k, val] of Object.entries(v)) out[k] = expandValue(val, vu);
    return out;
  }
  return v;
}

function parseDurationS(s) {
  const re = /(\d+(?:\.\d+)?)([smhd])/g;
  const factors = { s: 1, m: 60, h: 3600, d: 86400 };
  let total = 0, m;
  while ((m = re.exec(String(s))) !== null) total += parseFloat(m[1]) * factors[m[2]];
  return total;
}

function buildScenario(s) {
  const exec = s.exec || "runEndpoint";
  const base = { exec, gracefulStop: s.gracefulStop || "1s" };
  if (s.startTime) base.startTime = s.startTime;
  switch (s.executor) {
    case "constant-arrival-rate":
      return { ...base, executor: "constant-arrival-rate",
        rate: s.rate || 20, timeUnit: s.timeUnit || "1s",
        duration: s.loadDuration || s.duration || "3m",
        preAllocatedVUs: s.preAllocatedVUs || 50, maxVUs: s.maxVUs || 200 };
    case "ramping-arrival-rate":
      return { ...base, executor: "ramping-arrival-rate",
        startRate: s.startRate ?? 0, timeUnit: s.timeUnit || "1s",
        stages: (s.stages || []).map((x) => ({ duration: x.duration, target: x.rate ?? x.target ?? 0 })),
        preAllocatedVUs: s.preAllocatedVUs || 50, maxVUs: s.maxVUs || 200 };
    case "ramp-until": {
      const startRate = s.startRate ?? 50;
      const maxRate = s.maxRate ?? 10000;
      const stepRate = s.stepRate ?? Math.max(1, Math.floor((maxRate - startRate) / 20));
      const stepDuration = s.stepDuration || "30s";
      const stages = [];
      let r = startRate + stepRate;
      while (r <= maxRate) { stages.push({ duration: stepDuration, target: r }); r += stepRate; }
      if (stages.length === 0) stages.push({ duration: stepDuration, target: maxRate });
      return { ...base, executor: "ramping-arrival-rate",
        startRate, timeUnit: s.timeUnit || "1s", stages,
        preAllocatedVUs: s.preAllocatedVUs || 50, maxVUs: s.maxVUs || 2000 };
    }
    case "shared-iterations":
      return { ...base, executor: "shared-iterations",
        iterations: s.iterations || 100, vus: s.vus || 10, maxDuration: s.maxDuration || "10m" };
    case "per-vu-iterations":
      return { ...base, executor: "per-vu-iterations",
        iterations: s.iterations || 10, vus: s.vus || 10, maxDuration: s.maxDuration || "10m" };
    case "constant-vus":
      return { ...base, executor: "constant-vus",
        vus: s.vus || 10, duration: s.duration || s.loadDuration || "3m" };
    case "ramping-vus":
    default:
      return { ...base, executor: "ramping-vus",
        startVUs: s.startVUs ?? 0,
        stages: (s.stages || []).map((x) => ({ duration: x.duration, target: x.vus ?? x.target ?? 0 })),
        gracefulRampDown: s.gracefulRampDown || "30s" };
  }
}

const specs = Array.isArray(config.scenarios) && config.scenarios.length > 0
  ? config.scenarios.map((s, i) => ({ name: s.name || ("scenario" + i), spec: s }))
  : [{ name: "load_test", spec: {
      executor: config.executor || "ramping-vus",
      rate: config.rate, timeUnit: config.timeUnit,
      loadDuration: config.loadDuration, duration: config.duration,
      startRate: config.startRate, startVUs: config.startVUs,
      stages: config.stages, preAllocatedVUs: config.preAllocatedVUs, maxVUs: config.maxVUs,
      iterations: config.iterations, vus: config.vus, maxDuration: config.maxDuration,
      gracefulRampDown: config.gracefulRampDown,
    } }];
const scenarios = {};
for (const { name, spec } of specs) scenarios[name] = buildScenario(spec);

export const options = {
  scenarios,
  thresholds: config.thresholds || {},
  summaryTrendStats: ["avg", "min", "med", "max", "p(90)", "p(95)", "p(99)"],
};

const iterationCounts = {};
config.endpoints.forEach((ep) => { iterationCounts[ep.name] = 0; });

function getRandomToken() {
  if (!config.tokens || config.tokens.length === 0) return null;
  return config.tokens[Math.floor(Math.random() * config.tokens.length)];
}

function selectEndpoint() {
  const active = config.endpoints.filter((ep) => !ep.maxIterations || iterationCounts[ep.name] < ep.maxIterations);
  if (active.length === 0) return null;
  const total = active.reduce((s, e) => s + (e.weight || 1), 0);
  let r = Math.random() * total, cum = 0;
  for (const ep of active) { cum += ep.weight || 1; if (r < cum) { iterationCounts[ep.name]++; return ep; } }
  const last = active[active.length - 1]; iterationCounts[last.name]++; return last;
}

function buildUrl(ep, vu) {
  let url = TARGET + expandTemplate(ep.path, vu);
  if (ep.params && Object.keys(ep.params).length > 0) {
    const parts = [];
    for (const [k, v] of Object.entries(ep.params)) parts.push(encodeURIComponent(k) + "=" + encodeURIComponent(expandTemplate(String(v), vu)));
    url += "?" + parts.join("&");
  }
  return url;
}
function buildHeaders(ep, vu) {
  const headers = {};
  if (ep.headers) {
    for (const [k, v] of Object.entries(ep.headers)) headers[k] = expandTemplate(String(v), vu);
  }
  return headers;
}
function runChecks(ep, response) {
  const c = ep.checks || {}, out = {};
  if (c.status !== undefined) out[ep.name + " status is " + c.status] = response.status === c.status;
  if (c.statusNot5xx) out[ep.name + " status not 5xx"] = response.status < 500;
  if (c.status2xx) out[ep.name + " status is 2xx"] = response.status >= 200 && response.status < 300;
  if (c.bodyContains) out[ep.name + " body contains"] = response.body && response.body.includes(c.bodyContains);
  if (c.headers && typeof c.headers === "object") {
    const hs = response.headers || {};
    for (const [k, expected] of Object.entries(c.headers)) {
      const actual = hs[k] ?? hs[k.toLowerCase()] ?? hs[k.toUpperCase()];
      out[ep.name + " header " + k + "=" + expected] = String(actual) === String(expected);
    }
  }
  if (c.jsonPath && typeof c.jsonPath === "object") {
    let parsed = null;
    try { parsed = JSON.parse(response.body); } catch {}
    for (const [path, expected] of Object.entries(c.jsonPath)) {
      out[ep.name + " " + path] = matchExpectation(readJsonPath(parsed, path), expected);
    }
  }
  if (Object.keys(out).length === 0) out[ep.name + " responded"] = response.status > 0;
  return check(response, out);
}
function readJsonPath(root, path) {
  if (typeof path !== "string" || !path.startsWith("$")) return undefined;
  let cur = root, i = 1;
  while (i < path.length && cur !== undefined && cur !== null) {
    const ch = path[i];
    if (ch === ".") {
      i++;
      let end = i;
      while (end < path.length && /[a-zA-Z0-9_]/.test(path[end])) end++;
      cur = cur[path.slice(i, end)]; i = end;
    } else if (ch === "[") {
      const close = path.indexOf("]", i);
      if (close === -1) return undefined;
      const idx = parseInt(path.slice(i + 1, close), 10);
      cur = Array.isArray(cur) ? cur[idx] : undefined; i = close + 1;
    } else { i++; }
  }
  return cur;
}
function matchExpectation(value, expected) {
  if (expected === null) return value === null;
  if (typeof expected !== "object") return value === expected || String(value) === String(expected);
  if ("exists" in expected) return expected.exists ? value !== undefined : value === undefined;
  if ("equals" in expected) return value === expected.equals || String(value) === String(expected.equals);
  if ("contains" in expected) return typeof value === "string" && value.includes(expected.contains);
  if ("matches" in expected) return typeof value === "string" && new RegExp(expected.matches).test(value);
  if (">=" in expected) return Number(value) >= Number(expected[">="]);
  if ("<=" in expected) return Number(value) <= Number(expected["<="]);
  if (">" in expected) return Number(value) > Number(expected[">"]);
  if ("<" in expected) return Number(value) < Number(expected["<"]);
  return false;
}

export function runEndpoint() {
  const ep = selectEndpoint();
  if (!ep) { sleep(0.1); return; }
  const vu = exec.vu.idInTest;
  const url = buildUrl(ep, vu);
  const headers = buildHeaders(ep, vu);
  const method = (ep.method || "GET").toUpperCase();
  const bodyValue = ep.body !== undefined ? expandValue(ep.body, vu) : undefined;
  const bodyText = bodyValue !== undefined ? JSON.stringify(bodyValue) : null;
  const params = { headers, tags: { name: ep.name } };
  let response;
  switch (method) {
    case "POST": if (bodyText) headers["Content-Type"] = "application/json";
      response = http.post(url, bodyText, params); break;
    case "PUT": if (bodyText) headers["Content-Type"] = "application/json";
      response = http.put(url, bodyText, params); break;
    case "DELETE": response = http.del(url, null, params); break;
    case "PATCH": if (bodyText) headers["Content-Type"] = "application/json";
      response = http.patch(url, bodyText, params); break;
    default: response = http.get(url, params);
  }
  endpointLatency[ep.name].add(response.timings.duration);
  if (!runChecks(ep, response)) errors.add(1);
  if (ep.waitMs) sleep((ep.waitMs.min + Math.random() * (ep.waitMs.max - ep.waitMs.min)) / 1000);
  else sleep(0.02);
}

export function handleSummary(data) {
  return { stdout: "\n" + textSummary(data, { indent: " ", enableColors: true }) };
}
`;

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
    runRowCache.delete(runDir);
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

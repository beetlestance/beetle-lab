import { spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LOADTEST_SCRIPT = path.join(__dirname, "loadtest.js");

function percentile(sorted, p) {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[idx];
}

// Map k6 metric names emitted by the memory sampler -> tick.memory keys.
// Bytes are converted to MB at consumption time.
const MEMORY_FIELD = {
  heap_inuse_bytes: "heapBytes",
  rss_bytes: "rssBytes",
  external_bytes: "externalBytes",
  active_handles: "handles",
  active_requests: "activeRequests",
  cpu_percent: "cpuPercent",
  system_cpu_percent: "systemCpu",
  event_loop_delay_mean_ms: "eldMean",
  event_loop_delay_p90_ms: "eldP90",
  event_loop_delay_p99_ms: "eldP99",
  event_loop_delay_max_ms: "eldMax",
  heap_total_size_mb: "heapTotalMB",
  heap_size_limit_mb: "heapLimitMB",
};

function normalizeMemory(m) {
  if (!m || Object.keys(m).length === 0) return null;
  const out = {};
  if (m.heapBytes !== undefined) out.heapMB = m.heapBytes / 1048576;
  if (m.rssBytes !== undefined) out.rssMB = m.rssBytes / 1048576;
  if (m.externalBytes !== undefined) out.externalMB = m.externalBytes / 1048576;
  if (m.handles !== undefined) out.handles = m.handles;
  if (m.activeRequests !== undefined) out.activeRequests = m.activeRequests;
  if (m.cpuPercent !== undefined) out.cpuPercent = m.cpuPercent;
  if (m.systemCpu !== undefined) out.systemCpu = m.systemCpu;
  if (m.eldMean !== undefined) out.eldMean = m.eldMean;
  if (m.eldP90 !== undefined) out.eldP90 = m.eldP90;
  if (m.eldP99 !== undefined) out.eldP99 = m.eldP99;
  if (m.eldMax !== undefined) out.eldMax = m.eldMax;
  if (m.heapTotalMB !== undefined) out.heapTotalMB = m.heapTotalMB;
  if (m.heapLimitMB !== undefined) out.heapLimitMB = m.heapLimitMB;
  return Object.keys(out).length ? out : null;
}

class Run extends EventEmitter {
  constructor({ id, configPath, target, runsDir, bucket, configRel, k6Bin = "k6" }) {
    super();
    if (!runsDir) throw new Error("runsDir is required");
    this.id = id;
    this.configPath = configPath;
    this.target = target;
    this.bucketName = bucket || null;
    this.configRel = configRel || null;
    // The runs/ subdir name used for this run's output — needed by clients to
    // construct /run/:bucket/:configDir/:id URLs without re-deriving it.
    this.configDir = runsDir ? path.basename(runsDir) : null;
    this.k6Bin = k6Bin;
    this.dir = path.join(runsDir, id);
    this.metricsPath = path.join(this.dir, "metrics.jsonl");
    this.summaryPath = path.join(this.dir, "summary.json");
    this.summaryTxtPath = path.join(this.dir, "summary.txt");
    this.logPath = path.join(this.dir, "log.txt");
    this.metaPath = path.join(this.dir, "meta.json");
    this.status = "pending";
    this.startedAt = null;
    this.endedAt = null;
    this.exitCode = null;
    this.error = null;
    this.stopRequested = false;
    this.proc = null;
    this.logLines = [];
    this.tickHistory = [];
    this.metricNames = {};
    this.bucket = null;
    this.bucketTimer = null;
    this.tailer = null;
    this.aliveFlag = true;
  }

  async start() {
    await fsp.mkdir(this.dir, { recursive: true });
    fs.writeFileSync(this.metricsPath, "");
    this.logStream = fs.createWriteStream(this.logPath, { flags: "a" });

    const env = {
      ...process.env,
      CONFIG: this.configPath,
      CONFIG_DIR: path.dirname(this.configPath),
      SUMMARY_PATH: this.summaryPath,
      SUMMARY_TXT_PATH: this.summaryTxtPath,
    };
    if (this.target) env.TARGET = this.target;

    const args = [
      "run",
      "--quiet",
      "--out",
      `json=${this.metricsPath}`,
      LOADTEST_SCRIPT,
    ];

    this.status = "running";
    this.startedAt = Date.now();
    await this._writeMeta();
    this.emit("status", { status: this.status, startedAt: this.startedAt });

    this.proc = spawn(this.k6Bin, args, { env, cwd: __dirname });

    this.proc.stdout.on("data", (chunk) => this._handleLog(chunk));
    this.proc.stderr.on("data", (chunk) => this._handleLog(chunk));

    this.proc.on("error", (err) => {
      this.status = "failed";
      this.error = err.message;
      this.emit("status", { status: this.status, error: this.error });
    });

    this.proc.on("exit", (code) => {
      this.exitCode = code;
      this._stopTailing();
      // Drain final tail and read summary, then emit completion.
      setTimeout(async () => {
        await this._drainTail();
        this._flushBucket(true);
        let summary = null;
        try {
          summary = JSON.parse(await fsp.readFile(this.summaryPath, "utf8"));
        } catch {}
        this.endedAt = Date.now();
        if (this.stopRequested) {
          this.status = "stopped";
        } else if (code === 0 || code === 99) {
          // 99 = thresholds crossed; the test still ran.
          this.status = "completed";
          if (code === 99) this.thresholdFailed = true;
        } else {
          this.status = "failed";
          if (!this.error) this.error = `k6 exited with code ${code}`;
        }
        await this._writeMeta();
        this.emit("summary", summary);
        this.emit("status", {
          status: this.status,
          endedAt: this.endedAt,
          exitCode: code,
          error: this.error,
        });
      }, 500);
    });

    this._startTailing();
    this._startBucketTimer();
  }

  stop() {
    if (!this.proc || this.status !== "running") return;
    this.stopRequested = true;
    // First SIGINT: stops scenarios but k6 still runs teardown (cooldown).
    // Second SIGINT shortly after: per k6 docs, skips teardown.
    // SIGKILL fallback: belt-and-suspenders if k6 is wedged.
    try { this.proc.kill("SIGINT"); } catch {}
    setTimeout(() => {
      if (this.proc && this.proc.exitCode === null) {
        try { this.proc.kill("SIGINT"); } catch {}
      }
    }, 250);
    setTimeout(() => {
      if (this.proc && this.proc.exitCode === null) {
        try { this.proc.kill("SIGKILL"); } catch {}
      }
    }, 5000);
  }

  _handleLog(chunk) {
    const text = chunk.toString("utf8");
    this.logStream?.write(text);
    text.split(/\r?\n/).forEach((line) => {
      if (line.length === 0) return;
      const entry = { t: Date.now(), line };
      this.logLines.push(entry);
      if (this.logLines.length > 2000) this.logLines.shift();
      this.emit("log", entry);
    });
  }

  _startTailing() {
    let offset = 0;
    let buffer = "";
    const tick = async () => {
      if (!this.aliveFlag) return;
      try {
        const stat = await fsp.stat(this.metricsPath);
        if (stat.size > offset) {
          const fd = await fsp.open(this.metricsPath, "r");
          const len = stat.size - offset;
          const buf = Buffer.alloc(len);
          await fd.read(buf, 0, len, offset);
          await fd.close();
          offset = stat.size;
          buffer += buf.toString("utf8");
          let nl;
          while ((nl = buffer.indexOf("\n")) !== -1) {
            const line = buffer.slice(0, nl);
            buffer = buffer.slice(nl + 1);
            if (line) this._handleMetricLine(line);
          }
        }
      } catch {}
      this.tailer = setTimeout(tick, 250);
    };
    this._tailState = () => ({ offset, buffer });
    this.tailer = setTimeout(tick, 100);
  }

  _stopTailing() {
    this.aliveFlag = false;
    if (this.tailer) clearTimeout(this.tailer);
    if (this.bucketTimer) clearInterval(this.bucketTimer);
  }

  async _drainTail() {
    try {
      const data = await fsp.readFile(this.metricsPath, "utf8");
      const state = this._tailState ? this._tailState() : { offset: 0, buffer: "" };
      const remaining = data.slice(state.offset) + state.buffer;
      remaining.split("\n").forEach((line) => {
        if (line) this._handleMetricLine(line);
      });
    } catch {}
  }

  _handleMetricLine(line) {
    let evt;
    try {
      evt = JSON.parse(line);
    } catch {
      return;
    }
    if (evt.type === "Metric") {
      this.metricNames[evt.data.name] = evt.data;
      return;
    }
    if (evt.type !== "Point") return;
    const metricName = evt.metric;
    const value = evt.data.value;
    const time = new Date(evt.data.time).getTime();
    const tags = evt.data.tags || {};
    if (!this.bucket) this._openBucket(time);
    if (time >= this.bucket.windowEnd) {
      this._flushBucket();
      this._openBucket(time);
    }
    this._recordPoint(metricName, value, tags);
  }

  _openBucket(time) {
    const start = Math.floor(time / 1000) * 1000;
    this.bucket = {
      windowStart: start,
      windowEnd: start + 1000,
      reqs: 0,
      durations: [],
      failed: 0,
      vus: 0,
      iterations: 0,
      errors: 0,
      endpointLatencies: {},
      memory: {},
    };
  }

  _recordPoint(name, value, tags) {
    const b = this.bucket;
    if (name === "http_reqs") b.reqs += value;
    else if (name === "http_req_duration") b.durations.push(value);
    else if (name === "http_req_failed") {
      if (value > 0) b.failed += 1;
    } else if (name === "vus") b.vus = Math.max(b.vus, value);
    else if (name === "iterations") b.iterations += value;
    else if (name === "errors") b.errors += value;
    else if (name.startsWith("ep_") && name.endsWith("_latency")) {
      const ep = name.slice(3, -"_latency".length);
      if (!b.endpointLatencies[ep]) b.endpointLatencies[ep] = [];
      b.endpointLatencies[ep].push(value);
    } else if (name in MEMORY_FIELD) {
      // Latest-value-wins per second is the right shape for memory gauges.
      b.memory[MEMORY_FIELD[name]] = value;
    }
  }

  _startBucketTimer() {
    // Emit bucket every second even if no points arrived (so charts keep advancing).
    this.bucketTimer = setInterval(() => {
      if (this.bucket && Date.now() >= this.bucket.windowEnd) {
        this._flushBucket();
      }
    }, 500);
  }

  _flushBucket(final = false) {
    if (!this.bucket) return;
    const b = this.bucket;
    const durations = b.durations.slice().sort((a, b) => a - b);
    const tick = {
      t: b.windowStart,
      rps: b.reqs,
      p50: percentile(durations, 50),
      p95: percentile(durations, 95),
      p99: percentile(durations, 99),
      avg: durations.length ? durations.reduce((s, v) => s + v, 0) / durations.length : 0,
      failed: b.failed,
      errors: b.errors,
      vus: b.vus,
      iterations: b.iterations,
      endpoints: Object.fromEntries(
        Object.entries(b.endpointLatencies).map(([k, vs]) => {
          const sorted = vs.slice().sort((a, b) => a - b);
          return [k, { count: vs.length, p95: percentile(sorted, 95) }];
        }),
      ),
      memory: normalizeMemory(b.memory),
    };
    this.tickHistory.push(tick);
    if (this.tickHistory.length > 1800) this.tickHistory.shift();
    this.emit("tick", tick);
    if (final) {
      this.bucket = null;
    } else {
      this._openBucket(b.windowEnd);
    }
  }

  snapshot() {
    return {
      id: this.id,
      status: this.status,
      startedAt: this.startedAt,
      endedAt: this.endedAt,
      exitCode: this.exitCode,
      error: this.error,
      target: this.target,
      configPath: this.configPath,
      bucket: this.bucketName,
      configRel: this.configRel,
      configDir: this.configDir,
    };
  }

  async _writeMeta() {
    try {
      await fsp.writeFile(this.metaPath, JSON.stringify(this.snapshot(), null, 2));
    } catch {}
  }
}

// Re-aggregate a saved metrics.jsonl into per-second tick buckets — used by
// the server when serving historical runs (the live aggregator's tick state
// only lives in memory).
export async function aggregateMetricsFile(metricsPath) {
  let text;
  try {
    text = await fsp.readFile(metricsPath, "utf8");
  } catch {
    return [];
  }
  const ticks = [];
  let bucket = null;
  const openBucket = (time) => {
    const start = Math.floor(time / 1000) * 1000;
    return {
      windowStart: start,
      windowEnd: start + 1000,
      reqs: 0,
      durations: [],
      failed: 0,
      vus: 0,
      iterations: 0,
      errors: 0,
      endpointLatencies: {},
      memory: {},
    };
  };
  const flush = (b) => {
    const durations = b.durations.slice().sort((a, b) => a - b);
    ticks.push({
      t: b.windowStart,
      rps: b.reqs,
      p50: percentile(durations, 50),
      p95: percentile(durations, 95),
      p99: percentile(durations, 99),
      avg: durations.length ? durations.reduce((s, v) => s + v, 0) / durations.length : 0,
      failed: b.failed,
      errors: b.errors,
      vus: b.vus,
      iterations: b.iterations,
      endpoints: Object.fromEntries(
        Object.entries(b.endpointLatencies).map(([k, vs]) => {
          const sorted = vs.slice().sort((a, b) => a - b);
          return [k, { count: vs.length, p95: percentile(sorted, 95) }];
        }),
      ),
      memory: normalizeMemory(b.memory),
    });
  };
  for (const line of text.split("\n")) {
    if (!line) continue;
    let evt;
    try {
      evt = JSON.parse(line);
    } catch {
      continue;
    }
    if (evt.type !== "Point") continue;
    const time = new Date(evt.data.time).getTime();
    const value = evt.data.value;
    const name = evt.metric;
    if (!bucket) bucket = openBucket(time);
    if (time >= bucket.windowEnd) {
      flush(bucket);
      bucket = openBucket(time);
    }
    if (name === "http_reqs") bucket.reqs += value;
    else if (name === "http_req_duration") bucket.durations.push(value);
    else if (name === "http_req_failed") {
      if (value > 0) bucket.failed += 1;
    } else if (name === "vus") bucket.vus = Math.max(bucket.vus, value);
    else if (name === "iterations") bucket.iterations += value;
    else if (name === "errors") bucket.errors += value;
    else if (name.startsWith("ep_") && name.endsWith("_latency")) {
      const ep = name.slice(3, -"_latency".length);
      if (!bucket.endpointLatencies[ep]) bucket.endpointLatencies[ep] = [];
      bucket.endpointLatencies[ep].push(value);
    } else if (name in MEMORY_FIELD) {
      bucket.memory[MEMORY_FIELD[name]] = value;
    }
  }
  if (bucket) flush(bucket);
  return ticks;
}

export class Runner {
  constructor() {
    this.runs = new Map();
  }

  list() {
    return [...this.runs.values()].map((r) => r.snapshot());
  }

  get(id) {
    return this.runs.get(id);
  }

  async create({ configPath, target, runsDir, bucket, configRel }) {
    const id = `${new Date().toISOString().replace(/[:.]/g, "-")}-${Math.random().toString(36).slice(2, 6)}`;
    const run = new Run({ id, configPath, target, runsDir, bucket, configRel });
    this.runs.set(id, run);
    await run.start();
    return run;
  }
}

import http from "k6/http";
import { check, sleep } from "k6";
import { Counter, Trend, Gauge } from "k6/metrics";
import { SharedArray } from "k6/data";
import exec from "k6/execution";
import { textSummary } from "https://jslib.k6.io/k6-summary/0.1.0/index.js";

// CONFIG points to an absolute path to a JSON config file.
// CONFIG_DIR is its directory (used to resolve bodyFile references).
// TARGET overrides config.target.
// SUMMARY_PATH (optional) is where handleSummary writes summary.json.
// SUMMARY_TXT_PATH (optional) is where the rich text report is written.
const CONFIG_FILE = __ENV.CONFIG;
if (!CONFIG_FILE) throw new Error("CONFIG env var is required");
const CONFIG_DIR = __ENV.CONFIG_DIR || ".";
const config = JSON.parse(open(CONFIG_FILE));

config.endpoints.forEach((ep) => {
  if (ep.bodyFile) {
    const p = ep.bodyFile.startsWith("/") ? ep.bodyFile : `${CONFIG_DIR}/${ep.bodyFile}`;
    ep.body = JSON.parse(open(p));
  }
});

const TARGET = __ENV.TARGET || config.target || "http://localhost:8080";

// ---------- Per-VU data parameterization ----------
// config.data is a map of named data sources usable in params / headers /
// body via ${sourceName.mode()} or ${sourceName.mode().field}.
//   mode = random()   pick uniformly at random per request
//        = byVu()     pick deterministically per VU (sticky across that VU's
//                     iterations — useful for "user N stays user N for the run")
// Source shapes:
//   { "values": [...] }                       inline array of values
//   { "file":   "./users.json" }              JSON array on disk
//   { "file":   "./users.csv", "key": "..." } CSV — headers in first row,
//                                             each row becomes an object
//   { "range":  [start, end] }                inclusive integer range
const dataSources = {};
for (const [name, def] of Object.entries(config.data || {})) {
  dataSources[name] = loadDataSource(name, def);
}

function loadDataSource(name, def) {
  // SharedArray dedupes the data across all VUs so memory stays bounded.
  return new SharedArray(name, () => {
    if (Array.isArray(def.values)) return def.values;
    if (def.range && Array.isArray(def.range)) {
      const [a, b] = def.range;
      const out = [];
      for (let i = a; i <= b; i++) out.push(i);
      return out;
    }
    if (def.file) {
      const p = def.file.startsWith("/") ? def.file : `${CONFIG_DIR}/${def.file}`;
      const txt = open(p);
      if (def.file.endsWith(".csv")) return parseCsv(txt);
      return JSON.parse(txt);
    }
    return [];
  });
}

function parseCsv(text) {
  const lines = text.split(/\r?\n/).filter((l) => l.length > 0);
  if (lines.length === 0) return [];
  const headers = lines[0].split(",").map((h) => h.trim());
  return lines.slice(1).map((line) => {
    const cells = line.split(",");
    const row = {};
    for (let i = 0; i < headers.length; i++) row[headers[i]] = (cells[i] ?? "").trim();
    return row;
  });
}

// Template syntax:
//   ${SOME_VAR}         already resolved server-side (env substitution)
//   ${token}            random pick from config.tokens[] (legacy)
//   ${source.mode()}    pick from a named data source
//   ${source.mode().f}  pick a record then access .f
// VUs are 1-based via k6/execution.
const DATA_REF_RE = /\$\{([a-z][a-zA-Z0-9_]*)\.([a-zA-Z]+)\(\)(?:\.([a-zA-Z0-9_]+))?\}/g;

function expandTemplate(s, vu) {
  if (typeof s !== "string") return s;
  let out = s;
  if (out.includes("${token}")) {
    const t = getRandomToken();
    out = out.split("${token}").join(t || "");
  }
  out = out.replace(DATA_REF_RE, (m, name, mode, field) => {
    const src = dataSources[name];
    if (!src || src.length === 0) return m;
    let idx;
    if (mode === "random") idx = Math.floor(Math.random() * src.length);
    else if (mode === "byVu") idx = (vu - 1) % src.length;
    else return m;
    const v = src[idx];
    if (field !== undefined) return v && typeof v === "object" ? String(v[field] ?? "") : "";
    return String(v);
  });
  return out;
}

// Deep-expand any string leaf in a value (object, array, scalar). Used for
// request bodies so ${...} refs work anywhere in nested JSON.
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

// Standard load metrics
const errors = new Counter("errors");
const endpointLatency = {};
config.endpoints.forEach((ep) => {
  endpointLatency[ep.name] = new Trend(`ep_${ep.name}_latency`);
});

// Memory & runtime metrics — emitted only when memorySampling is enabled.
// Names match the original ecs-content loadtest so the rich report renders
// the same regardless of which service is being measured.
const heapInuse = new Gauge("heap_inuse_bytes");
const activeHandles = new Gauge("active_handles");
const activeRequests = new Gauge("active_requests");
const rssBytes = new Gauge("rss_bytes");
const externalBytes = new Gauge("external_bytes");
const baselineHeap = new Gauge("baseline_heap_mb");
const baselineHandles = new Gauge("baseline_handles");
const baselineRss = new Gauge("baseline_rss_mb");
const peakHeapGauge = new Gauge("peak_heap_mb");
const peakRssGauge = new Gauge("peak_rss_mb");

const cpuPercent = new Gauge("cpu_percent");
const systemCpuPercent = new Gauge("system_cpu_percent");
const baselineCpu = new Gauge("baseline_cpu_percent");
const peakCpuGauge = new Gauge("peak_cpu_percent");
const avgCpuTrend = new Trend("avg_cpu_percent");

const cooldownHeap = new Gauge("cooldown_heap_mb");
const cooldownHandles = new Gauge("cooldown_handles");
const cooldownRss = new Gauge("cooldown_rss_mb");
const cooldownCpu = new Gauge("cooldown_cpu");

const heapSizeLimit = new Gauge("heap_size_limit_mb");
const heapTotalSize = new Gauge("heap_total_size_mb");
const cppHeapAllocated = new Gauge("cpp_heap_allocated_mb");
const cppHeapUsed = new Gauge("cpp_heap_used_mb");

const eventLoopMean = new Trend("event_loop_delay_mean_ms");
const eventLoopP90 = new Gauge("event_loop_delay_p90_ms");
const eventLoopP99 = new Gauge("event_loop_delay_p99_ms");
const eventLoopMax = new Gauge("event_loop_delay_max_ms");

const gcCount = new Gauge("gc_count");
const gcTotalMs = new Gauge("gc_total_ms");
const gcMaxMs = new Gauge("gc_max_ms");
const gcAvgMs = new Gauge("gc_avg_ms");

const uvThreadpoolSize = new Gauge("uv_threadpool_size");

const stages = config.stages || [
  { duration: "30s", target: 10 },
  { duration: "1m", target: 25 },
  { duration: "30s", target: 0 },
];

const iterationCounts = {};
config.endpoints.forEach((ep) => {
  iterationCounts[ep.name] = 0;
});

const memorySamplingEnabled = !!config.memorySampling?.enabled;
const memorySamplerInterval = config.memorySampling?.intervalSeconds || 2;
const memorySamplerEndpoint = config.memorySampling?.endpoint || "/debug/procstats";
const cooldownSeconds = Math.max(0, config.memorySampling?.cooldownSeconds || 0);

function parseDurationS(s) {
  const re = /(\d+(?:\.\d+)?)([smhd])/g;
  const factors = { s: 1, m: 60, h: 3600, d: 86400 };
  let total = 0;
  let m;
  while ((m = re.exec(String(s))) !== null) total += parseFloat(m[1]) * factors[m[2]];
  return total;
}

// Build a k6 scenario object from a (loosely-typed) scenario spec. Spec may be
// either the legacy top-level form (config.executor + flat fields) or one
// element of config.scenarios[]. Every supported k6 executor maps to a small
// set of well-known fields so the JSON config stays readable.
function buildRampUntilStages(s) {
  const startRate = s.startRate ?? 50;
  const maxRate = s.maxRate ?? 10000;
  const stepRate = s.stepRate ?? Math.max(1, Math.floor((maxRate - startRate) / 20));
  const stepDuration = s.stepDuration || "30s";
  const stages = [];
  let r = startRate + stepRate;
  while (r <= maxRate) {
    stages.push({ duration: stepDuration, target: r });
    r += stepRate;
  }
  if (stages.length === 0)
    stages.push({ duration: stepDuration, target: maxRate });
  return { startRate, stages };
}

// Translate "<metric>{<stat>} <op> <value>" -> k6 threshold + abortOnFail.
// Inverts the operator because k6 thresholds PASS when the expression is
// true; stopCondition is phrased as "stop when this becomes true".
//   "http_req_duration{p99} > 1000"
//      ->  http_req_duration: [{ threshold: "p(99)<1000", abortOnFail: true }]
export function buildAbortThreshold(stopCondition) {
  const m = /^(\w+)\{(\w+)\}\s*(>=?|<=?)\s*(\d+(?:\.\d+)?)\s*$/.exec(
    String(stopCondition || "").trim(),
  );
  if (!m) return null;
  const [, metric, stat, op, val] = m;
  const inv = { ">": "<", "<": ">", ">=": "<=", "<=": ">=" }[op];
  const k6Stat = /^p\d+$/.test(stat) ? `p(${stat.slice(1)})` : stat;
  return {
    metric,
    threshold: { threshold: `${k6Stat}${inv}${val}`, abortOnFail: true },
  };
}

function buildScenarioFromSpec(s, fallbackStages) {
  const exec = s.exec || "runEndpoint";
  const gracefulStop = s.gracefulStop || "1s";
  const base = { exec, gracefulStop };
  if (s.startTime) base.startTime = s.startTime;
  switch (s.executor) {
    case "constant-arrival-rate":
      return {
        ...base,
        executor: "constant-arrival-rate",
        rate: s.rate || 20,
        timeUnit: s.timeUnit || "1s",
        duration: s.loadDuration || s.duration || "3m",
        preAllocatedVUs: s.preAllocatedVUs || 50,
        maxVUs: s.maxVUs || 200,
      };
    case "ramping-arrival-rate":
      return {
        ...base,
        executor: "ramping-arrival-rate",
        startRate: s.startRate ?? 0,
        timeUnit: s.timeUnit || "1s",
        stages: normalizeRateStages(s.stages || fallbackStages || []),
        preAllocatedVUs: s.preAllocatedVUs || 50,
        maxVUs: s.maxVUs || 200,
      };
    case "ramp-until": {
      // Saturation discovery: step the arrival rate up until a threshold
      // trips (the abort-on-fail threshold added below), then stop. The
      // last completed stage is roughly the service's saturation point.
      const { startRate, stages } = buildRampUntilStages(s);
      return {
        ...base,
        executor: "ramping-arrival-rate",
        startRate,
        timeUnit: s.timeUnit || "1s",
        stages,
        preAllocatedVUs: s.preAllocatedVUs || 50,
        maxVUs: s.maxVUs || 2000,
      };
    }
    case "shared-iterations":
      return {
        ...base,
        executor: "shared-iterations",
        iterations: s.iterations || 100,
        vus: s.vus || 10,
        maxDuration: s.maxDuration || "10m",
      };
    case "per-vu-iterations":
      return {
        ...base,
        executor: "per-vu-iterations",
        iterations: s.iterations || 10,
        vus: s.vus || 10,
        maxDuration: s.maxDuration || "10m",
      };
    case "constant-vus":
      return {
        ...base,
        executor: "constant-vus",
        vus: s.vus || 10,
        duration: s.duration || s.loadDuration || "3m",
      };
    case "ramping-vus":
    default:
      return {
        ...base,
        executor: "ramping-vus",
        startVUs: s.startVUs ?? 0,
        stages: normalizeVuStages(s.stages || fallbackStages || []),
        gracefulRampDown: s.gracefulRampDown || "30s",
      };
  }
}

// VU stages accept `vus` or `target` (k6 uses `target`).
function normalizeVuStages(arr) {
  return (arr || []).map((s) => ({
    duration: s.duration,
    target: s.vus ?? s.target ?? 0,
  }));
}

// Rate stages accept `rate` or `target`.
function normalizeRateStages(arr) {
  return (arr || []).map((s) => ({
    duration: s.duration,
    target: s.rate ?? s.target ?? 0,
  }));
}

// Effective wall-clock length of a scenario, used to size the memory sampler
// and surface a "total" estimate to the UI.
function scenarioDurationS(s) {
  const start = parseDurationS(s.startTime || "0s");
  switch (s.executor) {
    case "constant-arrival-rate":
      return start + parseDurationS(s.loadDuration || s.duration || "3m");
    case "ramping-arrival-rate":
    case "ramping-vus":
      return start + (s.stages || []).reduce((a, x) => a + parseDurationS(x.duration), 0);
    case "ramp-until": {
      const { stages } = buildRampUntilStages(s);
      return start + stages.reduce((a, x) => a + parseDurationS(x.duration), 0);
    }
    case "shared-iterations":
    case "per-vu-iterations":
      return start + parseDurationS(s.maxDuration || "10m");
    case "constant-vus":
      return start + parseDurationS(s.duration || s.loadDuration || "3m");
    default:
      return start + (s.stages || []).reduce((a, x) => a + parseDurationS(x.duration), 0);
  }
}

// Legacy top-level form: { executor, rate/stages/..., ... }. Wrap into a
// single-scenario spec so the new builder handles it uniformly.
function legacySpecFromTopLevel() {
  return {
    executor: config.executor || "ramping-vus",
    rate: config.rate,
    timeUnit: config.timeUnit,
    loadDuration: config.loadDuration,
    duration: config.duration,
    startRate: config.startRate,
    startVUs: config.startVUs,
    stages: config.stages,
    preAllocatedVUs: config.preAllocatedVUs,
    maxVUs: config.maxVUs,
    iterations: config.iterations,
    vus: config.vus,
    maxDuration: config.maxDuration,
    gracefulRampDown: config.gracefulRampDown,
  };
}

// New form: config.scenarios = [{ name, executor, ... }, ...]. Each runs in
// parallel (or staggered, via startTime). Names default to scenario0/1/...
const scenarioSpecs = Array.isArray(config.scenarios) && config.scenarios.length > 0
  ? config.scenarios.map((s, i) => ({ name: s.name || `scenario${i}`, spec: s }))
  : [{ name: "load_test", spec: legacySpecFromTopLevel() }];

function estimateLoadDurationS() {
  return Math.max(0, ...scenarioSpecs.map(({ spec }) => scenarioDurationS(spec)));
}

const samplerDuration = `${Math.max(1, Math.ceil(estimateLoadDurationS()))}s`;

const scenarios = {};
for (const { name, spec } of scenarioSpecs) {
  scenarios[name] = buildScenarioFromSpec(spec, stages);
}
if (memorySamplingEnabled) {
  scenarios.memory_sampler = {
    executor: "constant-vus",
    vus: 1,
    duration: samplerDuration,
    gracefulStop: "1s",
    exec: "sampleMemory",
  };
}

// ramp-until injects an abort-on-fail threshold derived from stopCondition,
// merged with any user-defined thresholds so both fire.
const mergedThresholds = { ...(config.thresholds || {}) };
for (const { spec } of scenarioSpecs) {
  if (spec.executor !== "ramp-until" || !spec.stopCondition) continue;
  const built = buildAbortThreshold(spec.stopCondition);
  if (!built) {
    console.log(`[ramp-until] could not parse stopCondition: ${spec.stopCondition}`);
    continue;
  }
  mergedThresholds[built.metric] = [
    ...(mergedThresholds[built.metric] || []),
    built.threshold,
  ];
}

export const options = {
  scenarios,
  thresholds: mergedThresholds,
  summaryTrendStats: ["avg", "min", "med", "max", "p(90)", "p(95)", "p(99)"],
  // Allow generous teardown: cooldownSeconds + buffer.
  teardownTimeout: `${Math.max(60, cooldownSeconds + 30)}s`,
};

// State for memory and CPU tracking
let baselineStats = null;
let peakMemory = 0;
let peakRss = 0;
let peakCpu = 0;

function getRandomToken() {
  if (!config.tokens || config.tokens.length === 0) return null;
  return config.tokens[Math.floor(Math.random() * config.tokens.length)];
}

function selectEndpoint() {
  const active = config.endpoints.filter(
    (ep) => !ep.maxIterations || iterationCounts[ep.name] < ep.maxIterations,
  );
  if (active.length === 0) return null;
  const total = active.reduce((sum, ep) => sum + (ep.weight || 1), 0);
  const rand = Math.random() * total;
  let cumulative = 0;
  for (const ep of active) {
    cumulative += ep.weight || 1;
    if (rand < cumulative) {
      iterationCounts[ep.name]++;
      return ep;
    }
  }
  const fallback = active[active.length - 1];
  iterationCounts[fallback.name]++;
  return fallback;
}

function buildUrl(endpoint, vu) {
  let url = `${TARGET}${expandTemplate(endpoint.path, vu)}`;
  if (endpoint.params && Object.keys(endpoint.params).length > 0) {
    const parts = [];
    for (const [key, value] of Object.entries(endpoint.params)) {
      const expanded = expandTemplate(String(value), vu);
      parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(expanded)}`);
    }
    url += `?${parts.join("&")}`;
  }
  return url;
}

function buildHeaders(endpoint, vu) {
  const headers = {};
  if (endpoint.headers) {
    for (const [key, value] of Object.entries(endpoint.headers)) {
      headers[key] = expandTemplate(String(value), vu);
    }
  }
  return headers;
}

function runChecks(endpoint, response) {
  const checks = endpoint.checks || {};
  const out = {};
  if (checks.status !== undefined) {
    out[`${endpoint.name} status is ${checks.status}`] = response.status === checks.status;
  }
  if (checks.statusNot5xx) {
    out[`${endpoint.name} status not 5xx`] = response.status < 500;
  }
  if (checks.status2xx) {
    out[`${endpoint.name} status is 2xx`] = response.status >= 200 && response.status < 300;
  }
  if (checks.bodyContains) {
    out[`${endpoint.name} body contains ${checks.bodyContains}`] =
      response.body && response.body.includes(checks.bodyContains);
  }
  // Header equality checks: { "x-cache-status": "HIT", "x-version": "v2" }
  if (checks.headers && typeof checks.headers === "object") {
    const hs = response.headers || {};
    for (const [k, expected] of Object.entries(checks.headers)) {
      const actual = hs[k] ?? hs[k.toLowerCase()] ?? hs[k.toUpperCase()];
      out[`${endpoint.name} header ${k}=${expected}`] = String(actual) === String(expected);
    }
  }
  // JSONPath checks: each value can be a literal (equality) or an object
  // { exists, equals, contains, matches, ">=", "<=", ">", "<" }
  if (checks.jsonPath && typeof checks.jsonPath === "object") {
    let parsed = null;
    try {
      parsed = JSON.parse(response.body);
    } catch {}
    for (const [path, expected] of Object.entries(checks.jsonPath)) {
      const value = readJsonPath(parsed, path);
      out[`${endpoint.name} ${path}`] = matchExpectation(value, expected);
    }
  }
  if (Object.keys(out).length === 0) {
    out[`${endpoint.name} responded`] = response.status > 0;
  }
  return check(response, out);
}

// Minimal JSONPath reader: supports $, .field, [N]. No wildcards or filters.
// Returns undefined for any segment that doesn't resolve.
function readJsonPath(root, path) {
  if (typeof path !== "string" || !path.startsWith("$")) return undefined;
  let cur = root;
  let i = 1;
  while (i < path.length && cur !== undefined && cur !== null) {
    const ch = path[i];
    if (ch === ".") {
      i++;
      let end = i;
      while (end < path.length && /[a-zA-Z0-9_]/.test(path[end])) end++;
      cur = cur[path.slice(i, end)];
      i = end;
    } else if (ch === "[") {
      const close = path.indexOf("]", i);
      if (close === -1) return undefined;
      const idx = parseInt(path.slice(i + 1, close), 10);
      cur = Array.isArray(cur) ? cur[idx] : undefined;
      i = close + 1;
    } else {
      i++;
    }
  }
  return cur;
}

function matchExpectation(value, expected) {
  if (expected === null) return value === null;
  if (typeof expected !== "object") {
    return value === expected || String(value) === String(expected);
  }
  if ("exists" in expected) {
    return expected.exists ? value !== undefined : value === undefined;
  }
  if ("equals" in expected) return value === expected.equals || String(value) === String(expected.equals);
  if ("contains" in expected) return typeof value === "string" && value.includes(expected.contains);
  if ("matches" in expected)
    return typeof value === "string" && new RegExp(expected.matches).test(value);
  if (">=" in expected) return Number(value) >= Number(expected[">="]);
  if ("<=" in expected) return Number(value) <= Number(expected["<="]);
  if (">" in expected) return Number(value) > Number(expected[">"]);
  if ("<" in expected) return Number(value) < Number(expected["<"]);
  return false;
}

export function setup() {
  const healthPath = config.healthPath;
  if (!healthPath) {
    console.log(`Target: ${TARGET} | health check skipped (no healthPath in config)`);
    return;
  }
  const maxRetries = config.healthMaxRetries ?? 15;
  const interval = config.healthIntervalSeconds ?? 2;
  for (let i = 0; i < maxRetries; i++) {
    const res = http.get(`${TARGET}${healthPath}`);
    if (res.status >= 200 && res.status < 300) {
      console.log(`Service healthy after ${i * interval}s`);
      return;
    }
    console.log(`Waiting for service... ${i + 1}/${maxRetries} (status=${res.status})`);
    sleep(interval);
  }
  console.log("WARNING: service did not become healthy; running anyway");
}

export function runEndpoint() {
  const endpoint = selectEndpoint();
  if (!endpoint) {
    sleep(0.1);
    return;
  }
  const vu = exec.vu.idInTest;
  const url = buildUrl(endpoint, vu);
  const headers = buildHeaders(endpoint, vu);
  const method = (endpoint.method || "GET").toUpperCase();
  // Expand any ${...} refs inside the body too (per-request, deep).
  const bodyValue = endpoint.body !== undefined ? expandValue(endpoint.body, vu) : undefined;
  const bodyText = bodyValue !== undefined ? JSON.stringify(bodyValue) : null;

  let response;
  switch (method) {
    case "POST":
      if (bodyText) headers["Content-Type"] = "application/json";
      response = http.post(url, bodyText, { headers });
      break;
    case "PUT":
      if (bodyText) headers["Content-Type"] = "application/json";
      response = http.put(url, bodyText, { headers });
      break;
    case "DELETE":
      response = http.del(url, null, { headers });
      break;
    case "PATCH":
      if (bodyText) headers["Content-Type"] = "application/json";
      response = http.patch(url, bodyText, { headers });
      break;
    default:
      response = http.get(url, { headers });
  }

  endpointLatency[endpoint.name].add(response.timings.duration);
  if (!runChecks(endpoint, response)) errors.add(1);

  if (endpoint.waitMs) {
    const wait = endpoint.waitMs.min + Math.random() * (endpoint.waitMs.max - endpoint.waitMs.min);
    sleep(wait / 1000);
  } else {
    sleep(0.02);
  }
}

// Periodically poll a Node.js procstats-style endpoint and record runtime
// metrics. Compatible with the original ecs-content shape; missing fields
// are simply skipped.
export function sampleMemory() {
  const response = http.get(`${TARGET}${memorySamplerEndpoint}`);

  if (response.status === 200) {
    try {
      const stats = JSON.parse(response.body);

      const heapBytes = stats.heapInuse || stats.usedHeapSize || 0;
      const heapMB = heapBytes / 1048576;
      const rssMB = (stats.rss || 0) / 1048576;
      const handles = stats.goroutines || stats.activeHandles || 0;
      const requests = stats.activeRequests || 0;
      const procCpu = stats.cpuPercent || 0;
      const sysCpu = stats.systemCpuPercent || 0;
      const heapLimit = (stats.heapSizeLimit || 0) / 1048576;
      const heapTotal = (stats.totalHeapSize || 0) / 1048576;
      const external = stats.external || 0;

      const cppHeap = stats.cppHeap || {};
      const cppAllocMB = (cppHeap.allocated_size || 0) / 1048576;
      const cppUsedMB = (cppHeap.used_size || 0) / 1048576;

      heapInuse.add(heapBytes);
      activeHandles.add(handles);
      activeRequests.add(requests);
      rssBytes.add(stats.rss || 0);
      externalBytes.add(external);
      heapSizeLimit.add(heapLimit);
      heapTotalSize.add(heapTotal);
      cppHeapAllocated.add(cppAllocMB);
      cppHeapUsed.add(cppUsedMB);

      cpuPercent.add(procCpu);
      systemCpuPercent.add(sysCpu);
      avgCpuTrend.add(procCpu);

      const eld = stats.eventLoopDelay;
      if (eld) {
        eventLoopMean.add(eld.mean);
        eventLoopP90.add(eld.p90);
        eventLoopP99.add(eld.p99);
        eventLoopMax.add(eld.max);
      }

      const gc = stats.gc;
      if (gc) {
        gcCount.add(gc.count);
        gcTotalMs.add(gc.totalMs);
        gcMaxMs.add(gc.maxMs);
        gcAvgMs.add(gc.avgMs);
      }

      if (stats.uvThreadpoolSize) uvThreadpoolSize.add(stats.uvThreadpoolSize);

      if (heapMB > peakMemory) {
        peakMemory = heapMB;
        peakHeapGauge.add(heapMB);
      }
      if (rssMB > peakRss) {
        peakRss = rssMB;
        peakRssGauge.add(rssMB);
      }
      if (procCpu > peakCpu) {
        peakCpu = procCpu;
        peakCpuGauge.add(procCpu);
      }

      if (baselineStats === null) {
        baselineStats = { heapMB, rssMB, handles, requests, external, cpuPercent: procCpu };
        baselineHeap.add(heapMB);
        baselineHandles.add(handles);
        baselineRss.add(rssMB);
        baselineCpu.add(procCpu);

        console.log(`=== Load Test Started === Target: ${TARGET} | Config: ${CONFIG_FILE}`);
        console.log(
          `Endpoints: ${config.endpoints.map((e) => e.name).join(", ")} | Tokens: ${config.tokens?.length || 0}`,
        );
        const uvStr = stats.uvThreadpoolSize ? ` | UV_THREADPOOL=${stats.uvThreadpoolSize}` : "";
        console.log(
          `Baseline: Heap=${heapMB.toFixed(2).padStart(7)} MB | RSS=${rssMB.toFixed(2).padStart(7)} MB | Handles=${handles.toString().padStart(4)} | ProcCPU=${procCpu.toFixed(1).padStart(5)}%${uvStr}`,
        );
      }

      const cppStr = cppAllocMB > 0 ? ` | CppHeap=${cppUsedMB.toFixed(1)}/${cppAllocMB.toFixed(1)}MB` : "";
      const eldStr = eld ? ` | EL_p90=${eld.p90.toFixed(1)}ms EL_max=${eld.max.toFixed(1)}ms` : "";
      const gcStr = gc ? ` | GC=${gc.count} max=${gc.maxMs.toFixed(1)}ms` : "";
      console.log(
        `[Sample] Heap=${heapMB.toFixed(2).padStart(7)} MB | RSS=${rssMB.toFixed(2).padStart(7)} MB | Handles=${handles.toString().padStart(4)} | ProcCPU=${procCpu.toFixed(1).padStart(5)}%${cppStr}${eldStr}${gcStr}`,
      );
    } catch (e) {
      console.log(`[Sample] Failed to parse response: ${e.message}`);
    }
  } else {
    console.log(`[Sample] Failed to fetch procstats: ${response.status}`);
  }

  sleep(memorySamplerInterval);
}

// Optional cooldown sample after the load ends.
export function teardown() {
  if (!memorySamplingEnabled || cooldownSeconds <= 0) return;
  console.log(`\n=== Load Test Complete === Cooldown ${cooldownSeconds}s ...`);
  sleep(cooldownSeconds);

  const response = http.get(`${TARGET}${memorySamplerEndpoint}`);
  if (response.status !== 200) {
    console.log(`[Cooldown] Failed to fetch procstats: ${response.status}`);
    return;
  }
  try {
    const stats = JSON.parse(response.body);
    const heapMB = (stats.heapInuse || stats.usedHeapSize || 0) / 1048576;
    const rssMB = (stats.rss || 0) / 1048576;
    const handles = stats.goroutines || stats.activeHandles || 0;
    const procCpu = stats.cpuPercent || 0;
    cooldownHeap.add(heapMB);
    cooldownHandles.add(handles);
    cooldownRss.add(rssMB);
    cooldownCpu.add(procCpu);
    console.log(
      `\n=== Cooldown Complete === Heap=${heapMB.toFixed(1)}MB | RSS=${rssMB.toFixed(1)}MB | CPU=${procCpu.toFixed(0)}%`,
    );
  } catch (e) {
    console.log(`[Cooldown] Failed to parse response: ${e.message}`);
  }
}

function formatDelta(value, unit = "") {
  const sign = value >= 0 ? "+" : "";
  return `${sign}${value.toFixed(2)}${unit}`;
}

// Build the rich text report. Mirrors the ecs-content original — sections are
// only rendered when their underlying metrics are present in `data`.
function buildReport(data) {
  const W = 62;
  const line = "=".repeat(W);
  const dash = "-".repeat(W);
  let out = "\n";
  out += line + "\n";
  out += "NODE.JS PERFORMANCE ANALYSIS REPORT".padStart((W + 35) / 2).padEnd(W) + "\n";
  out += line + "\n";

  const metrics = data.metrics;
  const hasMemoryData = metrics.baseline_heap_mb && metrics.active_handles;

  const row = (label, value) => {
    const gap = W - label.length - value.length;
    return label + ".".repeat(Math.max(gap, 1)) + value + "\n";
  };

  if (hasMemoryData) {
    const baselineHeapMB = metrics.baseline_heap_mb?.values?.value || 0;
    const baselineHandlesVal = metrics.baseline_handles?.values?.value || 0;
    const baselineRssMB = metrics.baseline_rss_mb?.values?.value || 0;
    const baselineCpuVal = metrics.baseline_cpu_percent?.values?.value || 0;

    const cooldownHeapMB = metrics.cooldown_heap_mb?.values?.value ?? null;
    const cooldownHandlesVal = metrics.cooldown_handles?.values?.value ?? null;
    const cooldownRssMB = metrics.cooldown_rss_mb?.values?.value ?? null;
    const cooldownCpuVal = metrics.cooldown_cpu?.values?.value ?? null;
    const hasCooldown = cooldownHeapMB !== null;

    const finalHeapBytes = metrics.heap_inuse_bytes?.values?.value || 0;
    const finalHeapMB = finalHeapBytes / 1048576;
    const finalHandles = metrics.active_handles?.values?.value || 0;
    const finalRssBytes = metrics.rss_bytes?.values?.value || 0;
    const finalRssMB = finalRssBytes / 1048576;
    const finalCpu = metrics.cpu_percent?.values?.value || 0;

    const peakHeapMB = metrics.peak_heap_mb?.values?.value || finalHeapMB;
    const peakRssMB = metrics.peak_rss_mb?.values?.value || finalRssMB;
    const peakCpuVal = metrics.peak_cpu_percent?.values?.value || 0;
    const avgCpuVal = metrics.avg_cpu_percent?.values?.avg || 0;

    const heapDelta = finalHeapMB - baselineHeapMB;
    const handleDelta = finalHandles - baselineHandlesVal;
    const rssDelta = finalRssMB - baselineRssMB;

    out += "\n[V8 HEAP MEMORY - Baseline]\n" + dash + "\n";
    out += row("  Heap Used", `${baselineHeapMB.toFixed(2)} MB`);
    out += row("  RSS (Physical Memory)", `${baselineRssMB.toFixed(2)} MB`);
    out += row("  Active Handles (libuv)", `${baselineHandlesVal}`);

    out += "\n[V8 HEAP MEMORY - Final (End of Load)]\n" + dash + "\n";
    out += row("  Heap Used", `${finalHeapMB.toFixed(2)} MB`);
    out += row("  RSS (Physical Memory)", `${finalRssMB.toFixed(2)} MB`);
    out += row("  Active Handles (libuv)", `${finalHandles}`);
    out += row("  Peak Heap", `${peakHeapMB.toFixed(2)} MB`);
    out += row("  Peak RSS", `${peakRssMB.toFixed(2)} MB`);

    if (hasCooldown) {
      out += "\n[V8 HEAP MEMORY - After Cooldown]\n" + dash + "\n";
      out += row("  Heap Used", `${cooldownHeapMB.toFixed(2)} MB`);
      out += row("  RSS (Physical Memory)", `${cooldownRssMB.toFixed(2)} MB`);
      out += row("  Active Handles (libuv)", `${cooldownHandlesVal}`);
      out += row("  Heap vs Baseline", formatDelta(cooldownHeapMB - baselineHeapMB, " MB"));
    }

    out += "\n[MEMORY - Delta Analysis]\n" + dash + "\n";
    out += row("  Heap Change (Final vs Baseline)", formatDelta(heapDelta, " MB"));
    out += row("  RSS Change (Final vs Baseline)", formatDelta(rssDelta, " MB"));
    if (hasCooldown) {
      out += row("  Heap Change (Cooldown vs Baseline)", formatDelta(cooldownHeapMB - baselineHeapMB, " MB"));
      out += row("  RSS Change (Cooldown vs Baseline)", formatDelta(cooldownRssMB - baselineRssMB, " MB"));
    }
    out += row("  Handle Change", formatDelta(handleDelta, ""));

    out += "\n[CPU UTILIZATION]\n" + dash + "\n";
    out += row("  Baseline CPU", `${baselineCpuVal.toFixed(1)}%`);
    out += row("  Final CPU", `${finalCpu.toFixed(1)}%`);
    if (hasCooldown) out += row("  Cooldown CPU", `${cooldownCpuVal.toFixed(1)}%`);
    out += row("  Peak CPU", `${peakCpuVal.toFixed(1)}%`);
    out += row("  Average CPU", `${avgCpuVal.toFixed(1)}%`);

    const eldMeanAvg = metrics.event_loop_delay_mean_ms?.values?.avg;
    if (eldMeanAvg !== undefined) {
      const eldP90Val = metrics.event_loop_delay_p90_ms?.values?.value || 0;
      const eldP99Val = metrics.event_loop_delay_p99_ms?.values?.value || 0;
      const eldMaxVal = metrics.event_loop_delay_max_ms?.values?.value || 0;
      out += "\n[EVENT LOOP DELAY]\n" + dash + "\n";
      out += row("  Mean", `${eldMeanAvg.toFixed(2)} ms`);
      out += row("  p90", `${eldP90Val.toFixed(2)} ms`);
      out += row("  p99", `${eldP99Val.toFixed(2)} ms`);
      out += row("  Max", `${eldMaxVal.toFixed(2)} ms`);
    }

    const gcCountVal = metrics.gc_count?.values?.value;
    if (gcCountVal !== undefined) {
      const gcTotalVal = metrics.gc_total_ms?.values?.value || 0;
      const gcMaxVal = metrics.gc_max_ms?.values?.value || 0;
      const gcAvgVal = metrics.gc_avg_ms?.values?.value || 0;
      out += "\n[GARBAGE COLLECTION]\n" + dash + "\n";
      out += row("  Total GC pauses", `${gcCountVal}`);
      out += row("  Total GC time", `${gcTotalVal.toFixed(2)} ms`);
      out += row("  Avg GC pause", `${gcAvgVal.toFixed(2)} ms`);
      out += row("  Max GC pause", `${gcMaxVal.toFixed(2)} ms`);
    }

    const cppAllocVal = metrics.cpp_heap_allocated_mb?.values?.value;
    if (cppAllocVal !== undefined) {
      const cppUsedVal = metrics.cpp_heap_used_mb?.values?.value || 0;
      out += "\n[C++ HEAP (ArrayBuffers, Wasm, Native)]\n" + dash + "\n";
      out += row("  Allocated", `${cppAllocVal.toFixed(2)} MB`);
      out += row("  Used", `${cppUsedVal.toFixed(2)} MB`);
    }

    const uvSize = metrics.uv_threadpool_size?.values?.value;
    if (uvSize !== undefined) {
      out += "\n[LIBUV THREADPOOL]\n" + dash + "\n";
      out += row("  UV_THREADPOOL_SIZE", `${uvSize}`);
    }

    out += "\n[VERDICT]\n" + dash + "\n";
    const verdictHeapDelta = hasCooldown ? cooldownHeapMB - baselineHeapMB : heapDelta;
    const verdictRssDelta = hasCooldown ? cooldownRssMB - baselineRssMB : rssDelta;
    const verdictLabel = hasCooldown ? "after cooldown" : "at end of load";

    if (verdictHeapDelta > 10) {
      out += `  [!] V8 HEAP: Increased by ${verdictHeapDelta.toFixed(2)} MB ${verdictLabel}\n`;
      out += "      Possible memory leak. Take heap snapshot for analysis.\n";
    } else if (verdictHeapDelta > 5) {
      out += `  [~] V8 HEAP: Increased by ${verdictHeapDelta.toFixed(2)} MB ${verdictLabel}\n`;
      out += "      Minor increase - monitor over extended tests.\n";
    } else if (verdictHeapDelta < -1) {
      out += `  [OK] V8 HEAP: Returned below baseline (${formatDelta(verdictHeapDelta, " MB")}) ${verdictLabel}\n`;
    } else {
      out += `  [OK] V8 HEAP: Stable (within +/-5 MB of baseline) ${verdictLabel}\n`;
    }

    if (verdictRssDelta > 50) {
      out += `  [!] RSS: Physical memory increased by ${verdictRssDelta.toFixed(2)} MB ${verdictLabel}\n`;
      out += "      Check for external memory leaks (buffers, native addons).\n";
    } else if (verdictRssDelta > 20) {
      out += `  [~] RSS: Physical memory increased by ${verdictRssDelta.toFixed(2)} MB ${verdictLabel}\n`;
    } else {
      out += `  [OK] RSS: Physical memory stable ${verdictLabel}\n`;
    }

    const verdictHandleDelta = hasCooldown ? cooldownHandlesVal - baselineHandlesVal : handleDelta;
    if (verdictHandleDelta > 10) {
      out += `  [!] HANDLES: ${verdictHandleDelta} libuv handles not cleaned up ${verdictLabel}\n`;
      out += "      Check for unclosed connections, timers, or event listeners.\n";
    } else if (verdictHandleDelta > 0) {
      out += `  [i] HANDLES: ${verdictHandleDelta} additional handles (may be normal)\n`;
    } else {
      out += "  [OK] HANDLES: All handles cleaned up properly\n";
    }

    if (peakCpuVal > 80) {
      out += `  [!] CPU: Peak usage ${peakCpuVal.toFixed(1)}% - High CPU pressure\n`;
      out += "      Profile with Chrome DevTools or clinic.js flame.\n";
    } else if (peakCpuVal > 50) {
      out += `  [~] CPU: Peak usage ${peakCpuVal.toFixed(1)}% - Moderate load\n`;
    } else if (avgCpuVal > 0) {
      out += `  [OK] CPU: Average ${avgCpuVal.toFixed(1)}%, Peak ${peakCpuVal.toFixed(1)}%\n`;
    }

    if (gcCountVal !== undefined) {
      const gcMaxVal = metrics.gc_max_ms?.values?.value || 0;
      if (gcMaxVal > 100) {
        out += `  [!] GC: Max pause ${gcMaxVal.toFixed(1)}ms - Long GC pauses detected\n`;
        out += "      Consider reducing heap allocation rate or increasing heap size.\n";
      } else if (gcMaxVal > 50) {
        out += `  [~] GC: Max pause ${gcMaxVal.toFixed(1)}ms - Moderate GC pauses\n`;
      } else {
        out += `  [OK] GC: Max pause ${gcMaxVal.toFixed(1)}ms - No long pauses\n`;
      }
    }
  } else {
    out += "\n  Memory sampling was not enabled or returned no data.\n";
    out += "  Set memorySampling.enabled=true (and a procstats endpoint) in the config.\n";
  }

  out += "\n" + line + "\n";
  return out;
}

export function handleSummary(data) {
  const summaryPath = __ENV.SUMMARY_PATH;
  const summaryTxtPath = __ENV.SUMMARY_TXT_PATH;
  const report = buildReport(data);
  const text = textSummary(data, { indent: " ", enableColors: false });
  const out = { stdout: "" };
  if (summaryPath) out[summaryPath] = JSON.stringify(data, null, 2);
  if (summaryTxtPath) out[summaryTxtPath] = report + "\n" + text;
  return out;
}

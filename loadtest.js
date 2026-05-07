import http from "k6/http";
import { check, sleep } from "k6";
import { Counter, Trend } from "k6/metrics";

// CONFIG points to an absolute path to a JSON config file.
// TARGET overrides config.target.
// SUMMARY_PATH (optional) is where handleSummary writes summary.json.
const CONFIG_FILE = __ENV.CONFIG;
if (!CONFIG_FILE) throw new Error("CONFIG env var is required");
const config = JSON.parse(open(CONFIG_FILE));

// Resolve bodyFile references — paths relative to the config file's directory
// when uploaded as a bundle, or absolute paths.
config.endpoints.forEach((ep) => {
  if (ep.bodyFile) {
    ep.body = JSON.parse(open(ep.bodyFile));
  }
});

const TARGET = __ENV.TARGET || config.target || "http://localhost:8080";

const errors = new Counter("errors");
const endpointLatency = {};
config.endpoints.forEach((ep) => {
  endpointLatency[ep.name] = new Trend(`ep_${ep.name}_latency`);
});

const stages = config.stages || [
  { duration: "30s", target: 10 },
  { duration: "1m", target: 25 },
  { duration: "30s", target: 0 },
];
const k6Stages = stages.map((s) => ({
  duration: s.duration,
  target: s.vus || s.target || 0,
}));

const iterationCounts = {};
config.endpoints.forEach((ep) => {
  iterationCounts[ep.name] = 0;
});

function buildLoadScenario() {
  const executorType = config.executor || "ramping-vus";
  if (executorType === "constant-arrival-rate") {
    return {
      executor: "constant-arrival-rate",
      rate: config.rate || 20,
      timeUnit: config.timeUnit || "1s",
      duration: config.loadDuration || "3m",
      preAllocatedVUs: config.preAllocatedVUs || 50,
      maxVUs: config.maxVUs || 200,
      exec: "runEndpoint",
    };
  }
  return {
    executor: "ramping-vus",
    stages: k6Stages,
    gracefulRampDown: "30s",
    exec: "runEndpoint",
  };
}

export const options = {
  scenarios: {
    load_test: buildLoadScenario(),
  },
  thresholds: config.thresholds || {},
  summaryTrendStats: ["avg", "min", "med", "max", "p(90)", "p(95)", "p(99)"],
};

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

function buildUrl(endpoint) {
  let url = `${TARGET}${endpoint.path}`;
  if (endpoint.params && Object.keys(endpoint.params).length > 0) {
    const parts = [];
    for (const [key, value] of Object.entries(endpoint.params)) {
      parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(value)}`);
    }
    url += `?${parts.join("&")}`;
  }
  return url;
}

function buildHeaders(endpoint) {
  const headers = {};
  if (endpoint.headers) {
    const token = getRandomToken();
    for (const [key, value] of Object.entries(endpoint.headers)) {
      headers[key] = String(value).replace("${token}", token || "");
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
  // Default check: at least require a non-zero status.
  if (Object.keys(out).length === 0) {
    out[`${endpoint.name} responded`] = response.status > 0;
  }
  return check(response, out);
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
  const url = buildUrl(endpoint);
  const headers = buildHeaders(endpoint);
  const method = (endpoint.method || "GET").toUpperCase();

  let response;
  switch (method) {
    case "POST":
      if (endpoint.body) headers["Content-Type"] = "application/json";
      response = http.post(url, endpoint.body ? JSON.stringify(endpoint.body) : null, { headers });
      break;
    case "PUT":
      if (endpoint.body) headers["Content-Type"] = "application/json";
      response = http.put(url, endpoint.body ? JSON.stringify(endpoint.body) : null, { headers });
      break;
    case "DELETE":
      response = http.del(url, null, { headers });
      break;
    case "PATCH":
      if (endpoint.body) headers["Content-Type"] = "application/json";
      response = http.patch(url, endpoint.body ? JSON.stringify(endpoint.body) : null, { headers });
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

export function handleSummary(data) {
  const summaryPath = __ENV.SUMMARY_PATH;
  const out = { stdout: "" };
  if (summaryPath) out[summaryPath] = JSON.stringify(data, null, 2);
  return out;
}

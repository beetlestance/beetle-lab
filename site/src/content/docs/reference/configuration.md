---
title: Suite configuration
description: Every field of the JSON configuration a suite revision holds, with its allowed values and bounds.
sidebar:
  order: 3
---

A revision's configuration is one JSON object of up to 1 MiB. Unknown fields are
refused everywhere. Saving checks the structure; the engine checks the rest, such
as cross-references, when a run is admitted. Your installation's schemas are in
the app: **API reference** → **Download k6 configuration schemas**
(`k6-config.json`). The [source schemas](https://github.com/beetlestance/beetle-lab/tree/5b8e016c372131449d3a5fcf92e3574b1847534c/contracts/engines/k6/v1)
are on GitHub, pinned to revision `5b8e016c`.

## Top level

| Field | Required | Value |
| --- | --- | --- |
| `version` | yes | Always `1` |
| `target` | yes | `http` or `https` base URL of up to 4,096 characters; no credentials, query, fragment or spaces |
| `loadPlan` | yes | Scenarios and pass or fail rules |
| `requests` | yes | 1 to 64 requests |
| `datasets` | yes | 0 to 64 datasets; see [Datasets and templates](/guides/datasets/) |
| `secrets` | yes | 0 to 64 secret references |
| `selections` | yes | Exactly one per scenario |
| `readiness` | no | A check that the target is up before load starts |
| `targetSampling` | no | Readings polled from your service during the run |

Request paths are appended to the target, including any path prefix it has.

**Identifiers** (`id`, scenario `name`, dataset columns, secret `name`) start with
a letter or `_`, then letters, digits, `_` or `-`, up to 64 characters. IDs must be
unique within their list.

**Durations** are a whole number and a unit: `ms`, `s`, `m` or `h`, such as
`500ms` or `2m`. Workload and `startTime` can be up to 24 h, `gracefulStop` and
`gracefulRampDown` up to 1 h, and one scenario's total up to 48 h.

## Load plan

`loadPlan` holds `version` (`1`), `scenarios` (1 to 64) and `slos` (0 to 128
rules). Every scenario has `id`, `name` (unique), `executor`, `startTime` and
`gracefulStop`, plus the fields of its executor:

| Executor | Fields |
| --- | --- |
| `constant-vus` | `vus`, `duration` |
| `ramping-vus` | `startVUs`, `stages` (`duration`, `target` VUs), `gracefulRampDown` |
| `constant-arrival-rate` | `rate`, `timeUnit`, `duration`, `preAllocatedVUs`, `maxVUs` |
| `ramping-arrival-rate` | `startRate`, `timeUnit`, `stages` (`duration`, `target` rate), `preAllocatedVUs`, `maxVUs` |
| `shared-iterations` | `iterations`, `vus`, `maxDuration` |
| `per-vu-iterations` | `iterations`, `vus`, `maxDuration` |
| `ramp-until` | `startRate`, `maxRate`, `stepRate`, `stepDuration`, `timeUnit`, `preAllocatedVUs`, `maxVUs`, `stopRule` |

| Value | Bounds |
| --- | --- |
| `vus`, `preAllocatedVUs`, `maxVUs` | 1 to 100,000; `maxVUs` at least `preAllocatedVUs` |
| `startVUs`, VU stage `target` | 0 to 100,000; at least one must be above 0 |
| Rates and rate stage `target` | 1 to 1,000,000 per `timeUnit` |
| `iterations` | 1 to 1,000,000,000; per VU for `per-vu-iterations`; shared and at least `vus` for `shared-iterations` |
| `stages` | 1 to 128 |
| `duration`, `maxDuration` | At least 1 s |

`ramp-until` starts at `startRate` and adds `stepRate` every `stepDuration` until
it reaches `maxRate` (at most 128 steps). It stops the whole run, including other
scenarios, when its `stopRule` becomes true. If it reaches `maxRate` without the
rule being true, the outcome is inconclusive.

### Rules

SLOs and `stopRule` share one shape: `id`, `metric`, `stat`, `operator` (`>`,
`>=`, `<` or `<=`) and `value` (0 to 1,000,000,000,000). An SLO passes when
`stat operator value` holds. Rule IDs must be unique across all SLOs and stop
rules. The stat must suit the metric:

| Metrics | Stats allowed |
| --- | --- |
| `http_req_duration`, `http_req_blocked`, `http_req_connecting`, `http_req_tls_handshaking`, `http_req_sending`, `http_req_waiting`, `http_req_receiving`, `iteration_duration` | `avg`, `min`, `max`, `med`, `p50`, `p90`, `p95`, `p99` |
| `http_reqs`, `iterations`, `dropped_iterations`, `data_received`, `data_sent`, `beetle_requests`, `beetle_assertions`, `beetle_assertion_failures`, `beetle_required_failures`, `beetle_transport_failures`, `beetle_execution_failures` | `count`, `rate` |
| `http_req_failed` | `rate` |
| `vus`, `vus_max` | `value` |

## Requests

| Field | Value |
| --- | --- |
| `id`, `name` | Identifier; display name of 1 to 128 characters, unique |
| `method` | `GET`, `POST`, `PUT`, `PATCH` or `DELETE` |
| `path` | Starts with `/`; up to 4,096 characters |
| `query`, `headers` | Objects of up to 64 names (1 to 128 characters) to string values (up to 4,096) |
| `assertions` | 0 to 64 checks on each response |

An optional `body` is either `{"kind": "json", "value": ...}` with any JSON value, or
`{"kind": "input", "input": {...}, "format": "text"}` (or `"json"`) to send a
published input. Unless the body is a text input, `Content-Type:
application/json` is added when you set no `Content-Type` header. Paths, query
and header values, and body strings can be [templates](/guides/datasets/).

### Assertions

Each assertion has an `id`, a `kind` and `required`. A failed **required**
assertion fails the run; a failed optional one is only counted.

| `kind` | Fields | Passes when |
| --- | --- | --- |
| `statusEq` | `value` 100 to 599 | The status equals `value` |
| `statusFamily` | `value` 1 to 5 | The status is in that hundred, for example `2` for 2xx |
| `bodyContains` | `value` | The body contains the text |
| `headerExists` | `name` | The header is present |
| `headerEquals`, `headerContains` | `name`, `value` | The header equals or contains `value` |
| `jsonExists` | `path` | The JSON path exists |
| `jsonEquals` | `path`, `value` (string, number, boolean or null) | The value at the path equals `value` |
| `jsonContains` | `path`, `value` (string) | The value at the path contains the text |
| `jsonCompare` | `path`, `operator` (`lt`, `lte`, `gt`, `gte`), `value` (number) | The comparison holds |

A JSON path is `$` then up to 32 `.name` or `[index]` parts, such as
`$.users[0].id`. Wildcards, filters and quoted keys are not supported.

## Selections

Each scenario needs exactly one entry in `selections`: `scenarioId` and 1 to 64
`entries`, each naming a different request. Every iteration sends **one** request,
chosen at random in proportion to `weight`, then waits.

| Field | Value |
| --- | --- |
| `requestId` | A request's `id` |
| `weight` | 1 to 1,000,000 |
| `maxIterationsPerVu` | Optional, 1 to 1,000,000,000; the entry stops being chosen on that VU after this many |
| `wait` | `durationMs` plus a random whole number from 0 to `jitterMs`; each 0 to 3,600,000 |

If every entry of a VU has reached its `maxIterationsPerVu`, the next iteration is
an execution failure, which fails the run.

## Secrets, readiness and sampling

A secret reference has `name` (identifier), `provider` (1 to 128 characters),
`locator` (1 to 256) and an optional `version` (1 to 256). The installation
supplies the value. Without a `version`, the run marks reproducibility unknown.

| `readiness` field | Value |
| --- | --- |
| `path` | A `GET` path under the target; may use secrets, not datasets |
| `attempts`, `intervalMs`, `timeoutMs` | 1 to 100; 0 to 3,600,000; 1 to 60,000 |
| `wallBudgetMs` | At least `attempts × timeoutMs + (attempts − 1) × intervalMs`, at most 24 h |
| `expectedStatus`, `assertions` | 100 to 599; 0 to 64 assertions |
| If no attempt passes | The run fails during preparation |

| `targetSampling` field | Value |
| --- | --- |
| `path`, `intervalMs` | Path under the target to poll; 1,000 to 60,000 |
| `timeoutMs` | 100 to 5,000, and no more than `intervalMs` |
| `cooldownMs` | 0 to 60,000; how long to keep sampling after the load ends |

## Example

This suite passes the schema and the engine's checks.

```json
{
  "version": 1, "target": "http://host.docker.internal:8080/api",
  "requests": [
    { "id": "get-user", "name": "Get user", "method": "GET", "path": "/users/{{data.users.id}}",
      "query": {}, "headers": { "Accept": "application/json" },
      "assertions": [ { "id": "ok", "required": true, "kind": "statusEq", "value": 200 },
        { "id": "named", "required": false, "kind": "jsonExists", "path": "$.name" } ] },
    { "id": "order", "name": "Create order", "method": "POST", "path": "/orders",
      "query": {}, "headers": {}, "body": { "kind": "json", "value": { "user": "{{data.users.id}}" } },
      "assertions": [ { "id": "created", "required": true, "kind": "statusFamily", "value": 2 } ] } ],
  "datasets": [ { "id": "users", "selection": "random", "kind": "inline",
    "rows": [ { "id": "u-1" }, { "id": "u-2" } ] } ],
  "secrets": [],
  "loadPlan": { "version": 1,
    "scenarios": [ { "id": "steady", "name": "steady", "executor": "constant-arrival-rate",
      "startTime": "0s", "gracefulStop": "30s", "rate": 20, "timeUnit": "1s", "duration": "2m",
      "preAllocatedVUs": 10, "maxVUs": 50 } ],
    "slos": [ { "id": "p95", "metric": "http_req_duration", "stat": "p95", "operator": "<", "value": 500 } ] },
  "selections": [ { "scenarioId": "steady", "entries": [
    { "requestId": "get-user", "weight": 4, "wait": { "durationMs": 0, "jitterMs": 0 } },
    { "requestId": "order", "weight": 1, "wait": { "durationMs": 100, "jitterMs": 50 } } ] } ]
}
```

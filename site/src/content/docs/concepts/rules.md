---
title: Pass and fail rules
description: How pass or fail rules and the stop rule of a ramp-until scenario are written, and how they decide a run's outcome.
sidebar:
  order: 4
---

A **rule** compares one statistic of one k6 metric with a fixed value. A suite's
load plan uses rules in two ways:

- **Pass or fail rules**, listed under `slos`, decide whether a run passed.
- A **stop rule**, the `stopRule` of a `ramp-until` scenario, decides when to stop
  raising load.

Beetle Lab compiles rules into k6 thresholds and takes the verdict k6 reports. It
never recalculates a rule from the numbers afterwards.

## Writing a rule

```json
{
  "id": "latency",
  "metric": "http_req_duration",
  "stat": "p95",
  "operator": "<",
  "value": 500
}
```

| Field | What it holds |
| --- | --- |
| `id` | A name for the rule: letters, digits, `_` and `-`, up to 64 characters, not starting with a digit or `-` |
| `metric` | A k6 metric name: letters, digits and `_`, up to 64 characters, not starting with a digit |
| `stat` | The statistic of that metric to compare |
| `operator` | `>`, `>=`, `<` or `<=` |
| `value` | A number from 0 to 1,000,000,000,000 |

Rule IDs must be unique across the whole load plan, including stop rules. A load
plan can have up to 128 pass or fail rules. The metric name cannot carry tags.

## Statistics

Which statistic makes sense depends on the kind of k6 metric.

| `stat` | Use with | Meaning |
| --- | --- | --- |
| `avg`, `min`, `max`, `med` | Trends, such as `http_req_duration` | Average, minimum, maximum, median |
| `p50`, `p90`, `p95`, `p99` | Trends | Percentile |
| `count` | Counters, such as `http_reqs` | Total over the run |
| `rate` | Counters, or rates such as `http_req_failed` | Per second for a counter; share of true values for a rate |
| `value` | Gauges, such as `vus` | The gauge's value |

Durations in k6 are in milliseconds, so `p95 < 500` on `http_req_duration` means
the 95th percentile stayed under half a second.

## Pass or fail rules

Pass or fail rules are checked over the whole run. A failing rule does not stop
the run early; the run continues to the end of its scenarios.

| Outcome | When |
| --- | --- |
| `passed` | Every rule held and the evidence is complete |
| `failed` | At least one rule failed, or a required assertion failed |
| `inconclusive` | A rule could not be decided, or part of the evidence is missing |

A rule cannot be decided when k6 did not record the statistic it needs. For
example, a percentile of `http_req_duration` in a run that sent no requests has no
value, so the run is inconclusive rather than passed. A counter that genuinely
stayed at zero is a real value and does decide its rule.

See [Runs](/concepts/runs/) for how the outcome relates to the run's state.

## The stop rule of a ramp-until scenario

A `ramp-until` scenario starts at `startRate` and raises the arrival rate by
`stepRate` every `stepDuration` until it reaches `maxRate`. Rates are whole
numbers from 1 to 1,000,000, `maxRate` cannot be lower than `startRate`, and the
ramp can have at most 128 steps.

The stop rule describes the **condition for stopping**, not a condition that must
hold. With this rule, the ramp stops once the 95th percentile goes above 500 ms:

```json
"stopRule": {
  "id": "stop",
  "metric": "http_req_duration",
  "stat": "p95",
  "operator": ">",
  "value": 500
}
```

Internally the rule becomes the opposite k6 threshold (`p(95)<=500` here) with
`abortOnFail` set. When the stop condition becomes true, that threshold fails
and k6 aborts the **whole run**, including every other scenario in the load plan,
not only the ramp.

| What happened | Outcome |
| --- | --- |
| The stop rule fired, k6 stopped because of it, and nothing else failed | `passed` |
| The stop rule fired, but a pass or fail rule or a required assertion failed | `failed` |
| The ramp reached `maxRate` and ended without the stop rule firing | `inconclusive` |
| The stop rule's statistic was not recorded | `inconclusive` |

Reaching `maxRate` is inconclusive because the test never found the point it was
looking for. Raise `maxRate` or tighten the stop rule and run again.

If a load plan has several `ramp-until` scenarios, the result names the first stop
rule that fired, in the order the scenarios are listed, and keeps the verdict of
each one.

:::note
A stop rule is a search, so a run where it fires is a success. A pass or fail rule
is a requirement, so a run where it fails is a failure. Choose the kind that
matches what you want to learn.
:::

## Where to see rule results

A run's result records each decided rule with its ID, whether it is a pass or
fail rule or a stop rule, and whether its threshold passed. For a stop rule, a
failed threshold means the stop condition was reached.
[Results](/concepts/results/) describes the rest of the result.

---
title: Your first test
description: Create a workspace and a suite, start a run, watch it, and read its result.
sidebar:
  order: 2
---

This walkthrough takes a fresh installation to a finished run. It assumes the UI
is open at <http://127.0.0.1:4567> and that you have an HTTP service to test.

## 1. Make a place for it

Everything lives in an **organisation**, and inside it a **workspace**. Create
one of each from the home page. Workspaces can hold folders, so you can group
suites by service or team later.

Settings such as run budgets and retention are inherited: installation, then
organisation, then workspace. Each level can only narrow what the level above
allows.

## 2. Write a suite

A **suite** describes what to send and how hard. Its configuration has:

| Part | What it holds |
| --- | --- |
| Target | The base URL, for example `http://host.docker.internal:8080` |
| Requests | Up to 64 named requests: method, path, headers and body |
| Load plan | One or more scenarios using a k6 executor, plus pass or fail rules |
| Selections | Which requests each scenario sends, with weights and waits |
| Datasets and secrets | Optional data files and secret references the requests use |

Available executors are `constant-vus`, `ramping-vus`, `constant-arrival-rate`,
`ramping-arrival-rate`, `shared-iterations`, `per-vu-iterations` and
`ramp-until`, which raises load until a rule fails. Pass or fail rules compare a
metric statistic, such as `p95` of request duration, with a value.

Saving creates an immutable **revision**. Editing later creates a new revision;
runs always point at the exact revision they used, so history stays honest.

:::note
Saving checks the configuration's structure. The engine validates it fully
when the run is admitted, so a mistake the structural check cannot see shows up as
an errored run with an `invalid_config` reason, not as a save error.
:::

## 3. Start a run

From the suite, start a run. Choose a budget (CPU, memory, duration and output)
within the limits your settings allow, and an execution policy:

- **Parallel** lets other runs share the machine.
- **Isolated** waits until nothing else is running, so measurements are not
  disturbed by neighbours.

The run is queued immediately. It moves through `queued`, `dispatching`,
`active` and `finalizing` before it ends. [Runs](/concepts/runs/) explains each
state.

## 4. Watch it

The run page shows the execution timeline as it happens: admission, phases,
progress and resource summaries. While the run is active, live metrics for the
target refresh every few seconds.

You can cancel at any time. Cancelling records your intent straight away; the run
shows as cancelled once the engine has actually stopped and its output is safe.

## 5. Read the result

When the run ends you get:

- **The outcome**: passed, failed or inconclusive, decided by your rules and by
  the evidence the engine sealed.
- **A performance report** with request, assertion and resource figures, which
  you can download as text or CSV.
- **Artefacts** such as the result summary, warnings and diagnostics, each with
  its size and SHA-256.

Run it again after a change, then select both runs and **compare** them: you see
metric deltas and exactly which configuration fields differ.

Next: learn [how it works](/concepts/how-it-works/), or automate this from CI with
the [HTTP API](/guides/automation/).

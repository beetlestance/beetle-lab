---
title: Your first test
description: Create a workspace and a suite, start a run, watch it, and read its result.
sidebar:
  order: 2
---

This walkthrough takes a fresh installation to a finished run. It assumes the app
is open at <http://127.0.0.1:4567> and that you have an HTTP service to test.

:::note[Matches this installation]
The documentation at `/docs` on your installation ships in the same frontend
image as the app, so it describes the version you are running and works offline.
:::

## Find your way around

The header is the same on every page: the organization switcher next to the logo,
then **Overview**, **Workspaces**, **Engines**, **Settings** and **Docs**, and
**Search** on the right. Inside a workspace, tabs lead to its **Suites**, **Runs**,
**Inputs**, **Exports** and **Settings**.

## 1. Make a place for it

Everything lives in an **organization**, and inside it a **workspace**. Open the
organization switcher, choose **Create organization** and give it a name and a
slug, the short name used in links. Then create a workspace in it with
**Create workspace**.

Settings such as run budgets and retention are inherited: installation, then
organization, then workspace. The most specific value wins, within the
installation's limits; see [Organisations and workspaces](/concepts/workspaces/).

## 2. Write a suite

In the workspace's **Suites** tab, choose **New suite**, then **k6 load tests**.
A **suite** describes what to send and how hard:

| Part | What it holds |
| --- | --- |
| Target | The base URL, for example `http://host.docker.internal:8080` |
| Requests | Up to 64 named requests: method, path, headers, body and checks |
| Load plan | One or more scenarios using a k6 executor, plus pass or fail rules |
| Request mix | Which requests each scenario sends, with weights and waits |
| Data and secrets | Optional input files and secret references the requests use |

The editor's form covers the target, requests, how load arrives and the pass or
fail rules. **Run setup** holds the scenarios and request mix, and the complete
configuration is also editable as JSON.

Available executors are `constant-vus`, `ramping-vus`, `constant-arrival-rate`,
`ramping-arrival-rate`, `shared-iterations`, `per-vu-iterations` and
`ramp-until`, which raises load until a rule fails. Pass or fail rules compare a
metric statistic, such as `p95` of request duration, with a value.

Saving creates an immutable **revision**, with an optional message saying what
changed. Editing later creates the next revision; runs always point at the exact
revision they used, so history stays honest.

:::note
Saving checks the configuration's structure. The engine validates it fully
when the run is admitted, so a mistake the structural check cannot see shows up as
an errored run with an `invalid_config` reason, not as a save error.
:::

## 3. Start a run

On the suite, choose **Start run**. The dialog shows:

- **Revision**: the latest by default; pick an older one to rerun it.
- **Length** of the plan, and the **Budget** it gets (CPU, memory, processes,
  time limit and output) from your settings. You can change the budget for this
  run only, within the limits your settings allow.
- **Target** and **Engine profile**.
- **Run alone. Other runs wait until this one ends.** Ticked, the run is
  isolated, so measurements are not disturbed by neighbours. Unticked, it runs in
  parallel with others.
- **Note for this run (optional)**, to remember why you ran it.

The run is queued immediately. It moves through `queued`, `dispatching`,
`active` and `finalizing` before it ends. [Runs](/concepts/runs/) explains each
state.

## 4. Watch it

The live run page shows where the run is in its plan, the main figures as they
arrive, the pass or fail rules, and the timeline: admission, phases and progress.
While the run waits, the page says what it is waiting for. While it is active,
live figures refresh every few seconds.

You can **Cancel run** at any time. Cancelling records your intent straight away;
the run shows as cancelled once the engine has actually stopped and its output is
safe.

## 5. Read the result

When the run ends, its page becomes the result:

- **The outcome**: passed, failed or inconclusive, decided by your rules and by
  the evidence the engine sealed, with a one-line summary.
- **Summary** figures, **Thresholds** and the **Script version** the run used.
- **Report**, **What happened**, **Artifacts** and **Diagnostics**: the
  performance report, the timeline, the sealed files with their sizes and
  SHA-256, and any problems recorded.
- **Run again** with the same revision, budget and policy, **Pin this run** to
  keep it, and **Delete run…**.

Run it again after a change, then tick both runs in **Runs** and choose
**Compare**: you see metric deltas and exactly which configuration fields differ.

Next: learn [how it works](/concepts/how-it-works/), or automate this from CI with
the [HTTP API](/guides/automation/).

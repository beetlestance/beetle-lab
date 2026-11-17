---
title: Beetle Lab
description: A self-hosted workbench for k6 performance tests, with isolated execution, live metrics, durable results, comparison and reports.
template: splash
hero:
  tagline: Run k6 load tests on your own machine or server. Every run is isolated, measured, kept and comparable.
  actions:
    - text: Install in five minutes
      link: start/install/
      icon: right-arrow
    - text: How it works
      link: concepts/how-it-works/
      variant: minimal
---

## What you get

- **A browser workbench.** Organise suites in organisations and workspaces, keep
  every configuration as an immutable revision, and start or cancel runs from the
  UI or the HTTP API.
- **Isolated execution.** Each run gets its own disposable k6 container with CPU,
  memory, process, time and output limits that you set within installed ceilings.
- **Numbers you can trust.** Results are sealed before they are shown. Missing
  data is shown as unknown, never as zero, and an engine's report never overrides
  the run's recorded outcome.
- **History and comparison.** Metric history, performance reports, CSV and JSON
  exports, and side-by-side comparison of up to four runs with the differences
  between their configurations.
- **Automation.** A public HTTP API with generated schemas, a small client inside
  the backend image for CI, and downloadable instructions for AI agents.

## Where to start

| You want to | Read |
| --- | --- |
| Install and open the UI | [Install](/start/install/) |
| Run your first test end to end | [Your first test](/start/first-test/) |
| Understand the moving parts | [How it works](/concepts/how-it-works/) |
| Know what a run's state and outcome mean | [Runs](/concepts/runs/) |
| Read reports and compare runs | [Results](/concepts/results/) |
| Prepare suites and test data | [Suites and inputs](/guides/suites-and-inputs/) |

Beetle Lab is open source under the MIT licence. It is built for one trusted
administrator; read the [security model](/concepts/how-it-works/#trust-and-security)
before you install it on a shared machine.

---
title: Beetle Lab
description: A self-hosted workbench for k6 performance tests, with isolated execution, live metrics, durable results, comparison and reports.
template: splash
hero:
  title: Run k6 load tests on your own machine
  tagline: Every run is isolated, measured, kept and comparable. Install it, run a first test, then learn what a result can and cannot tell you.
  image:
    file: ../../assets/engine-illustration.png
    alt: An isometric k6 engine on a platform, with a checklist and a rising chart beside it.
  actions:
    - text: Install in five minutes
      link: start/install/
    - text: How it works
      link: concepts/how-it-works/
      variant: minimal
---

<section class="bl-life" aria-labelledby="life-title">
<header><h2 id="life-title">From Run to result</h2><p>Every phase has its own time, work and output budget.</p></header>
<ol>
<li style="--i:1"><span class="bar"></span><span class="name"><span>01</span>Queue</span><span class="sub">Recorded with its request ID</span></li>
<li style="--i:2"><span class="bar"></span><span class="name"><span>02</span>Offer</span><span class="sub">Exact revision, engine, budget</span></li>
<li style="--i:3"><span class="bar"></span><span class="name"><span>03</span>Admit</span><span class="sub">Fits capacity and policy</span></li>
<li style="--i:4"><span class="bar"></span><span class="name"><span>04</span>Validate</span><span class="sub">Against the installed schema</span></li>
<li style="--i:5"><span class="bar"></span><span class="name"><span>05</span>Execute</span><span class="sub">k6 inside its limits</span></li>
<li style="--i:6"><span class="bar"></span><span class="name"><span>06</span>Seal</span><span class="sub">Sizes and SHA-256 digests</span></li>
<li style="--i:7"><span class="bar"></span><span class="name"><span>07</span>Finalise</span><span class="sub">Verified, then recorded</span></li>
</ol>
</section>


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

<nav class="bl-paths" aria-label="Documentation sections">
<div><h2>Start</h2><ul><li><a href="start/install/">Install<span>Docker Compose on one machine</span></a></li><li><a href="start/first-test/">Your first test<span>A suite, a run and its result</span></a></li></ul></div>
<div><h2>Concepts</h2><ul><li><a href="concepts/how-it-works/">How it works<span>Four containers and the trust model</span></a></li><li><a href="concepts/runs/">Runs<span>States, outcomes, cancelling</span></a></li><li><a href="concepts/results/">Results<span>Reports, warnings, comparison</span></a></li></ul></div>
<div><h2>Guides</h2><ul><li><a href="guides/suites-and-inputs/">Suites and inputs<span>Revisions, datasets, templates</span></a></li><li><a href="guides/automation/">Automate from CI<span>Run and gate from a pipeline</span></a></li><li><a href="guides/change-capacity/">Change capacity<span>More memory or output space</span></a></li><li><a href="guides/backup-and-restore/">Back up and restore<span>Cold backup, read-only history</span></a></li></ul></div>
<div><h2>Reference</h2><ul><li><a href="reference/limits/">Limits<span>Every fixed size and time</span></a></li><li><a href="reference/troubleshooting/">Troubleshooting<span>Waiting, errored, inconclusive</span></a></li></ul></div>
</nav>

Beetle Lab is open source under the MIT licence. It is built for one trusted
administrator; read the [security model](/concepts/how-it-works/#trust-and-security)
before you install it on a shared machine.

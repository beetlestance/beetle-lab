---
title: Results
description: The result, report, live metrics, warnings, target readings and run comparison, and how to read each honestly.
sidebar:
  order: 3
---

Every finished run keeps a sealed set of artefacts. The UI, reports and exports
are all derived from that set; nothing recalculates metrics from scratch.

A finished run's page opens with the outcome and a one-line summary, then
**Summary** figures, **Thresholds** with each rule's result, and the **Script
version** the run used, with **View script**. Below, four tabs hold the detail:
**Report**, **What happened** (the run's timeline), **Artifacts** and
**Diagnostics**. A figure the run did not record is left out or shown as unknown,
never as zero.

## Artefacts

| Artefact | Contents |
| --- | --- |
| Result | Outcome, rule results and the summary k6 produced |
| Numeric metrics | Per-request and per-assertion series used for history and charts |
| Warnings | Counts of k6 warnings such as insufficient VUs or high metric cardinality |
| Diagnostics | Bounded, redacted codes describing problems during the run |
| Target readings | Optional runtime figures sampled from your service |

The **Artifacts** tab lists each artefact with its size and SHA-256. Downloads are
checked against both before the browser receives the end of the file.

## Performance report

The **Report** tab shows request, assertion and resource figures in one view.
**Download text report** saves it as text, and the per-interval metrics are among the
artefacts as CSV. In the CSV, a blank cell means the value was not available. Rates are never recomputed and percentiles are never averaged across
series; what you see is what k6 measured.

## Live metrics

While a run is active, the live run page refreshes target metrics about every 2 s.
**Pause stream** stops the page updating without affecting the run. A
snapshot older than 6 s is not shown as current. Live figures are a preview; the
sealed result is the record.

## Warnings

Warnings explain conditions that may distort a measurement, for example k6 running
out of VUs to keep a requested arrival rate. They are advice: they never change a
rule's result. If some warning output could not be classified, warning coverage is
marked partial.

## Target readings

If you enable target sampling, the engine polls a URL on your service during the
execute phase (every 1–60 s, one request at a time, no credentials, at most 64 KiB
per reply, up to 256 samples). These are figures your service reports about
itself, such as memory or garbage collection, and they are labelled as such, never
as engine measurements.

## Load advice

When a run shows dropped iterations, the UI can suggest how many VUs would sustain
the requested rate: the median iteration duration × rate × (1 + headroom). Headroom
defaults to 20 %. It needs complete coverage of the execute phase; otherwise it
says it cannot advise.

## Comparing runs

Compare two to four finished runs of the same workspace:

1. Open the workspace's **Runs** tab and tick the runs. Only finished runs can be
   ticked. The first one you tick is the **baseline**.
2. Choose **Compare 2** (the number follows your selection).

The comparison shows each run with its status, the baseline marked **Baseline**
and **Make baseline** on the others. Whole-run figures show how far each run
moved from the baseline: a relative change, percentage points for rates, or
"same". Where either side has no value, no change is shown. **What was different
between the runs** lists revision, engine profile, limits, execution policy and
note, and a chart shows one chosen metric for each run.

- Metrics are matched by the stable identity of each request and assertion, even
  if they were renamed between revisions. Removed ones show as not applicable.
- Configuration differences are listed field by field, without secrets, headers,
  bodies or URLs.
- Warnings point out what could make the runs unequal: different target revision,
  contention from other runs, unknown secret versions, disabled sampling, or a
  missing or partial result.
- Each run's chart keeps its own time axis and scale; the charts are not overlaid.

A comparison states differences; it never claims two runs were equivalent. The
automation client's `compare` command returns the same comparison as JSON.

## Exports

From a suite revision you can export a standalone k6 script that runs the same
plan outside Beetle Lab. Export runs as its own admitted job, produced by the same
compiler the engine uses, and is never a run. A revision that uses a secret is
refused rather than exported partially. See [Export a k6 script](/guides/export-scripts/).

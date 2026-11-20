---
title: Export a k6 script
description: Turn a saved suite revision into a standalone k6 script you can run without Beetle Lab, and what each export state means.
sidebar:
  order: 9
---

An **export** turns one saved suite revision into a single k6 script, `suite.js`,
that runs with plain k6 wherever you like. Exporting sends no load and runs no
test: the agent only compiles and builds the script, with the same compiler the
engine uses for runs.

## Export from the app

1. Open the suite, then **Revisions**, and choose **View script** on the revision
   you want. A run result's **View script** opens the revision that run used.
2. Choose **Export script**. The dialog shows the export's progress: queued,
   sent to the agent, writing the script, checking and saving.
3. When it is ready, the dialog shows the file name, size, SHA-256 and when it
   was made. Choose **Download script**. **Copy SHA-256** lets you check the
   file you downloaded, for example with `sha256sum suite.js`. The automation
   client's `export-download` checks size and SHA-256 for you.

To export exactly what a run executed, choose **Export script…** on its result.
That export uses the run's own revision, engine profile, budget and time limit
instead of the workspace defaults.

You can close the dialog while it works and come back later. The **Exports** tab of
the workspace lists every export with its suite revision, status, result, size
and time, with **Download** for ready ones and **Cancel** for unfinished ones.

An export started from the app uses the workspace's default run budget and
engine profile, a 1 MiB limit on the script's size, and a 3-minute time limit
that the downloaded script enforces on itself when you run it. The automation
client and the HTTP API let you choose both limits, up to 64 MiB and 48 hours;
see [Command-line tools](/reference/cli/).

## Export states

| Status | Meaning |
| --- | --- |
| Queued | Waiting for capacity, like a run |
| Sent | Offered to the agent |
| Generating | The agent is writing the script |
| Checking | The script is being verified and published |
| Ready | The script can be downloaded |
| Failed | No script was made; the result gives the reason |
| Cancelled | Stopped at your request |
| Unknown | Beetle Lab cannot tell whether the export finished |

**Unknown** means the agent stopped answering at a point where the outcome could
not be confirmed. The export stays unknown, and keeps its reserved output space,
until the agent reports back. Beetle Lab never guesses a result. The dialog shows
when the agent was last heard from and how much space is reserved, and you can
still cancel.

## Revisions that use secrets

A standalone script would have nowhere safe to read a secret from, so a revision
that refers to any secret is never exported. The dialog says **This revision
can't be exported**, names the secret, and sends nothing. Save a revision
without secret references and export that one. A request sent through the API
for such a revision fails with the reason that suites using secrets can't be
exported.

## Other reasons an export fails

| Reason | What to do |
| --- | --- |
| The configuration could not be turned into a script | Fix the suite and save a new revision |
| No capacity was free for the reserved budget | Try again when runs have finished |
| Writing the script took too long | Raise the workspace's run time limit, or export through the API with a longer one |
| The script was larger than the output budget | Export through the API with a larger maximum script size and output budget |
| The script did not build | Check the suite against the [limits](/reference/limits/), save a new revision and export again |

The output budget must cover the maximum script size plus 73,728 bytes for the
export's own result. If the workspace output budget is too small for a 1 MiB
script, raise it in the workspace settings.

## Things to know

- The script embeds the revision's inline datasets and request bodies. Treat it
  as you would the suite itself.
- An export uses the same queue and capacity as runs, and counts towards
  isolation: an isolated run waits for it.
- An export is not a run. It has no outcome, rules or metrics, and it never
  appears in run history or comparisons.
- Exports are not removed by retention, and the space they use is not returned
  yet.
- An installation without an export engine cannot export. The dialog says so.

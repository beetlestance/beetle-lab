# First usable local rewrite cut

Status: locally verified on Docker Desktop, native Linux arm64. This is an opt-in
source installation; the published legacy default is unchanged.

## Verified path

The [launcher](../../deploy/local/README.md) builds separate installer, frontend,
backend, agent and k6 images, creates private coherent configuration, provisions
fresh authority and waits for an authenticated API boundary to become reachable.
A fresh isolated Chrome profile exercised actual pointer/keyboard controls through
Nginx: pair, create organization, navigate, close a confirmed editor, create
workspace/suite, save immutable JSON revision, submit a run, view results/metrics,
reload, open history and download a published artifact.

The synthetic run used one VU, two iterations and three-second waits. Application
state finished/passed, engine validation passed, one required assertion passed,
and all four artifacts published. The target counted exactly two requests after
ready startup replay. The metric view reported19 series, seven source windows,
complete coverage and total request count2. The browser-saved metric artifact had
10675 bytes and matched its published SHA-256. Final settled reads and download
had no browser exceptions or failed HTTP responses. The chart screenshot was
visually inspected. Configuration hashes stayed unchanged across status/up.

## Source identity and corrections

Runtime images were built at036018e; all five revision labels and arm64 identity
were inspected. The frontend was then replaced alone by an explicit test override
at aa66fc3, reusing the existing completed run. No backend/agent/engine code changed
between those revisions. This is not evidence for a fresh all-components build at
aa66fc3. Ready startup preserves the original image pins; the override was restored
after that check. A clean new checkout installation builds its own matched pins.

The browser exposed runtime AJV compilation blocked by CSP. Build-time standalone
validators now preserve strict native options and share registries; Nginx retains
its original policy. The packaged path exercised pairing/date-time validation.
Confirmed namespace edits remain closable after navigation.

Actual launcher use exposed locale-dependent ASCII ranges and an unsupported
Compose one-off flag. Both were corrected with focused regressions. Low-volume
k6 JSON buffering delayed the measurement-start marker beyond the old prepare
limit. Prepare now shares the default run timeout; the overall deadline and output
ceilings remain unchanged. The earlier failed attempt/data were preserved.

Concurrent detail panels exceeded the unchanged storage reply limit. RunReads
now admits one original finite read plus four waiting intents, with five-second
waiting expiry and explicit cancellation/retirement. No HTTP retries or mutation
changes were introduced. Review caught effect replay closing a reused gate;
layout setup now owns a new gate, covered by a StrictMode component regression.

## Scoped checks and elapsed time

| Check | Actual result |
| --- | --- |
| Browser validator VM and shipped valid/invalid corpora | Three focused cases passed; no runtime string compilation |
| Confirmed-editor navigation regression | One selected case passed4.57s |
| Launcher locale/Compose corrections | One selected case each passed0.675s/1.91s |
| Starter phase policy | Three selected cases passed2.44s |
| Read gate and affected result/metrics/artifact views |38 cases/four files passed6.83s |
| StrictMode provider lifecycle | One case passed1.60s |
| Affected frontend TypeScript and changed-file ESLint | Exit0 |
| Source/document structure |1753 source files/289 documents passed before this evidence page |
| Initial five-image build/launch |51.37s; failed afterward on unsupported Compose flag, preserved |
| Five-image build/fresh launcher after phase correction | Exit0,24.64s with existing task builder cache |
| Changed frontend builds | Exit0,1.94s and3.19s; unchanged images reused |
| Status/ready replay and hash/target checks | Exit0,3.01s |

No full suite was repeated for this packet. Independent source review covered the
validator/editor changes and consequential read-admission lifecycle correction.
Private reports retain packet identities, source hashes, failures and commands.

## Limits

Published pull installation, native amd64, scanner/SBOM, accessibility/viewport
matrix, crash/restore, long-run/resource qualification and full R0-R4 remain open.
Live transport, target sampling, reports/comparison/export/automation and retention
are separate work. Browser save was checked for one bounded synthetic artifact.
A download started while chart reads the same artifact produced a busy response;
settled chart reads followed by download passed. The read-only local profile still
trusts the Docker daemon and current installation owner.

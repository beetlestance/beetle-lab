# Browser target-observation acceptance

Actual headless Chromium, unmodified matchingb48936d8 ARM64 images. Existing
repository harness with explicit `target-runtime` profile. Trial3 passed47.745s;
browser/installation and independent cold cleanup all succeeded. Frozen input
hashes match. Evidence: `.agent-work/browser-targets`, private plan/reports.

The browser authored a second suite revision through the visible JSON editor and
ran the40-request synthetic target sampler fixture. It requested8MiB output;
stock CPU/RAM/PID and installation gates stayed unchanged. No UI style changed.

| Visible behavior | Accepted proof |
| --- | --- |
| Scope | Target-reported heading and explicit separation from engine measurements |
| Zero | heapAlloc before/peak/final and ready table cells remained0 |
| Known value | rss before/peak/final remained123456, with zero percentage change |
| Unknown | Invalid external remained Unavailable; missing final recovery explanation visible |
| Chronology | Eight rows, before/during/after order,6ready/2unavailable; reasons http/invalid_json |
| Unsupported source field | No temperature metric option was fabricated |
| Lifecycle | Explicit target-report Reload, then page reload plus Reload retained correct values |
| No re-execution | Physical sampler/work counts stayed unchanged through viewing/reloads |

This accepted the explicit manual Reload flow. Trial1 failed45.930s because the
target panel was in its initial read-error state. Other report panels also showed
read errors. Its exact HTTP cause was not captured. Trial3 still observed that
initial state, then passed through three visible Reload actions. Across page
content requests, bounded status capture recorded503/409/200. The list does not
attribute each status to a particular artifact or prove one historical cause.
No automatic retry, longer client timeout or production read gate was introduced.
Automatic initial-report availability is not accepted by this case.

An intermediate plan failed checkJS before effects due to an untyped status array;
the explicit number-array annotation corrected it. Scoped browser types/lint,
architecture/docs and independent source review passed. Earlier default functional,
interaction and reference branches retain their behavior; they were not rerun.

In-app browser control was not exposed after tool discovery; this used the pinned
repository Chromium test harness and existing browser cache. No user browser or
installation was selected. Native artifact/hash/field proof is separate in
[native target runtime](native-target-runtime.md). This is not sensor-accuracy,
accessibility certification, native AMD64 or every A08 fault/heuristic variant.

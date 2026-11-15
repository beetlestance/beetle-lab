# Qualification status and remaining blockers

Scope follows [remaining packets](../execution/remaining-rewrite.md). Passing a
newer candidate does not explain an earlier failure or complete the release matrix.

| Area | Current evidence and remaining acceptance |
| --- | --- |
| Original output-guard prepare failure | The unmodified 9c326f4 run stopped with `artifact_incomplete`, exit 137 / OOM false. The exact scanner/clock/freshness branch was not retained. A separate [deferred-dispatch defect](guard-dispatch-deadline.md) is now reproduced under shipped caps and corrected without changing sample/TTL/resource limits; source run `43684837244`, delivery run `43688603429` and twelve current-image browser phases passed. This is a retrospective trace limitation, not a claim of the historical cause. Do not infer a historical CPU-limit cause. |
| Publisher/guard composition | A separate real-scanner reproduction exposed the publisher's temporary second hard link. Exclusive single-link publication fixes that custody violation. Red/green cases, independent review and newer native/browser success support this fix; it does not explain the earlier prepare failure. |
| Hosted packaged native | Run [43684837244](https://github.com/beetlestance/beetle-lab/actions/runs/43684837244), revision `72243a87`, passed source, legacy, six unit shards, AMD64/ARM64 Compose execution, scans, isolated archive restoration and both aggregates. Anonymous registry pulls and normal Compose execution also passed on both architectures in delivery run `43688603429`. |
| Packaged browser | Actual Chromium acceptance on unmodified public 72243a87 ARM64 images passed all twelve functional phases with verified cleanup. Authoring, inputs/folders, run/cancel/reconnect, metrics, history/comparison, reports/exports, deletion and settings passed. The full keyboard/theme/viewport and abuse matrix remains separate; this was not a UI redesign. |
| Public polling | Current hosted normal and anonymous-pull flows passed on both architectures, and actual current-image browser acceptance passed. The earlier de4f908 read abort reproduced at the existing 2-second client bound; its historical underlying latency cause is unknown. Only validated retryable 503 capacity GETs use existing bounded readiness handling; mutations and content checks remain unchanged. |
| Delivery and supply chain | Both architecture inventories passed HIGH/CRITICAL scans including unfixed findings, image/source SBOMs and dependency audit. Exact artifacts, sources and local OCI indexes were verified. Run `43688603429` published the exact indexes and passed fresh anonymous pulls and native Compose execution on both architectures. The local installer prerelease is public and its Compose/environment assets passed anonymous full-byte hash readback. This closes candidate delivery, not full release sign-off. |
| Full release matrix | Resource/abuse/soak, active-phase crash, full-disk and supported backup/restore/rollback cases retain their existing gaps. |

[Packaged reliability](packaged-reliability.md) distinguishes observed failures,
reproductions and accepted fixes. [Image delivery](rewrite-image-delivery.md)
records immutable transport and publication identities. Current native/browser
passes establish their concrete flows, not long-duration guard stability.

Raw/live stderr replay remains unsupported; sanitized final history is implemented.
UI redesign and additional engines remain outside this qualification packet.

The [finite goal audit](goal-qualification.md) records completed scope. Remaining
full-release matrix items above retain their independent acceptance requirements.

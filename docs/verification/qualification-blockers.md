# Remaining qualification blockers

These block rewrite release acceptance; implementation or a later passing run does
not close them. Scope follows [remaining packets](../execution/remaining-rewrite.md).

| Blocker | Evidence and next required proof |
| --- | --- |
| Output-guard reliability at shipped control caps | An unmodified 9c326f4 Compose run stopped in prepare with `artifact_incomplete`; exit 137 / OOM false. Public run was cancelled/inconclusive. Capture the exact stop branch, last-known age, scan reason/duration and event-loop/throttling evidence under the same caps; resolve and qualify before release. |
| Actual packaged browser | Browser control tool was unavailable in this session. No DOM/component or HTTP check substitutes for real browser keyboard/themes/viewports, lifecycle and cross-scope acceptance. |
| Hosted native matrix | Both native architectures are configured; only local Linux/arm64 functional execution has been recorded for the current candidate. Hosted/native amd64 execution is unverified. |
| Delivery and supply chain | Current images remain local. Scans, SBOM/license evidence, immutable matched pull references, anonymous access and authorised rewrite publication remain open. |
| Full release matrix | Resource/abuse/soak, active-phase crash, full-disk and supported backup/restore/rollback cases retain their existing gaps. |

The guard failure remains unexplained. Retained agent/backend records establish
the initiating coarse stop reason and timings, not the particular scanner/clock/
freshness branch. Independent review found no demonstrated interface defect.
A diagnostic copy preserving all predicates later recorded seven known scans
(about 2–46 ms) and one successful iteration. An untouched full stack subsequently
passed in 49.039 s. Those observations do not establish sufficiency of the 250-millicore
agent cap or erase the earlier failure. Do not increase guard deadlines or claim
stability from a single green run.

[Candidate image evidence](candidate-image-ci.md) records the narrower accepted
functional behavior. Raw/live stderr replay is unsupported; sanitized final
history is the implemented diagnostic feature. UI redesign and additional engines
remain outside this functional/release qualification packet.

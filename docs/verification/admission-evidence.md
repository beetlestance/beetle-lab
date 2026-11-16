# Admission evidence and backend observation merge

Status: implemented local boundaries; durable application dispatch remains pending.
Reviewed sources: agent `44d7819a16b142f54c3083c506bc64442658cba8` and
backend `eb6b5109ef08544ebfa77a7f9a51247100229aad`.
Integrated verification source: `da10e1749b5300a509a7514a5ae666be656d17b6`.

## Behavior

Journal snapshots expose compact independently durable queued/charged/rejected/
released admission facts. Reads bound native queue/reservation payloads before
parsing, check scope/generation/cross-row consistency and reuse existing release
owner predicates. Ordinary get/list/cancel reads do not load Offer/config blobs.
Missing tracked facts and corrupt tracked facts are distinct: malformed proof fails
rather than inventing release or silently becoming unknown. Existing event sequence,
ACK ownership and first public exit evidence remain unchanged.

The backend pure merge captures bounded private copies before field access, binds
original identity/generation1 and nested result identity, and validates cursor order.
It preserves immutable witnesses and sticky stop/terminal facts across reversed
replies. Cancellation, pruning and admission merge independently of event sequence.
Final admission facts select finalizing; no passed result, event ACK or durable
capacity-release mutation follows from this pure function.

## Evidence

Independent exact-source reviews found no blocking findings. The release review
records reliance on the immutable journal producer and trusted supervisor settlement;
compact projection does not authenticate coherent arbitrary database tampering.

Agent final focused run: 241 tests/22 files passed in 69.97s, including actual installed
loopback HTTP, reopen/replay, cancellation, guarded release, bounded corruption and
private redaction. Earlier fixture/instrumentation failures and a non-final-source
regression run remain recorded; they are not reported as passing final evidence.
Backend merge: 61 tests/2 files passed in 1.07s, covering identity, chronology,
conflicting facts, optional witness presence, cursor bounds and immutable custody.

The integrated `NODE_OPTIONS=--max-old-space-size=1024 npm run verify:v2` exited 0:
3,649 tests/342 files in 431.72s, runner/API/k6 generation checks 43/35/6, all three type
targets, lint, architecture 1,051 sources, docs 169 pages and frontend build passed.
The existing 609.69kB frontend chunk warning remains. Loopback permission was enabled.

Updated Node24 target agent bundles built successfully. The executable smoke passed
private config, Unix transport, authenticated capabilities, invalid credential
rejection and SIGTERM drainage using a synthetic daemon. That smoke does not execute
a load test or qualify admission proof through a real Docker runtime.

## Limits and next work

Host evidence is Node26.7/macOS arm64 with synthetic local fixtures. No updated
native Docker/Compose, amd64, supply-chain, resource or soak qualification is claimed.
Durable claims/possible-delivery, matched ACK/projection and logical-charge release,
cancellation/events and result/artifact finalization still need their transactions.
Neither component alone establishes the rewritten end-to-end execution path.

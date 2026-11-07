# Admission contract

`index.ts` exposes policy/types; `Journal.admission` owns production persistence.
One worker transaction re-reads settings/observations, 100 projected candidates and
64 charged reservations globally; reservation/event/state commit atomically using
supervisor sourceOrdinal. Quota/ordinal/SQL faults roll back; pending=1024, pages=100.
FIFO permits small-job bypass for 30s, then drains for the oldest feasible job;
unknown legacy age promotes immediately after revalidation. Cancel atomically
retires pending metadata and blocks first create/start grants; existing replay is
dispatchAllowed:false. Binding already-created ownership remains possible after cancel.

Explicit config owns pool, per-run/time ceilings, manifest minimum including timeout,
reserve/headroom, approved identities and finite observation TTL. Timeout never sums
across attempts. Lower pools drain without changing accepted jobs. Physical free disk
must cover charged output+staging plus reserve/headroom; release never proves deletion.
`estimateStaging` pins complete setup charges/policy per reservation before I/O;
unknown policy rejects new admission. See ../../../../docs/decisions/006-agent-staging.md.
Profiles require cpu/memory/pids/timeout/output. Docker cannot supply timeout/output:
fresh supervisor guard assertions are mandatory. Output is a bounded-writer/stop
guard, not a filesystem quota; required `hard-output-quota` is unsupported.
No host capacities or sensor readings are inferred; unknown/stale stays unknown.
Trusted composition runs bounded installed-schema/metadata preflight BEFORE offer,
pinning config SHA256/schema/catalog; engine semantic checks run after admission.
Hashes are identity, not validation; `immutableOffer` is compatibility only.
Private evidence/ownership commands never reach browser/wrapper transports.
Source strings are provenance, not authentication or proof of Docker observations.

Claim create BEFORE backend create; bind exact token/spec/runtime; claim start(now)
BEFORE backend start. Sole start claim persists epoch1/token/time; replay never grants.
`settleLaunch` binds current epoch/token and exact ownership. Known completed means
definitive backend dispatch finished; retired means dispatch was never sent. Both
assert ALL current create/start actions quiesced and dispatch capability irrevocably
retired; trusted composition must establish this, not infer it from stopped samples.
Unknown remains charged and may advance to a strictly later definitive settlement.
Known settlement is immutable/idempotent; late unknown/stale identity cannot replace it.
Settlement closes future start claims, including epoch0 before any start. Release
references the persisted definitive settlement and requires stopped/absent runtime
AND finished/failed collection samples strictly AFTER settlement (ties reject).
Missing ID/uncertain action, ACK, wrapper events or timeout never authorize release.
Abort before any create claim releases and permanently fences dispatch. No deletion.

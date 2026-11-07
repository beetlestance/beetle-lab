# Admission contract

`index.ts` exposes policy/types; `Journal.admission` owns production persistence.
One worker transaction re-reads settings, observations, 100 pending candidates and
64 charged reservations across organisations; reservation, admitted event and state
commit atomically using supervisor sourceOrdinal. Quota/ordinal/SQL faults roll back.

Explicit configuration owns pool, per-run/time ceilings, reserve/headroom,
concurrency, approved manifest/profile/schema/catalog identities and observation TTL.
No capacities, controls or sensor readings are inferred. Physical free disk must
cover charged output+staging plus disk reserve/headroom; release does not prove
physical deletion. Lower pools drain without changing accepted jobs.
Pending cap=1024; charged cap=64; candidate scan=100; pages=100.
FIFO allows small jobs past blocked predecessors for 30s, then drains for the oldest
feasible predecessor. Unknown legacy age promotes immediately after revalidation.
Rejected/cancelled candidates leave pending durably. Profiles require cpu/memory/
pids/timeout/output; Docker controls cannot supply timeout/output. Those require
fresh trusted supervisor guard assertions; missing/stale guards reject admission.
Output means a bounded-writer/stop guard, not a filesystem quota; required
`hard-output-quota` is unsupported. Observation/guard commands stay private.

Trusted composition must run the installed config validator BEFORE the private
offer command, pinning canonical config SHA256 and approved schema/catalog identity.
Matching hashes establish identity, not semantic validation. Journal checks them
against the current approved catalog. `immutableOffer` remains an identity
compatibility API; production acceptance must use the admission offer command.

Only trusted supervisor composition may call ownership/evidence commands; never
expose them to wrapper/browser transports. Source strings cannot authenticate
callers. Stored evidence is a supervisor assertion, not a Docker observation.
Claim create BEFORE backend create, bind exact token/spec/runtime, then claim start
BEFORE backend start. Only the first claim returns dispatchAllowed=true; replay
after unknown outcomes/restart returns false. Never retry test execution.
Unstarted abort releases and permanently fences dispatch only BEFORE create claim.
A missing ID after uncertain create cannot release; reconcile exact runtime first.
Unknown runtimes stay charged. Release needs matching ownership, supervisor
stopped/absent evidence AND finished/explicit failed collection. ACK, wrapper
events and timeout alone never release; no artifacts are deleted here.

Checks: `npx --no-install vitest run agent/test/admission agent/test/journal --maxWorkers=2`.

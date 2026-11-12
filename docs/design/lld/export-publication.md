# Public export job publication

Status: implementation contract; extends standalone-export-jobs.md.
Metadata migration015 owns these rows; agent Journal015 is a separate DB.

## Ownership

Export intent/outbox/allocation/source/publication records are separate from Runs.
Do not create a synthetic Run or put an export UUID into an EventBinding.runId.
Reserve3MiB bounded metadata per job and payload maximum before delivery.
Capture revision/config/input pins, settings versions, installed export profile and
complete assignment in one receipt-first transaction. Exact replay precedes current
eligibility; cancellation is monotonic and cannot erase uncertain delivery.

Use a closed purpose-tagged export output binding with exportId, original attempt
and Journal authority. Existing Run bindings and native identity preimages remain
unchanged. Export file identities use a separate domain/namespace. One byte-store
and transfer owner serve both kinds, through a metadata facade routing to the
persisted owner. The common transfer loop does no job-state projection.
Codec selection follows captured durable purpose and never falls back after a
validation failure. Each export manifest/result must bind its complete assignment.

## Resource and lifetime requirements

Run/export queue limits, charged CPU/memory/PID/staging and output/input storage
usage share installation accounting. Reserve output before possible delivery.
Unknown delivery, source, writer or native close retains its original and credit.
Published export bytes and retired agent staging are separate obligations.

Generation completion requires exact native source/closure, actual physical stop
and verified published file receipts. A backend file publication/absence does not
prove agent producer/source retirement or authorize its refund. Input pins remain
held until exact producer retirement, including unknown jobs and cancelled jobs.
No browser path, clock timeout or current capability creates physical authority.

## Public surface and proof

Scoped revision export submit, job read/list/cancel and script download use the
same authenticated session policy as current authoring. Expose generation states
and fixed failures without inventing a performance verdict. Invalid generation
limits that cannot fit the output budget are rejected before mutation. Functional controls
precede the separately deferred UI redesign. Automatic reconciliation resumes the
same original after restart; no replacement attempt or backend-local compiler.

Prove receipt-first replay, scope isolation, shared resource contention, pin/delete
races, lost replies, cancellation, native writer ownership/close, exact source
binding, restart and verified public download. Pending/unknown is observable and
remains charged. Public route capability is advertised only when its installed
export profile and full lifecycle are actually available.

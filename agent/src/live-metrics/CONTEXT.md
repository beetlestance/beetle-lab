# Advisory live mailbox reader
Public LiveMetricReader; construction requires a trusted compile/launch approval
(scope, producer UUID, exact subset). Never learn approval from a received frame.
The read port resolves only after actual request/response close. Reader retains
one original through cancel/close; close fences synchronously. No retry/queue.
Hard5s budget covers preflight/read/decode/final return. Shared mailbox and frame
codecs enforce extent/hash/shape/size/identity; revision equals publishedSequence.
Expected scope/epoch/subset are mandatory. Capture/source/published age<=6s; no future timestamp.
Scalar revision/source/end/time/coalescing/digest state fences regressions and
altered repeats/overlapping windows. Unchanged polling keeps the original producer timestamp; no age
refresh; a monotonic expiry also protects against a frozen wall clock. No metric corpus or subscriber registry. One reader per retained owner.
This component is not an authenticated route or runtime enablement. The trusted
compile-owned approval and producer configuration handoff must be wired first;
an approved image/digest alone does not authorize a self-declared subset/epoch.
Checks: agent/test/live-metrics; Node types and changed lint.

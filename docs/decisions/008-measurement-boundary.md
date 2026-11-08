# Native measurement boundary and build ownership

Status: selected Docker-only first-release behavior; wrapper composition pending.

The owned runtime emits `beetle_measure_started` as an untagged counter sample of
value 1 after successful readiness and a final deadline check. Readiness-disabled
runs emit the same marker. The setup runtime instance consumes prepare once;
failure cannot be retried by calling it again. Normal VU instances receive the
validated setup deadline and do not perform readiness themselves.

The marker is internal control evidence, excluded from user SLO/discovery rules.
The wrapper must validate approved name/kind, untagged value 1, valid timestamp
and one occurrence before accepting complete measurement evidence. Missing,
duplicate or malformed markers prevent complete execution evidence. Summary
absence is unknown, never a zero count or implicit readiness success.

k6 buffers metric delivery. The wrapper records execute `phase.started` only when
it observes the marker; this is retrospective observation, not a durable handshake
before target load. Event observedAt is wrapper receipt time. Keep the source
sample time separately in bounded correlation evidence for measurement charts.
Do not subtract that transport delay from a shared-process resource measurement
or pretend that a received heartbeat establishes useful progress. No additional
native control API or target request is introduced.

All build work remains inside the admitted engine container. A separate builder
worker is not mandatory: the independent agent can terminate the whole container.
The wrapper fences launch/publication before and after build and retains the
original build promise through cleanup. A timeout/cancel may settle its public
result earlier but cannot establish build quiescence. Never remove, collect or
seal files while build work remains outstanding, or launch from late success.
Unknown build work remains charged until the agent confirms container termination.
A Promise race does not stop a compiler, bundler process or filesystem operation.

Outcome/summary validation, aggregate output accounting and canonical sealing
remain required. Actual Linux whole-container termination, native metric ordering,
source timestamp handling and buffering behavior still need qualification.

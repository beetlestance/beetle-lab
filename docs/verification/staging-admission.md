# Shared staging admission view

Status: implemented boundary; actual durable delivery remains pending.
Source: `4c77944b96949ddaa164382a29d7b2f488e97c4c`.

## Behavior

The contracts package owns the policy1 staging estimator and prescribed Offer
serializer. Agent admission re-exports the same functions. Source comparison
confirms the prior implementation is unchanged apart from import relocation:
serialized Offer bytes, inputs, secret allowances and fixed manifest/metadata
charges retain the same overflow checks and persisted policy compatibility.

The backend's private runtime observation now retains the agent's total and
per-run staging limits, separately from backend storage allocation and free-space
refusal. Both come from the same validated capability frame and original lease as
display ceilings. Parent and worker boundaries require the closed positive safe
integer pair, with per-run <= total and total <= floor(MAX_SAFE_INTEGER/256).
The complete cache accessor and display projection share expiry/revocation checks;
retained facts are copied and deeply frozen. No wire/API schema or migration changes.

## Evidence

An independent exact-source review found no blocking correctness findings.
Source review does not establish native execution or resource qualification.

The focused contract/staging/capacity/cache/publication/bootstrap command passed
549 tests in37 files (26.69s). The full `verify:v2` run passed runner/API/k6 output
checks (41/35/6), all three type targets, lint, architecture (1033 files), docs
(165 pages) and frontend build. The existing609.69kB frontend chunk warning remains.

The full test stage passed3457 tests and failed57 across9 files; every reported
failure was `listen EPERM` from sandbox-denied loopback sockets. A minimal socket
probe reproduced that denial; the elevated probe succeeded. Only those9 files
were rerun at the identical source with loopback permission: 61 tests passed in17.93s (exit0).
Assertions, deadlines and gates were unchanged. These combined runs cover all3514
tests; the original `verify:v2` invocation still exited1 and is retained as failed
environment evidence, not reported as a single green invocation.

## Limits and next boundary

Evidence is local macOS/arm64, Node26.7, with Node24 build targets. There is no new
Docker/Compose, native amd64, real workload, resource, supply-chain or soak proof.
This preparation does not deliver Offers or finalize runs. Persisted logical
charges, possible-delivery recovery, matched acknowledgments, cancellation,
event ingestion and result/artifact finalization remain separate work.

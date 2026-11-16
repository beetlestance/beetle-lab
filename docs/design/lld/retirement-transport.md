# Authenticated output retirement transport

Status: runner endpoint implemented; backend ACK and settlement remain separate.
Parents: [wire values](retirement-wire.md), [pipeline](retirement-pipeline.md),
[output retirement](output-retirement.md). Owner: agent/transport.

POST /runner/v1/attempts/{attemptId}/output-retirement accepts the closed <=3072-byte
OutputRetirementRequest. Existing Bearer authentication, scoped organisation/workspace/
generation headers, expected physical Journal authority and path/body binding apply.
Body journalAuthority must exactly equal the current physical authority. No public
backend route, alternate path, raw native receipt or bypass credential is introduced.

Before body intake, the request reserves one of the existing two shared source-work
slots and starts the fixed 30-second operation deadline. Connection: close applies.
The route calls the actual Root-owned retirement pipeline with this same budget and
waits for both result and settled. Neither disconnect nor deadline releases the
original: service settlement and actual request/response/socket closure are required.
Root supplies the real pipeline; isolated configurations without it return scoped503.

Pending and cleaned both return200 with closed <=4096-byte JSON. Pending means one
bounded batch completed, not acceptance or cleanup ACK. Cleaned comes only from the
trusted native pipeline, including fresh native qualification on replay. The handler
captures the exact request-bound reply again before bounded serialization. Malformed
producer replies fail500; invalid input400, conflict409, capacity429 and unavailable
execution503. Generic protocol errors expose no native paths or internal failures.

The generated retireOutput client enforces request/reply byte limits and schema shape.
It does not authenticate a receipt or grant refund authority. Future backend consumers
must perform exact-request semantic capture before immutable ACK storage. No background
poller, backend ACK, hold release, tombstone or user deletion control belongs here.

Acceptance: real task-owned TCP with actual Journal/native pipeline, cleaned replay,
pending convergence, auth/scope/authority/path/generation/closed-body/size refusals,
disconnect during held native IO and server close, exact client request and fixed
reply bounds. Synthetic Docker seams do not establish compiled Docker cleanup.

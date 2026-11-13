# Retirement reply wire evidence

Status: C4a metadata values locally verified; no route, authentication, ACK or refund.
[Contract](../design/lld/retirement-wire.md). Base505d2ef. Shared request hashing stays
unchanged; no runner operation/availability descriptor is added by this schema.

OutputRetirementReply is a closed pending/cleaned union bounded4096 UTF-8 bytes.
Capture precedes parse/clone, then validates shipped schema, exact original/Journal/
Run/deletion identity and the COMPLETE expected canonical request digest. Original
spelling is preserved. Pending rejects all closure fields; cleaned carries opaque
namespace/C1 taskNamespaceIdentity/receipt digest only. A valid fixture is not IO proof.
Independent implementation review found no blocking findings and did not repeat tests.

| Check | Actual result |
| --- | --- |
| Focused request/reply | 42tests/2files passed,1.19s |
| All contracts | 757tests passed,30.92s |
| Generated drift | Exit0,.35s |
| Node/web/k6 types | Exit0,17.86s |
| Lint/architecture/docs | Exit0;7.88s/7.26s/.58s |
| Browser build/static validator composition | Exit0,1.47s |

Host Node26.7.0/darwin arm64, functional Vitest one-file worker. Full command/input/
exit/timing logs remain private. Four fixed valid source/absence pending/cleaned
fixtures and two invalid pending-closure/path fixtures are shipped. Independent
Python canonical SHA256 request vectors agree with the shared injected Node hasher.
Tests cover all identity crossings, closure/final-end mutation, exact case, invalid
versions/purpose/state/digests, unknown authority claims, hostile accessors/oversize
input and invalid hasher output. No shared runtime Node crypto dependency was added.

Generated declarations/schemas/reference/manifest match their source. Browser build
keeps its existing chunk-size advisories; gates were not changed. Schema validity
never establishes current native absence or refund authority. The subsequent C4
pipeline/endpoint must construct cleaned ONLY through trusted native finalization,
including replay, and bind the existing authenticated expected-authority transport.

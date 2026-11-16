# Backend source adoption evidence

Status: locally verified payload storage and source-adoption metadata. This does
not establish a connected artifact transfer, terminal run, browser or release image.

## Accepted source

- Application008 payload carrier: `14f2ac8`, corrected by `597a75e`.
- Application009 source adoption/worker RPC: `4a0e8ad`.
- The owning contracts are [payload storage](../design/lld/output-payload.md) and
  [source adoption](../design/lld/output-adoption-store.md).

The payload implementation has42 focused selected cases covering result-free
headers, independent observed-result markers, unchanged snapshot merge semantics,
result-to-manifest single-row replacement, combined event/body/artifact allowance,
raw native guards and atomic migration preservation/rollback. Padded or ambiguous
old headers refuse intact. Changed-file lint and NodeTS passed (final7.84s).

Independent review found a concrete duplicate-key quota bypass: SQLite selected a
first artifact array while JavaScript selected the last valid sealed result. Five
attacks reproduced it. Whole-tree duplicate rejection now follows native text/byte/
JSON-validity gates before parsing, including every old migration snapshot.
Eleven new cases passed3.12s; the retained NULL-authority control passed1.14s and
changed lint0.56s. Earlier42-case evidence was reused. Review closed the blocker
without repeating the suites or changing historical ownership/release guards.

The adoption store matches the retained original Offer engine/installed identity,
namespace/intent/generation and physical Journal. It uses the shared source/result
validator and single manifest carrier, bounded compact closure/artifact slots,
native token uniqueness and an immutable event ceiling. Equal replay preserves
source identity, upload tokens and versions; collisions roll back atomically.
Discovery uses indexed fixed-upper pages, including released/unbound originals.
Parent and worker enforce bounds and share the existing two-large-original lane.

Actual compiled metadata-worker evidence discards a post-COMMIT response, terminates
the worker, then reopens and replays the same original with unchanged tokens. This
proves durable replay; it does not claim a kill at an instrumented COMMIT instruction.
Focused cases also cover malformed/unsafe closure fields, exact/short combined
allowance, result observation order, wrong original pins, queue credits and reply
bounds. Final affected NodeTS passed7.32s; changed-file lint passed.

Independent adoption review inspected21 changed paths and32 input hashes, accepted
the prerequisite and reused the actual worker evidence. Contradictory events above
the adopted end are refused without ACK. Existing event error mapping can fence
Metadata for that protocol contradiction; nonfatal ingress resilience remains a
separate improvement, with no ceiling relaxation.

## Integrated scope

After combining source storage and the native byte adapter, ten affected latest-
schema fixtures passed (seven in9.02s, three in2.76s); changed lint passed0.56s.
Historical rollback versions stay unchanged; current initialization expects9 and
the future-schema fence10. Architecture checks covered1447 files in3.89s; the
combined Node TypeScript project passed7.25s. No full v2 suite, container build,
image scan or architecture qualification was repeated for this batch.

Artifact writer/progress authority, connected source-to-file transfer, terminal
settlement/result routes, source-free closure, publication ACK/deletion and
retention remain required. Metadata adoption alone authorizes none of those.

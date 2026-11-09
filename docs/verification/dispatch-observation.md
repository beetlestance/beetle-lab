# Durable matched observation transaction

Status: implemented private SQLite class; metadata-worker transport and executable
dispatch wiring remain pending. Reviewed source:
`32bc203e369c81abcf4c9d29005eab73f0b15344`.
Integrated source: `2afb68618cebd79de00ee3aaaf5358ccabd57049`.

## Behavior

DispatchObservations captures a closed bounded request and immutable original key,
binds retained execution/attempt/Run custody, and invokes the existing pure snapshot
merge. SQL bounds stored snapshot text before returning it to JavaScript. It reads
no Offer, registry or historical config payloads.

One immediate transaction stores the merged snapshot and delivery acknowledgment,
detaches custody while the original possible-delivery outbox exists, records attempt
generation/state, deletes the outbox and updates public Run projection. Invalid or
conflicting evidence, version exhaustion, late storage failure and reply-serialization
failure roll everything back. Exact replay does not advance the public version.

Only matched final admission evidence releases execution capacity. Output allocation
and shared usage remain unchanged. Cancellation combines local intent with remote
facts for nonterminal Runs; terminal public DTOs/version remain unchanged while
private evidence may advance. Snapshot cursor/result/exit never grants event ACK,
finished outcome or passed validation.

Settings.capacity exposes current immutable installation policy and the original
cached runtime observation reference. It preserves expiry and revocation without
sampling or resolving accepted defaults. The future claim must still recheck that
original lease before commit.

## Evidence and limits

Independent transaction and capacity-facade source reviews found no blockers.
Worker observation tests passed 57 cases/two files; the initial unsent fixture failed
because existing deferred foreign keys correctly refused its setup. The corrected
fixture preserves guards. Root corrected three test-call formatting violations;
42 affected cases then passed. No assertion, deadline or budget was relaxed.

Integrated single-worker focused checks passed 146 tests/nine files in 12.10s,
covering observation, pure merge, schema foundation and capacity/runtime boundaries.
Node TypeScript, lint, architecture 1,071 sources and diff checks exited 0.
The preceding full gate and compiled smokes are recorded in
[execution storage](execution-storage.md); they are evidence for that older source.

Local evidence is Node26.7/macOS arm64 with synthetic SQLite fixtures. Source review
and scoped tests do not prove worker original-credit handling, actual delivery,
process crash recovery, result/artifact finalization or native Docker/resource
qualification. scan/readOffer/claim, metadata transport and the dispatcher loop remain.

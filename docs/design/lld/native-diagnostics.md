# Sanitized native diagnostic history

Scope: F07/F11 safe final diagnostic history, separate from lifecycle-event replay
and [warning guidance](../../verification/k6-warning-guidance.md). Original stderr
replay and live native diagnostic streaming remain unsupported.

## Secret boundary

k6 JSON stderr can contain URLs, response data, secret values and arbitrary messages.
No string replacement rule can prove those are safe. Persist only ordered fixed enum
records: sequence, normalized severity and diagnostic code. Known warning patterns
map to fixed insufficient-VU/cardinality/duration labels. Other valid diagnostics
become a fixed redacted record. Unknown severity, malformed JSON/UTF8, oversized or
unterminated segments become fixed invalid records. No native msg, extra fields,
URL, timestamp, file path or parser error enters the artifact or UI.

The existing WarningClassifier owns the one4096-byte transient line buffer and
warning projection; DiagnosticHistory retains safe enum records only. No second
parser, raw spool, per-function telemetry or unbounded final materialization.
Native stderr transport ceiling remains65536 bytes. At most256 ordered records
are retained, then capture drains/counts without retaining later records.

## Evidence semantics

NativeDiagnosticArtifact version1 binds org/workspace/attempt/generation1 and has
observedBytes, observedRecords, invalidSegments, redactedRecords, droppedRecords,
records and complete/partial coverage. Observed bytes include all admitted parser
chunks; record/segment counters describe parser units, not unique incidents.
An oversized line/chunk or unterminated tail counts as an invalid segment; malformed
segment counts do not imply a recoverable original-line count. Known records omit
all native dynamic details too. RedactedRecords counts unknown valid messages.

The retained list is exactly the first min(observedRecords,256) sequential records.
DroppedRecords is the remainder. Invalid/redacted totals include dropped records.
Complete means EOF with no invalid segments, overflow or interruption; it does not
mean raw messages were preserved or that the test passed. Interruption is sticky.
Unknown/absent process evidence never becomes an empty complete history. Projection
requires spawned/drained evidence, matches byte counters and downgrades partial
native collection/cause. Existing execution/quiescence owners still govern publish.

Capture detaches/freezes data, validates shape/counters/code/severity and enforces
the actual serialized32768-byte limit including envelope/newline. Fixed enums and
256-record cap fit within that reservation, including worst-case counter digits.

## Publication and display

Reserve32KiB before execution from the existing1MiB numeric/warning partition:
numeric1011712 + warnings4096 + diagnostics32768. Minimum admitted output, build,
history/control/result reservations remain unchanged. Collection reserves both
artifacts and deducts produced bytes once before numeric allowance. No raw files
are produced during execution. Partial native capture is not numeric-pass evidence.

The existing descriptor custodian seals k6-diagnostics.json, kind k6-diagnostics,
with stable owned native files, exact bytes/hash, closes and final root checks.
Ordinary source publication/transfer, retention, deletion and backup treat it as
one immutable artifact; no new storage table, budget bypass or lifetime owner.
Download uses a fixed UUID JSON filename.

The result panel reports absent/ambiguous evidence and offers an explicit viewer.
Reads use existing bounded artifact EOF/SHA verification, then bind payload scope
and attempt. Close, selection/session departure and timeout retire the display;
original I/O credits remain with the shared reader. Retry is explicit. Show capture,
redaction, invalid and overflow counters; render only fixed labels as plain text.

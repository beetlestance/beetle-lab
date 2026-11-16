# Private control checkpoint contract

Pure agent-internal DTOs/copies, shared by reader and journal; no engine imports.
Scope text is exact; UUIDs remain verbatim. Cursor identity uses canonical unsigned
64-bit decimal strings, never lossy numbers. File64MiB/65536frames; LF frame64KiB.
Agent enrichment has an additional512bytes; public batches remain256KiB.
One batch1..100events, complete encoded request<=256KiB, scoped contiguous sequences.
Next cursor grows; same identity; no caller-controlled digest of the current batch.
Journal owns canonical SHA256 of {key,expected,next,events} and commits its returned
checkpoint with events/projections/charges. Identical ambiguous replay survives
pruning; changed replay/CAS conflicts. Reader accepts only its pending cursor and
adopts the journal's complete checkpoint after confirmed commit.
copy APIs snapshot/bound/validate/freeze input before asynchronous effects.
Cursor is a reader assertion; these types do not prove bytes, custody, authenticity,
execution quiescence, reservation release or application finalization.
Live intake is provisional. Reader must verify prefix on restart and stopped final
collection over bounded passes; incremental polling cannot detect every overwrite.

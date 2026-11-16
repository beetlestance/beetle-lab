# Sanitized native diagnostic evidence

Public entry index.ts: schema capture/decode, fixed product labels, shared caps.
NativeDiagnosticArtifact contains only scoped identity, safe ordered enum records
and counters. No msg, native timestamp, URL, dynamic key/value or parser exception.
256 retained records,32KiB including envelope/newline. Capture detaches and freezes;
validates contiguous first prefix, counts, severity/code and coverage consistency.
Complete capture is distinct from disclosure: redacted valid records can be complete.
Overflow/invalid/interrupted capture is partial. Empty evidence requires actual EOF.
Checks: contracts/test/k6-diagnostics.test.ts and generated contract drift.

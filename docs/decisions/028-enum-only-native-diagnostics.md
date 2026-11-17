# Decision 028: Enum-only native diagnostic history

Status: accepted. Recorded on 17 November 2026 from the design the code
implements; the choice predates this record.

## Decision

The k6 diagnostics artifact keeps only ordered fixed records: sequence, normalised
severity and a diagnostic code. Known warning patterns map to fixed labels; any
other valid message becomes a fixed redacted record; malformed, oversized or
unterminated input becomes a fixed invalid record. No native message text, URL,
timestamp, file path or parser error is persisted or shown. At most 256 records
are retained within 32768 bytes; later records are only counted.

## Why

k6 JSON stderr can carry URLs, response bodies, secret values and arbitrary
messages. No replacement rule can prove a free-text line is safe, and the artifact
outlives the run in backups, downloads and the UI. Fixed enums make the stored
artifact safe by construction and give a fixed worst-case size that fits a
reservation taken before execution.

## Alternatives

- Persist raw stderr: rejected. It leaks secrets into durable storage and backups.
- Regex or allow-list redaction of message text: rejected. Redaction cannot prove
  completeness against arbitrary dynamic content.
- Stream live native diagnostics to the browser: rejected. Same disclosure risk,
  plus an unbounded transport.
- Store unlimited records: rejected. The artifact must fit a fixed slice of the
  1 MiB output partition reserved before launch.

## Consequences

Operators see counts and categories, not original wording; investigating an unknown
message needs a reproduction outside the product. `complete` means capture reached
EOF without overflow or invalid segments, not that messages were preserved or the
test passed.

## Review triggers

Revisit if a verifiably safe structured diagnostic channel replaces free-text
stderr in the engine.

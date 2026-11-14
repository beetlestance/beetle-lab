# Offline recovery composition

Owner: cold backup, fresh historical restoration and its read-only viewer.
Contract: docs/design/lld/cold-recovery.md and ADR016. CLI is packaged with the
installer, with matching metadata/agent workers. Normal installation stays Compose.

Source and destination operations are explicit, bounded and private. Never start,
stop or adopt user services; never overwrite an installation or turn historical
purpose into ready. `RecoveryIO` retains original native calls/failed closes.
`database-custody` pins each writable SQLite destination across both checked opens;
its supported-Node synchronous-open dependency must remain source-qualified.
`tree` charges discovered pending siblings before descending. `manifest` verifies
actual EOF. `restore` publishes only operation-owned copies; `attestation` is a
separate history domain. `viewer` has read-only ports and no execution authority.

Use synthetic directories/containers, scoped tests and one composed native lane.
Record failures; no broad resets, permission repair or hidden cleanup retries.

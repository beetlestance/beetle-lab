# Execution output payload storage

One retained carrier contains a provisional result or its later immutable public
manifest. Snapshot headers are result-free and use the fixed metadata allowance;
result_observed records what the snapshot actually observed, independently of a
manifest arriving first. The original domain merge receives reconstructed snapshots.

Carrier and retained event bytes share the existing output payload reservation.
Manifest artifact sizes also reserve that payload; no second installation counter
or refund is introduced. Native guards retain identities, monotonic presence,
immutable result/manifest transitions and combined integer-safe bounds.

Migration008 preflights bounded original rows, converts without a second durable
body and preserves historical authority/admission/release guards. Unknown physical
bindings requiring conversion fail intact. Header/payload SELECTs bound returned
text in SQLite before parsing. This is storage only: no authenticated source
adoption, artifact files, terminal settlement, publication or deletion port.

Contract: docs/design/lld/output-payload.md.
Focused checks: app/test/storage/output-payload*.test.ts; affected Node TypeScript.

# Engine native artifact custody

Public entry index.ts. Owner docs/system/contracts/exports.md.
Artifacts owns fixed-name summary/numeric/target/report/diagnostic/native-script descriptors;
Identity helpers, bounded hashing and AppendFiles are shared by metric and target
archives. AppendFiles accepts only fixed metrics (data/index) or target (data)
profiles, never caller-supplied relative paths; the caller owns serialization and
byte reservation before writes. Advisory append does not sync per sample.
No compiler, metrics interpreter, target calls, job admission or metadata here.

One 64 KiB hash scratch buffer, positional progress<=ceil(bytes/64 KiB)+32+EOF;
caller limit<=256 MiB, script limit 64 MiB. Hash alone proves no file/root custody.
Strict canonical0700 root, owned0600 regular single-link file, stable inode/length/
stat, two hashes, sync and original closes precede named file/root reconciliation.
Required cleanup drains even after publication fence stops; actual cleanup failure
is sticky. No cancellation-induced fake absence/refund or descriptor success.

sealExportScript captures trusted BuildOutput scalars, fixed parent/standalone path
and budget before async work. Result waits native closes/final outer-root identity;
settled rejects cleanup-unknown. Parent owns job fence and late publication checks.
No overwrite, removal, directory walk or speculative retry. Arbitrary foreign JS
options are not a sandbox API; production parents supply trusted synchronous fences.
Focused tests engines/k6/test/artifact-custody plus attempt/artifacts and metric-archive.

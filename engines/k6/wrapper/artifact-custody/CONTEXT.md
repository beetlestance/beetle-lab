# Engine native artifact custody

Public entry index.ts. Owner docs/design/lld/export-script-custody.md.
Artifacts owns fixed-name summary/numeric/target/report/native-script descriptors;
identity helpers and bounded hash reader are shared with the metric archive.
No compiler, metrics interpreter, target calls, job admission or metadata here.

One64KiB hash scratch buffer, positional progress<=ceil(bytes/64KiB)+32+EOF;
caller limit<=256MiB, script limit64MiB. Hash alone proves no file/root custody.
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

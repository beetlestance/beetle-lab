# Standalone export protocol values

Public entry: index.ts, reexported by @beetle/contracts.
Owner: docs/design/lld/standalone-export-jobs.md. Assignment/result schemas live in
runner/v1; generated wire types are never handwritten or interpreted as performance.

Distinct purpose/envelope wraps existing Offer; current performance intake rejects
it. Require dedicated capability, k6/config1 and explicit empty secret declarations.
Script timeout differs from whole-job build timeout. Build peak+8KiB result+64KiB
control stays inside original output reservation. Hashes prove no admission/custody.

Assignment snapshot<=Offer+8KiB, nested Offer/config independently revalidated.
Exact domain prefix/canonical digest binds every field except digest self-reference.
Result<=8KiB, separate seal prefix, generation status and exactly one portable file
on success; failed/cancelled carries no artifact or performance outcome.
Use captureStandaloneExportResult for full assignment/usage/file/time binding;
verifyStandaloneExportResultSeal alone proves structural integrity only.
Finite timestamps precede ordering. Unknown work has no fabricated terminal result.

No IO/crypto implementation, compiler/config interpretation, secret resolution,
HTTP/routes, queues, admission, lifecycle, native publication or release is here.
The shared seal core preserves engine-result v1 golden bytes/public functions.
Tests: contracts/test/export-job and contracts/test/result-seal.test.ts.

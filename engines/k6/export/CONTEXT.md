# Standalone k6 script export

`index.ts` exposes exportStandaloneScript, startStandaloneBuild and frozen contracts.
The shared helper in builder.ts
captures scalar options before awaiting, requires a build scratch allowance and
uses the runtime attempt validator for a standalone timeout. Input suite is the
actual owned/frozen compiler output; this is not arbitrary JSON/foreign-JS intake.
Declared secrets, including unused references, return unsupported_secrets before
builder/file effects. No secret file/environment resolution or partial export.

Exactly one buildRuntimeScript call owns native options/entrypoints, embedded input
content, bounded serialization/esbuild/output and cleanup. It returns only frozen
scriptPath/bytes/peakBytes; no full script in JSON. maximumBuildBytes includes
simultaneous scratch and output, not process memory or a physical disk quota.
The caller owns an exclusive fresh directory, admission and cleanup of any unknown
partial failure; this helper neither publishes output nor grants admission.
Errors have fixed invalid_input/unsupported_secrets/build_failed codes and text.

Focused checks: engines/k6/test/export/standalone.test.ts, changed-file lint and Node
types. Actual compiler/esbuild plus synthetic native adapters prove this component;
HTTP/UI/export admission/download and native k6/platform qualification remain later.

startStandaloneBuild captures a fixed monotonic deadline and AbortSignal, retains
one original helper call and uses one deadline timer. Logical stop is sticky;
result rejects promptly, while settled/close retain the original call and late
failures. Settlement alone does not prove native IO or container quiescence.
Parent owns physical stop, native script custody, output cleanup and publication.
Focused lifecycle checks: engines/k6/test/export-lifetime/lifetime.test.ts.

startExportOperation consumes an opened trusted staged session. Shared assignment
capture plus exact canonical Offer/generation1 matching precede compile effects.
It narrows the original fence, compiles once, builds once and verifies native
script custody, then closes staged input before success. Retain original work and
close errors through logical stop. Fixed errors distinguish cancel/deadline/clock.
Caller still owns admission, revision relationship and result publication.
Focused composition checks: engines/k6/test/export-operation/operation.test.ts.

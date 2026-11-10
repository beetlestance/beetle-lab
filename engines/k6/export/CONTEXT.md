# Standalone k6 script export

`index.ts` exposes exportStandaloneScript and the frozen types.ts contract. It
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

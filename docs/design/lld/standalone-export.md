# Engine-owned standalone script export

Status: frozen engine-component interface; implementation pending. Implements the
shared compiler requirement in [application/UI](application-ui.md) and F15. HTTP
admission/download, UI actions and real native execution qualification remain later
parts of the same first-release feature, not implied by this helper.

Public engine entrypoint engines/k6/export/index.ts exports exportStandaloneScript
and the types in types.ts. It accepts the actual owned/frozen compileSuite output,
caller-owned fresh outputDirectory, timeoutMs and required maximumBuildBytes.
Capture supplied scalar options before async work. Validate timeout through the
existing runtime attempt validator and byte ceiling through the existing builder;
reject malformed values before writing. This is a trusted compiled-plan boundary,
not an HTTP or arbitrary foreign-JS intake.

Use buildRuntimeScript exactly once with {mode:standalone,timeoutMs}; no copied
compiler, runtime/entrypoint template, executor mapping or dataset loader. The one
script must retain supported scenario, readiness, data/check/threshold/discovery
semantics, sharing the native runtime setup deadline. Return the builder's private
scriptPath, bytes and peakBytes; never buffer/return the whole script in JSON.
maximumBuildBytes covers simultaneous scratch as well as final output. The caller
must admit this job and own its directory/budget; this helper grants no admission.

Compiled inputs already carry embedded dataset/body content. Secret references
cannot be made self-contained by this first component: if any are declared, throw
StandaloneExportError(unsupported_secrets) before any build/file effect. Never
resolve/copy secret files or environment values, silently omit a secret, or pretend
that an absolute /beetle/secrets dependency is portable. Future separately reviewed
explicit external-secret export modes may extend that capability.

Errors use fixed codes invalid_input, unsupported_secrets or build_failed, without
raw exception/config/secret/path text. Preserve existing output and builder cleanup
behavior; task-owned fresh directories are required and partial files on unknown
failure remain the caller's retained cleanup responsibility. Do not publish them.

Evidence: use actual compileSuite and actual esbuild/runtime builder, compare
exported content/options/data with execution builder under the same standalone
attempt, cover multiple executors/discovery and embedded input data, explicit
secret refusal, malformed budgets, scratch ceiling and existing-file preservation.
Synthetic native adapters are not a real k6 qualification. No backend/artifact
pipeline dependency is necessary to implement/test this engine component.

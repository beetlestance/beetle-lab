# Native application qualification tools

These tools exercise synthetic, task-owned installations. Normal application use
is documented in the [root README](../../../README.md). Never point destructive
qualification at a user's installation or data.

| Scope | Maintained entrypoints |
| --- | --- |
| Packaged source/pull installation | [Compose fixture](compose/CONTEXT.md) |
| Native executors, requests and shared/isolated admission | [Conformance cases](conformance/cases.ts) |
| Long stream/final drain and RSS | [Conformance plan](conformance/plan.ts), [soak](soak/run.ts), [RSS](rss/run.ts) |
| Active crash/cancel/recovery | [Lifecycle execution](../resources/lifecycle/execution.ts), [active proof](../resources/lifecycle/active.ts) |
| Cold history/restart/restore | [Cold execution](cold/execute.ts), [history](cold/history.ts) |
| Resource/flood/cardinality and telemetry | Their focused directories and the workflow-selected profiles |
| Native insufficient-VU warning oracle | [smoke-warnings.ts](smoke-warnings.ts) |

The warning oracle is retained because it forces insufficient VUs and checks the
configured advice, diagnostic matching and unchanged artifact hashes after reopen.
A generic artifact-integrity check does not replace those assertions.

The old standalone live/restart smoke programs were superseded by the maintained
paths above; their original source and execution records are in
[Git history](../../../docs/evidence/README.md). Retain useful manual qualifiers even when
they have no static caller; lack of an import alone is not evidence of dead code.
Use exact source/image/config identities and normal plus independent cleanup.

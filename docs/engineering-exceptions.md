# Engineering exceptions

Every exception is narrow, reviewed and removable. A documented limitation is not
release qualification; outstanding required evidence still blocks release.

| ID | Exact scope | Owner / review | Reason and removal condition |
| --- | --- | --- | --- |
| E01 | Pinned ESLint consumers' minimatch override | Toolchain / 2026-11-07 | [Decision003](decisions/003-toolchain-glob-override.md); remove when compatible upstream dependencies replace it and checks/audit pass |
| E02 | Upstream k6 v2.2 `httpext.readResponseBody` buffering for body assertions | Engine runtime/supervisor / 2026-11-07 | [Decision005](decisions/005-native-k6-response-memory.md); engine RAM contains native allocation; remove when qualified pre-buffer control preserves HTTP semantics |

E02 does not exempt our parsers, renderers, artifact streams, metadata or control
messages from their explicit bounds. Its hard-container guarantee is unqualified
until the release's native runtime and OOM tests pass.

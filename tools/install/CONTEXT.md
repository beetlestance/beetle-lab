# Explicit offline fresh installation

Public index exports provisionFreshInstallation, inspectReadyConfiguration and root-owned types.
The caller supplies complete bounded settings/policy/manifest, trusted workers,
read-only Docker capability, signal and one fixed monotonic deadline <=30s.
No serving service calls this component or repairs missing authority implicitly.

capture owns closed request validation and snapshots; inspection owns four named
GET facts plus an optional offline image. configuration composes the catalogue/schema.
files owns private no-follow exclusive files, pinned directory identities and
original close custody. receipt owns bounded replay identities/config digests.
authority loads real configurations, configures real Journal approved profiles,
and completes the exact Journal authority gate; no SQL implementation is copied.

An initializing receipt is claimed before configuration/runtime effects. Errors
preserve partial files for explicit recovery. Ready replay re-inspects four named read-only facts, holds an
exclusive serving gate, validates actual authority and never rewrites settings or
tokens. Runtime data is neither inventoried nor hashed. Cleanup failure retains
ownership and permanently fences further process admission; abort/deadline wait
issued original promises. At most one provision operation is admitted per process.
Failed CLI request-file close permanently fences later request-file intake.

inspectReadyConfiguration validates receipt/configuration/image pins without opening
Journal authority. It grants configuration readiness only. compose/ owns default
packaging bootstrap and its separate configuration gate; serving startup still
verifies actual authority. The optional fixed export profile uses the same catalogue.

CLI accepts exactly three private packaging arguments, reads no environment,
and prints only bounded result JSON or fixed private error codes.
Contract: docs/design/lld/fresh-installation.md.
Scoped checks: vitest run tools/install/test --maxWorkers=1; eslint tools/install;
tsc -p tsconfig.node.json --noEmit; check:architecture; check:docs.

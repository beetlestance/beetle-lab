# Native settlement recovery evidence

[Contract](../design/lld/output-settlement.md), [harness](../../tools/qualification/native-application/retirement/README.md).
One real bounded public k6 run exercised normal Root native cleanup, authenticated
runner retirement/settlement and both compiled metadata workers. It passed in27.04s
including process startup; the harness measured22.59s. No user installation was used.

The peer observed and dropped a real committed agent settlement reply, then fenced
further settlement dispatch. Root/gateway close completed before inspecting unchanged
backend debt169804. Agent stop/offline inspection found one4096-byte tombstone/replay
charge, zero native holds and absent covered original rows. Agent restart replayed the
exact settlement reply and the original cleaned retirement reply over authenticated HTTP.

Normal Root then committed backend settlement; its actual worker reply was withheld.
Actual worker abort and Root failure remained explicit, rather than being mistaken for
rollback. Fresh worker read/replay recovered one permanent2560-byte backend tombstone
and exact credit167244. Original Run/output/cleanup records were absent. Both stores'
FK checks passed; repeated agent/backend replay left counters and identities unchanged.

Published backend files were absent, staging retained only the installed namespace
marker, and engine containers/mailbox volumes were absent. Target counts were exactly
one readiness request, one work request and zero unexpected paths. Task containers,
networks and volumes were cleaned; diagnostics reported no failures. Native paused
retry count was0 because Root closed before retry; the separate focused TCP regression
proves a paused second POST reaches no upstream, then release permits exact third replay.

Actual platform: Darwin backend Node26.7, Linux arm64 Node24 agent/engine. Images were
qualification overlays: fresh compiled agent/engine bundles and engine runtime/plan/
contract sources, from verified local base images. Dependency maps and lockfile matched
the recorded base source; the new contract export/package file was overlaid. Actual
inherited layer prefixes, entrypoint, user, working directory and environment matched.
This is admitted-source recovery evidence, not production-recipe, amd64, Linux-backend,
absence or never-admitted qualification. Other branches retain their separate evidence.

Agent image d455e5718d91; engine771feac831e1; source4b38918. Full identities, dependency/
payload hashes, actual image manifests, private logs, SQL evidence and source-bound plans
are retained privately. First overlay build failed because bare image-ID FROM syntax
was interpreted as a registry reference. Task-owned local aliases corrected it; the
successful build verified actual base IDs/layers and used no network for build steps.

First types/proxy lane passed5cases, then lint rejected proxy-forward complexity.
Request capture/admission responsibilities were separated; corrected types17.03s,
proxy5cases2.21s and lint7.16s passed. Architecture rejected an unnecessary private-port
type import; the harness now derives that type from its approved Metadata facade.
Node types11.06s and architecture13.65s passed after correction. No gate changed.
Independent review inspected actual native evidence and accepted the scoped outcome.
No repeated native lane followed documentation-only changes; frozen inputs preserve it.

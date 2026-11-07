# Staging contract

`index.ts` exposes read-only installation verification and Stager. Verification
checks bounded daemon/container evidence and existing canonical local root, UID/GID,
permissions and access. Its private immutable handle is process-local provenance;
it does not qualify cross-container file visibility or provide a security sandbox.
Trusted composition owns the sole agent process and Journal for the installation.

Stager reads immutable Offer, charged Reservation and sticky supervision through
public Journal entries. It checks exact policy, identity and admission-derived
wall deadline before task creation and before each subsequent filesystem mutation.
Inputs stream sequentially, <=4 MiB chunks with <=8 MiB retained write windows,
with exact size/SHA256.
Secret providers receive frozen scoped authority and declared references only;
values are <=64 KiB each and <=1 MiB aggregate, never hashed into metadata/errors.
Files use exclusive/no-follow opens,0400 mode, ownership/single-link checks and
fsync. Fresh0700 task/input/output/secrets directories refuse reuse. Failure
preserves evidence; no release, deletion, dispatch, retry or event append occurs.

Prepare returns result plus quiesced. Cancellation/deadline can resolve failure
while an issued operation remains unknown; its active slot and close boundary
remain pending until it settles and every descriptor closes. At most two active
preparations exist process-wide and there is no waiting queue. A close error keeps
quiescence unknown. Caller must await quiesced before considering reservation work
settled. Durable cancel is reread at write boundaries/publication; caller signal
bounds stalled operations. Same-UID malicious concurrent path replacement remains
outside this trusted single-agent profile; checks detect observed replacements.

StagedAttempt is unchanged: ../../../contracts/runner/v1/staged-attempt.schema.json.
Scope check: NODE_OPTIONS=--max-old-space-size=1024 node node_modules/vitest/vitest.mjs
run agent/test/staging --maxWorkers=2. Synthetic inspection/providers, actual temp FS
and compiled SQLite Journal only. Docker/Linux/Desktop visibility and enforcement
qualification, installer provisioning and integrated launch remain outstanding.

# Scoped implementation worker template

Status: instruction template; coordinator fills the packet before dispatch.

You own exactly one behavior in the supplied validated packet. Work only on its
assigned branch/worktree and allowed paths. The coordinator integrates and decides
acceptance. Your model assignment does not change the quality requirements.

## Before editing

Read applicable AGENTS, the packet, its owning LLD, named modules/tests and relevant
engineering/verification sections. Verify cwd, branch/base and read hashes. Return
at most six lines: behavior, writable ownership, key invariant, failure oracle,
commands to run, missing context. Stop if dependencies/context are stale or absent.

Do not read every document or copy old/private project instructions. Do not load
credentials, real .env files, live user data or unrelated private repositories.
Use the packet's obvious synthetic fixtures. Scope is a constraint, not a hint.

## Implement

Keep one responsibility per function/module. Search the named public owners before
adding a helper; don't duplicate engine compiler, outcome mapper or state owner.
Keep buffers/queries/serialization bounded, cancellation explicit, and telemetry
scope honest. No success fallback or silent catch to satisfy the happy-path test.

Unapproved contracts/dependencies/schema changes or files outside scope belong to
the coordinator. An explicitly assigned reserved SQLite migration is allowed;
its numbering and transaction/schema contract must already be in the packet.
Return the minimal proposed change and reason instead of editing them. Do not
weaken type/lint/coverage/import/size tests, alter expected outcomes or mark actual
logic generated. Fix root behavior, not the evidence report.

Run only scoped commands with assigned resource/data namespaces. No daemon-wide
Docker cleanup, external service mutation, global install or shared test reset.
Respect tool denials and cost approval; report the blocker without a workaround.
No nested agents. Do not merge/rebase/push/deploy/switch/reset or bypass Git hooks.

## Handoff

Check diff paths and generated drift. Commit only named files if the packet permits
commits; otherwise return the diff. Write the [handoff](handoff.md) report, including
actual failures/skips and what remains. Do not claim ready because code compiles,
reviewed because you reviewed yourself, or accepted because your tests pass.

If review requests a correction, use the amended packet/base and preserve prior
evidence identity. One task remains one behavior; unrelated defects go under
noticed, unfixed. Stop after submission; do not pull another queue item yourself.

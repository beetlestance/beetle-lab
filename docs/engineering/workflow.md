# Task execution

Use the [backlog](../plans/backlog.md) for open product work and [engineering](conventions.md)
for code rules. Architecture ownership remains in the [system overview](../system/overview.md).
Original rewrite schedules, model assignments and task-hour estimates are
[historical](../evidence/README.md), not instructions for current sessions.

Continue the rewrite on `rewrite/integration`. Do not merge or promote it to
`develop` or `main` without explicit user approval. Task completion and passing
checks do not authorise promotion.

For each task, record one observable outcome, exact base/dirty inputs, owned paths,
required decisions and scoped checks. Use one task branch/worktree and preserve
user services/data. Inspect branch rules and rebaseability before an expensive
cutover CI run. Do not weaken required gates to save time.

Implement directly by default. Delegate only when authorised and useful; use short
handoffs and existing workers where appropriate. Keep one heavy local lane unless
independent capacity is established. Use the existing
[check runner](../../tools/check-runner/CONTEXT.md) to retain exits, logs and failures.
Repeat only checks invalidated by changes; CI/server policy may still require
checks on a new commit. Preserve exact external job handles instead of restarting
work because a status observation failed.

A handoff needs current commit/dirty state, accepted evidence with its scope, open
failures, the next ready action and cleanup state. Keep detailed logs outside the
normal context. Remove clean task branches/worktrees after verified integration.

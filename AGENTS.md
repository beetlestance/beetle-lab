# beetle-lab implementation rules

Read the repository documentation map and assigned task packet first. This
rewrite uses the accepted HLD/LLDs; current legacy source is a feature reference.

- One task, one worktree/branch, explicit file ownership. No nested delegation.
- Workers do not push, merge, rebase, switch, reset, deploy, change rulesets or
  use real credentials. Coordinator owns integration and root dependency files.
- Contracts, migration IDs and root lock/config files have one reserved owner.
  Request amendments rather than inventing a missing public interface.
- Keep production modules <=400 lines and functions <=80 lines/complexity 10.
  Review responsibility as well as size; no duplicate engine/compiler logic.
- Use strict types and validate boundaries. Never hide errors, fake success,
  disable tests, lower gates or broaden scope to obtain a pass.
- Bound reads, buffers, serialization, finalization and output. Include failure,
  cancellation, isolation and resource tests where the boundary requires them.
- Tool denial is a blocker for that action, not an invitation to bypass it.
- Use synthetic data and task-owned temp directories/ports/containers. No global
  installs, daemon prune, shared database reset or private source in public docs.
- Scoped checks during implementation; coordinator performs integrated checks.
  One heavy Docker/build/measurement lane; use existing exact-source CI evidence
  first and follow the parent policy for expensive work and push authorization.
- Return exact commits/changed paths, packet identity, actual test commands/exits,
  failures and limitations. Self-report is not independent acceptance.

Required inherited parent policy: no push without explicit authorization; no
repeat heavy build/test when relevant exact-commit CI already exists; preserve
user data and Git metadata; bounded task-owned caches; no global dependencies.

See docs/engineering.md, docs/verification.md and docs/execution/ for details.

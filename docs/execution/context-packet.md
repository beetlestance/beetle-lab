# Agent context packet and preload protocol

Status: proposed dispatch format; its preflight tool is a W00 deliverable.
A prompt alone is not a sandbox. [Schedule](schedule.md) owns locks/tool boundaries.

## Immutable packet contents

Coordinator prepares one small packet per behavior, stored outside shipped product
artifacts (e.g. ignored `.agent-work/packets/`). Templates are versioned documentation;
reports/logs/packets are generated operational state, not public test artifacts.

| Field | Meaning |
| --- | --- |
| packetVersion, taskId, attempt | Schema version, queue identity, bounded correction attempt |
| purpose, observableOutcome | One behavior and why it matters |
| model, reasoningEffort, role | Exact currently available routing choice |
| baseCommit, contractCommit, dependencyCommits | Immutable integrated source identities |
| worktree, branch, allowedWrites | Absolute task location, assigned branch and narrow glob list |
| instructionSnapshot | Applicable ancestor/repository AGENTS and higher-level task constraints, exact bytes/hashes |
| requiredReads | Owned spec/module/test paths with hashes and optional sections |
| contractFixtures, acceptanceIds | Independent valid/invalid examples and required A/V/N cases |
| commands | Existing exact scoped checks, cwd, timeout, isolated data/port/project names |
| locks, resourceBudget | Shared-resource claims and local CPU/RAM/test-worker allowance |
| forbiddenActions | No merge/push/deploy/credential reads/gate relaxation/nested agents |
| decisions, unresolved | Settled assumptions; missing choices that require a stop |
| packetHash, reportPath | Canonical packet digest and compact output location |

Owned same-repository code is permitted context. No secret value, environment
dump, unrelated private-repository excerpt or entire conversation. Snapshot the
applicable parent instructions explicitly: a relocated worktree may not discover
the original ancestor AGENTS. A packet cannot override higher-priority instructions.
Compute packetHash from canonical JSON excluding packetHash itself; include hashes
of all immutable context artifacts. Pin relevant input bytes, not just path names. Required reads must be small enough
to fit the task; target <=1,000 lines and roughly <=12k input tokens. If more is
needed, decompose or justify it. Limits are context hygiene targets, not model caps.

## Preparation and startup

W00 bootstrap is coordinator-only with a manually validated packet and read
manifest; it implements the preflight/gates. W01 follows W00. Normal worker
dispatch starts only after those outputs are accepted. No general bypass flag.


1. Coordinator freezes a reviewed design/schema snapshot. Prefer a scoped design
   commit containing only intended files when implementation is authorized. A
   source HEAD without currently untracked PLAN/docs cannot serve as that snapshot.
2. Create a new worktree/branch at the accepted integration SHA. Materialize the
   approved docs/contracts there; never silently copy dirty/untracked source or
   credential files from another checkout. Any approved immutable overlay has its
   own manifest/hash and is part of the tested source identity.
3. Validate packet schema, dependency acceptance, read hashes, allowed paths,
   branch/HEAD cleanliness (or exactly the approved hashed overlay, no other dirt),
   model availability, resource namespace and lock claims.
   Reject absolute/wildcard write scope covering the whole repo or .git metadata.
4. Start a fresh worker with the worker template plus packet. Worker verifies its
   actual cwd, branch, base and reads, then returns a short acknowledgment of the
   behavior, owner, invariants and test oracle before editing.
5. Only after acknowledgment may it implement. If the worker cannot explain an
   invariant, narrow/reload context; do not compensate by adding the whole repo.

The coordinator owns worktree creation and shared Git/index operations. A task's
normal local commit is allowed only on its assigned branch, by named paths after
checks. No blind `git add -A`, no rebase/merge/switch/push/reset or hook bypass.

## Drift and stop behavior

Missing dependency, hash mismatch, unexpected dirty file, foreign worktree edit,
unknown generated contract, secret exposure or missing authorization means stop
that action and return blocked/partial. Do not guess an API, read private files,
weaken a validator, bypass a denied command or change a global lockfile to proceed.

If a relevant contract changes during work, coordinator revokes the packet and
supplies the new accepted baseline/read hashes. Preserve the old branch/report
for comparison; do not present its review/tests as current. Unrelated integration
changes do not invalidate independent work automatically. The integration gate
still rechecks its seams after landing.

## Worker outputs and verification

Submit commits/diff, packet hash, actual command/cwd/exit, input/source identity,
behavior cases, resource observations, uncertainty and out-of-scope notes. Raw logs
stay under task-owned output directories. Report at most 40 lines, with linked
artifacts; the coordinator independently verifies reported commands/results.

Coordinator audits changed paths, generated/root files, source hashes and runtime
namespace ownership before review. Explicitly check for hidden caches/full reads,
shared mutable globals, ignored errors and unsupported measurement claims; all
models can produce these defects. Reviewer reads diff+contract+tests independently,
not just the author's narrative.

## Preflight tests to implement in W00

| Case | Expected result |
| --- | --- |
| Wrong branch/base or unaccepted dependency | No dispatch |
| Missing untracked design doc in fresh worktree | No dispatch; no fallback to memory |
| Read hash mismatch / revoked contract | No dispatch or stop before edit |
| Write glob escapes worktree / includes secrets or .git | Reject packet |
| Concurrent task claims same interface/lock | Queue task; no last-writer-wins |
| Unknown model or unavailable tool | Explicit blocked; never silently route to weaker model |
| Fake worker changes forbidden root file | Submission rejected before integration |
| Fake worker reports tests but artifacts disagree | Submission rejected; evidence gap recorded |
| Report says done but dependency only submitted | Next task remains blocked |
| Fixture includes secret canary | Packet/log redaction check fails safely |

## Dispatch sketch

Current session's tool shape, not executable repository automation:

```json
{
  "task_name": "w05_admission",
  "model": "gpt-6.1-sol",
  "reasoning_effort": "high",
  "fork_turns": "none",
  "message": "Read the worker template and validated task packet. Acknowledge the scope before editing."
}
```

The message must identify actual materialized template/packet paths at dispatch;
the sketch is not a ready assignment. Model overrides and capacity are resolved
from tools then, not assumed from this file. [Templates](templates/worker.md)
are reusable instructions, not a tested orchestration engine.

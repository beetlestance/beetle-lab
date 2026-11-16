# Parallelism, exclusive work and integration

Status: implementation policy; the session board records current assignments.
Capacity is four active sessions including coordinator in the current environment.
Do not confuse model slots with local CPU, Docker or test-resource capacity.

## Suggested waves

| Wave | Coordinator responsibility | Worker slots (maximum three) | Exit |
| --- | --- | --- | --- |
| 0 | W00 coordinator bootstrap, then W01 contract freeze | W01 Sol only after W00; Astra independent opinion after draft | Gates/preflight and schemas accepted sequentially |
| 1 | Review/integrate narrow packets | Sol W02->W03; Sol W04->W05; Sol W11 | Stable domain/storage, fake runtime/admission, web shell |
| 2 | Shared-contract and dependency integration | Sol W10 when W06 is accepted; Sol W06; Sol W08 | API/runtime/compiler boundaries integrated |
| 3 | Validate first real end-to-end run | Sol W12; Sol W07->W09; Sol W13 when runtime/API ready | Namespace editor and real k6 live result path |
| 4 | Review/fix seams and feature ledger | Sol W14 -> W16; independent Sol fixes; calibrated Luna docs/fixtures | W16 final suite waits for accepted W14 |
| 5 | W15 packaging, image/proxy setup and gate ownership | Sol scoped fixes; Astra adversarial review; Luna docs if a slot is free | Integrated candidate with no unresolved blockers |
| 6 | W17 source-bound integration acceptance | Pause writers; at most read-only review | Integrated candidate report |
| 7 | Q01-Q04 named qualification, manual review status | Serialized heavy/measurement lanes; read-only opinions only | Exact-source qualification or explicit blocked scope |

Arrows are sequential tasks within a lane, not agents spawning more agents.
A not-ready task leaves its slot idle or takes another genuinely independent ready
packet. Wave 2 W10 cannot overlap unfinished W06 unless an explicitly integrated
fake-backed subset is sufficient. Likewise W13 starts only on frozen accepted APIs.
The table is a dispatch guide; the dependency graph is authoritative.

## Model slot use

Default: one implementation owner per complete feature batch, with scoped tests
and one independent review by the coordinator. The coordinator cannot independently
review code it authored; assign one reviewer for that batch. Additional workers
are useful only for ready, independent features with frozen interfaces. Three
workers is a ceiling, not a utilization target. Use moderate reasoning for routine
implementation; reserve high reasoning and Astra for a named unresolved risk.
Do not stack an opinion, a separate review and another acceptance review over the
same unchanged boundary. Reopen review only for affected corrections or new evidence.

Use separate worktrees/branches from an accepted integration SHA. Each worker's
isolated filesystem, ports, SQLite files, Compose project, artifact directories
and fake targets have task-specific names. Tools still share the host/Docker daemon.
Worktrees are not a security sandbox; instructions are not enforced permissions.
Apply tool/filesystem controls where available and audit mutations independently.

## Bounded continuous delivery

Complete, review and integrate one feature batch, then start the next ready batch
without asking for routine confirmation. Keep the full R0-R4 scope; a batch is a
work boundary, not a smaller definition of completion. Authorization limits for
push, publication and deployment remain in force.

Use one short assignment and source pointers per batch; automate mechanical hash,
path and evidence bookkeeping. Do not create a new worker for each helper or fix.
Before starting, name the observable result, owned files, decisive checks and
expected effort. At handoff record changed paths, actual check exits, unresolved
limitations and token usage when exposed. Unknown usage stays unknown. Investigate
a material overrun before spending on additional review or widening the task.

Workers run affected checks once; coordinator runs changed integration seams once
per composed batch. Reuse unchanged source-bound evidence. Full release checks
belong to a named qualification batch. Preserve required failure and isolation
coverage; reducing orchestration does not relax correctness gates.

## Exclusive lanes

| Work | Rule |
| --- | --- |
| Contract IDs/state semantics/public API change | Coordinator-owned contract lock; revise packet/schema baseline before dependent writers continue |
| Root dependency/tooling/lockfile generation | One writer; workers propose changes and rebase on accepted lock |
| SQLite schema numbering and shared generated clients | One reserved owner; regenerate once from accepted source |
| Integration branch mutation | Coordinator only, one landing at a time |
| Docker image build/install-heavy task | One host-heavy lane unless measured resource headroom is explicitly available |
| Resource/thermal/overhead/soak qualification | Exclusive measurement lane; no builds, installs, tests or code writers on measured source |
| Hosted CI settings, rulesets, push/release/deploy | Coordinator only under existing explicit authorization; never a worker side effect |

Independent tests with private temporary SQLite databases can run concurrently
within the host test budget. Browser runners and compilers are not automatically
cheap. Cap test workers and retire containers owned by that task only. No daemon-
wide prune, shared database reset, global dependency install or copied real secrets.
A free heavy lane is not authorization: inherited cost rules and exact-commit CI
evidence still determine whether another local build/test is appropriate.

## Integration protocol

1. Worker submits exact commits, packet hash and source-bound test report.
2. Audit allowed paths, dependency/lock/schema changes and source/fixture ownership.
3. Independent reviewer inspects behavior, invariants and tests; comments include
   source anchors and reproduction/oracle. A clean opinion alone is insufficient.
4. Worker fixes within scope; changed commits invalidate affected review evidence.
5. Coordinator lands a coherent commit set onto the integration branch. Resolve
   conflicts semantically; an API conflict is not a text-merge-only decision.
6. Run affected seam tests at the new integrated SHA. Publish this SHA as the next
   ready baseline only after consumed guarantees pass; record their accepted status.
   Integrated means landed with applicable seam checks; accepted means all evidence
   required by that packet's declared scope is satisfied. Qualification is separate. Unit passes from a child branch are scoped.
7. After accepted integration, archive task reports/manifests and branch tips, verify
   that no unique or uncommitted work remains, then remove the task worktree and local
   branch. Include cherry-picked/squashed work only with patch or historical-tree proof.
   Preserve the original and active integration worktrees; never discard local data.

Rebase is coordinator-owned for waiting/returned branches; workers do not change
base behind the packet's back. Contract/doc changes invalidate active packets when
their owned semantics changed; unrelated integration does not require a global stop.
If review is slow, lower dispatch concurrency rather than queue unlimited unreviewed
code. Maximum three submitted-but-unreviewed packets before pausing new builders.

## Task states

planned -> ready -> running -> submitted -> reviewed -> integrated -> accepted.
Blocked, partial, needs-revision and superseded carry an owner/reason and are
explicit states, never synonyms for done. Readiness checks
base/dependency/context/lock availability; acceptance checks integrated behavior.
A ready task has one active owner. Timeouts/stalls release agent slots but not an
unknown live Docker execution; reconcile owned resources before reuse.

For review failures: one focused correction cycle on a small task; if substantive
issues repeat, stop and reassess decomposition/model/context. Tool denial or unknown
authorization stops that action; no alternate bypass. Infrastructure outages are
recorded separately from code-quality failures, with bounded retry.

## Reporting and resource hygiene

Record task-session time, scoped test duration, review effort, model, token usage
when exposed, file count, acceptance/rework and integration delay. Do not infer
API dollar cost from session time or assume API pricing equals this product's bill.
Keep a short current board and per-task artifacts; never retain whole conversation
history as required preload. The coordinator remains responsible for stopping
agents that exceed scope, duplicate an owner or lack a coherent failure model.

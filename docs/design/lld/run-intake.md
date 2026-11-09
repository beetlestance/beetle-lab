# Durable application run intake

Status: implementation contract for enqueue/read. Dispatch, event ingestion and
artifact finalization remain required follow-on boundaries; this alone is not R2.
[Storage](domain-storage.md) owns terminal outcomes and [execution](execution-protocol.md)
owns the independent agent journal. API schema sources own exact wire shapes.

## Request and authority

POST `/api/v2/organizations/:organizationId/workspaces/:workspaceId/runs` accepts
workspace scope, requestId, immutable revisionId, engineProfile, explicit budget
and executionPolicy (parallel/isolated, preferIdle). Return202 with the original
queued Run snapshot. GET collection/detail use the same workspace prefix.
Browser requests contain no configuration copy, image, capabilities, paths,
credentials, runtime options or arbitrary environment. A run pins the saved revision.

The application has a trusted, bounded installed profile registry (<=32 entries).
Each profile maps engine ID/config version to exact image/manifest identity and
required capabilities. First release supports k6; adding an engine requires its
own registered contracts. Profile selection cannot silently choose another image.
Persist the exact trusted registry manifest/profile/schema identities beside the
Offer. Its public selector does not carry those pins. Before first dispatch, a
changed same-selector registry identity must refuse delivery, never select updated
semantics silently. After possible delivery, retain the old intent for reconciliation;
the dispatch contract must define its exact agent-side identity handshake.
The browser may display these pins but cannot author them through enqueue.

Structural preflight is not semantic engine validation. Run.validationStatus starts
pending; full staged input compilation runs under agent admission before load.
Do not infer passed validation from a saved revision's structural preflight status.

## One receipt-first transaction

Application prepares a bounded immutable command with newly allocated runId,
attemptId and requestedAt. Canonical request digest covers operation plus the whole
validated request, excluding allocation IDs/time and later resolved installation
state. Existing namespace canonicalization owns serialization; no second digest rule.
The shared workspace requestId receipt namespace prevents cross-operation reuse.

The existing exclusive SQLite worker owns enqueue in one immediate transaction:

1. Look up receipt before current settings/profile/capacity or object reads. Equal
   digest returns the original snapshot; changed intent conflicts. Allocation IDs
   generated during replay do not replace original IDs. Lost acknowledgements may
   only replay the identical request, never mint another execution intent.
2. Verify workspace/revision identity and each published input pin's scope/hash/size.
   Read the immutable config from that revision; caller-supplied config is forbidden.
3. Resolve current installation/organisation/workspace settings and genuine fresh
   runtime ceilings. Reject unknown capacity explicitly; do not invent host capacity.
   Requested budget/profile must fit current allowed ranges/values. Snapshot all
   three settings versions and selected values; later edits do not change the run.
4. Bind selected installed profile to revision engine/config version. Build and
   validate a complete immutable runner Offer from those pins, revision config/input
   manifest, secret references and requested policy. Digest its non-secret intent
   using the existing canonical JSON serializer over the Offer with intentDigest
   omitted, prefixed by `beetle-lab.run-offer.v1\n`; never hash resolved secrets.
5. Enforce installation control-plane pending-run bound, then insert run, first
   attempt and dispatch outbox atomically. Initial state queued/outcome pending,
   version1, validation pending. Outbox references the attempt's exact immutable
   Offer bytes; keep one copy, not two divergent payloads.
6. Save the bounded original Run response in the same receipt transaction. Commit
   before replying. There is no HTTP, filesystem streaming or agent call in SQL.

The queue bound is a trusted installation option, default256, range1..4096,
independent of engine concurrency. Count nonterminal runs with a maintained indexed
projection; no unbounded COUNT over history. Full queue returns a typed refusal
without partial run/attempt/outbox/receipt rows. This is a control-plane memory/work
bound, not a minimum host-machine requirement or a performance budget.

## Persisted identities and reads

Migration004 is reserved to the coordinator. Do not alter applied001..003. Run
foreign keys bind workspace/revision/suite scopes; attempt IDs are unique and
ordinal is unique per run. One active attempt pointer belongs to its run. The
outbox is unique per attempt and references the same immutable intent. SQL string
limits measure UTF8 bytes; Offer<=2MiB, config<=1MiB, Run snapshot<=64KiB.
Only two Offer-sized original commands/replies may be retained at worker ingress;
ordinary metadata commands retain their existing smaller allowance. A timeout or
caller abort does not free a still-running original operation's byte capacity.

Run detail is a compact snapshot: scope, IDs/revision digest, state/outcome/version,
validation status, activeAttemptId, requestedAt, cancellationRequested, typed reason,
selected engine/profile/image/config version, budget/policy and settings versions.
No embedded config, complete event history, raw samples, logs or artifact payloads.
GET is observational and never launches work. Stable ID-ordered lists return<=100
items with query-bound cursors; scope mismatch returns404. No cross-workspace lookup
by a bare run ID. Client guards bind create reply revision/profile/budget/policy,
detail ID and each page item to the route's workspace.
Nonterminal DTOs have pending outcome. Finished allows passed/failed/inconclusive
with engine validation passed; discovery exhaustion is completed but inconclusive; cancelled/errored mean inconclusive with a typed reason. These
client consistency checks do not replace backend exit/seal/artifact verification.

## SQLite implementation boundary

`openMetadata` accepts optional private `runs: {profiles,pendingLimit}`. Profiles
are <=32 unique names/selectors, with exact image/manifest/profile/schema digests
and required capabilities; the total registry is <=32KiB within existing64KiB
bootstrap intake. Schema pins must match the shipped k6 config adapter. The default
registry is empty, refusing new enqueue while allowing receipt replay and reads.
This is programmatic configuration; executable installed-profile loading and the
agent capacity/identity bridge still need integration.

The one worker builds an Offer synchronously from bounded saved configuration;
create/get commands stay64KiB and pages remain within existing1MiB replies. No full
Offer is returned to the parent yet. A future outbox read must reserve the declared
two large-original slots before exposing2MiB replies. Enqueue does not imply that
this unimplemented dispatch transport has been qualified.

Shared `prepareK6SecretReferences` owns the <=64 alias translation in contracts;
the engine wrapper delegates to it. Its128KiB serialization bound accommodates
maximum escaped versions. It resolves no values. Application preflight rejects
unsupported providers/paths before persisting a new Offer.

Runs keep one immutable initial snapshot plus explicit current-state columns.
A partial pending index bounds queue checks to the configured limit, independent
of historical closed runs. Attempt/active-pointer FKs bind run and workspace;
immutable triggers also reject REPLACE. Possible-delivery evidence is monotonic;
actual claims and acknowledgements remain the next protocol boundary.

## Handoff to execution

A dispatcher must durably mark possible delivery before external Offer issue.
Missing acknowledgment never proves absence of execution. Retry same attempt/Offer
only; reconcile snapshot identity/generation before mirroring admitted state.
Queue cancellation before possible delivery can close locally. Once delivery may
have happened, persist cancellation and reconcile/forward it until stopped evidence.
Dispatch claim, cancellation, event cursor and finalization are separately frozen
ports before implementation; enqueue must not pretend these paths already work.

Intake never reopens an existing run. Explicit execution retry is a later contract;
it must reconcile the general terminal-run rule with retaining multiple attempts
under one logical run. No transport retry authorizes a new attempt.

## Acceptance

A02/V02/V03/V19/V21: exact receipt replay after reopen/settings/profile/capacity
change; conflicting requestId and cross-operation reuse; wrong workspace/revision/
input pin; invalid budget/profile; stale capacity; no mutation on refusal; atomic
late-insert failure; queue bound under races; scoped detail/page/cursor; immutable
snapshot after edits; bounded full-size Offer/config and ingress originals.
Independent HTTP tests must lose a successful202 reply and prove one durable run,
one attempt/outbox and unchanged original returned IDs. Storage-only tests do not
prove dispatch, cancellation, results, browser behavior or real Docker execution.

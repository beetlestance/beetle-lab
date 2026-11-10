# Durable run cancellation

Status: implemented and locally verified; native/browser qualification pending.
Evidence: [durable cancellation](../../verification/cancellation.md).
Owners: backend run command, delivery loop, agent journal/installation and scoped UI.
This extends [run intake](run-intake.md), [dispatch storage](dispatch-storage.md)
and [agent stop](agent-stop.md); their ownership and resource limits still apply.

## Public command

`POST /api/v2/organizations/{organizationId}/workspaces/{workspaceId}/runs/{runId}/cancel`
uses the existing authenticated session and workspace authorization boundary.
`CancelRunRequest` is a closed object containing `scope: WorkspaceScope` and
`requestId: Uuid`. Path and body scopes must match; cross-scope IDs yield scoped
not-found. Success is HTTP 202 with the scoped Run snapshot. Acceptance records
intent; it does not prove that physical execution has stopped.

The application operation is `{kind:'cancelRun', id:Uuid, request:CancelRunRequest}`.
The prepared command adds `intentDigest`, calculated over the logical operation
including run identity and request. Cancellation needs no expected version: intent
is monotonic and must not race frequent phase updates through optimistic retries.
The private port is `RunCancellationStore.cancel(command): Promise<Run>`.
Creation remains a separate command. Existing request receipts serialize and bind
replays; reusing a request ID for a different run/operation is a conflict.

The metadata worker validates again before effects. One immediate transaction
checks the scoped run, records cancellation, handles provably unsent work and
writes the response receipt. Increment Run.version only when its DTO changes.
Already terminal runs retain their outcome; cancellation does not rewrite history.

Unsent means the authoritative original outbox has `possible=0`, no generation,
no execution record/charge and no contradictory ownership. Only then may that
transaction retire the outbox and close locally as cancelled/inconclusive with
reason cancelled. Preserve actual validation status; never invent validation.
Missing outbox or a queued display state alone is insufficient proof. All other
cases record intent and retain immutable binding, execution/output charges and
pending result custody. Claim and cancellation share SQLite serialization; a
claim must recheck intent even for a previously captured queued key.

## Private original refusal

Add runner operation `cancelOriginal`: POST
`/runner/v1/attempts/{attemptId}/cancel-original`, exact existing `Offer` request,
HTTP 200 `AttemptSnapshot`. `RunnerAttemptClient.cancelOriginal(body, signal?)`
uses the same captured attempt identity, journal authority and original-call
credits as Offer. Generation remains 1. The engine protocol does not change.

The private agent authenticates and validates authority, path/scope and structural
Offer before journal effects. This route shares Offer ingress's two slots before
body parsing, 2 MiB envelope, node/depth limits and original-settlement custody.
An older server's unknown-route/body-limit rejection retains uncertainty. Never
fall back to normal PUT, adopt another journal or treat a generic 404 as absence.

Installation exposes `cancelOriginal(input:unknown): Promise<AttemptSnapshot>`.
It captures a trusted local time and delegates one large journal original
`cancelOriginal({offer,now})`; it does not consult catalogue/staging feasibility.
This bypasses current engine availability, never structural or ownership checks.

## Atomic agent evidence

Reserve agent migration **010** for an immutable, foreign-key-bound fresh-cancel
refusal marker. Older binaries must reject schema 10. Preserve schema 9 authority
and quarantine behavior; never adopt an old journal or backfill refusal evidence.

Within one immediate journal transaction:

1. Capture/validate the canonical original and determine actual receipt absence.
2. Persist or equality-check through the existing Offer owner.
3. Persist cancellation and first-cause supervision through a shared atomic body;
   the ordinary supervision wrapper remains transactional, without nested BEGIN.
4. Only if this transaction inserted a previously absent receipt, insert the marker.
5. Validate/project the final snapshot before commit; any failure rolls back all.

Fresh refusal projects existing admission `{state:'rejected',reason:'cancelled'}`.
It has no queue candidate, reservation, admission time, launch token, event sequence
or engine result. Marker plus queue/reservation/native-work evidence is corruption
and fails closed. Do not synthesize catalogue validation identities. Marker lifetime
follows retained original receipt lifetime; pruning cannot allow late Offer revival.

An existing receipt must canonical-match first. Preserve rejection/release facts,
retire pending queue admission and retain active charges. An old compatibility
receipt without admission facts remains unknown; it cannot gain a fresh marker.
After commit, reuse monotonic installation/controller stop signaling and custody;
repeat cancellation must not reset first cause, grace or escalation clocks.

Cancellation-first makes late identical PUT return the retained cancelled receipt;
admission and create authorization also deny cancelled work. If PUT/admission wins
first, execution may exist: retain charge until actual original quiescence/release.
No receipt design serializes a later public intent with an already-issued request.

## Delivery and user interface

For an unacknowledged possible original with cancellation intent, a validated scoped
missing receipt under its bound journal UUID permits cancelOriginal, never normal
PUT. Existing positive receipts use ordinary cancel. An acknowledged missing receipt
cannot create fresh refusal evidence or erase acknowledged physical history.
Keep the existing one-original turn, fair cursors and positive observation custody.
Only matched observation releases execution charge; event ACK, artifact storage and
result finalization remain distinct owners.

Run detail offers cancellation for nonterminal work. Show requested/stopping versus
confirmed cancelled separately. Keep command/request ID across a lost reply and
refresh the scoped run. Session/scope changes fence stale completion and retries.
Aborting the browser request is not cancellation of the engine.

## Required evidence

- Real journal both orderings; late identical PUT; admit/create denial; existing
  unknown receipt; pending queue retirement; charged work remains charged.
- Duplicate/reopen/lost reply; canonical/scope/generation/authority mismatch;
  contradictory marker; rollback at each fresh write; disk/worker failure.
- First-cause/grace persistence; no catalogue/stager/engine effect for fresh refusal;
  active create/start/collection originals drain before shutdown/release.
- Mixed Offer/cancelOriginal share two ingress slots and gateway credits; maximum
  valid envelope and invalid depth/node/body; disconnect/abort retains originals.
- Backend cancel/claim both orders, stale queued key, unsent proof negatives,
  request receipt conflicts, lost reply/restart and cross-scope isolation.
- Matched release occurs once, output allocation remains retained; UI distinguishes
  accepted intent, failed request and terminal evidence across session changes.

These are acceptance requirements, not claims of tests already executed. Full
execution/result and native Docker architecture qualification remain separate.

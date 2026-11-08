# Installation execution controller

Status: implemented and independently reviewed component. This component composes existing
admission, staging and [attempt controllers](agent-controller.md). It introduces
no second reservation store, test state machine or execution retry policy.

One owner uses the exclusively locked journal and installed catalogue. Startup
configures admission and supplies qualified resource observations/guards separately;
the controller must not invent them. Preconfigured Stager services bind each
catalogue entry to verified roots, pinned profiles and bounded input/secret providers.

`enqueue` preflights the bounded Offer through the catalogue, then invokes journal
admission.offer. Accepted means its immutable intent was durably queued or already
accepted, not that tests validated or passed. A queue/capability rejection must not
be returned as accepted. Identical replay does not launch a second execution.

`drive` owns one scoped generation lane, with at most64 retained owners. It snapshots
scope/budget, loads the immutable offer and reservation, and atomically admits queued
work before any preparation. Admission deferrals remain uncharged; an admitted
reservation is always retained while original preparation/runtime work is uncertain.
At most two preparations run concurrently; saturation defers without treating the
attempt as failed or inventing another execution.

A reservation admitted by this live owner may prepare once. The controller retains
both Preparation.result and original quiesced promises; only successful original
quiescence permits creating and launching an AttemptController. Preparation failure
may abortUnstarted only after all originals settle successfully. Rejected/failed
original cleanup is sticky and remains charged. A cancellation during preparation
aborts the owned signal and prevents late launch; durable intent precedes runtime
signalling. Deadlines never acquire a new execution budget.

A charged reservation recovered without any create token is abandoned setup, not
permission to restage existing paths. It may safely abortUnstarted after recovery
establishes no local original work. A claimed reservation reconstructs its exact
RuntimePlan from the immutable offer, installed pins and deterministic roots; it
must match the persisted specDigest and reconcile through tick, never restage or
redispatch tests. Missing catalogue pins or uncertain dispatches remain charged.
A released/aborted reservation reports durable status without another launch.

`cancel` persists clocked intent and fences an owned controller/preparation without
waiting for the active drive lane to finish. The installation retains any original
cancel/drain promise. `inspect` returns scoped journal/allocation observations for
trusted composition; raw launch tokens never become browser or engine data.

`close` is cached, fences new offers/drives, cancels owned preparations/controllers,
and waits for every original operation and close outcome independently. Uncertain
runtime/cleanup rejects or remains pending; it cannot be reported as clean shutdown.
The journal closes only after its owning bootstrap has handled that outcome.
A bounded external [scheduling loop](agent-scheduler.md) scans active journal pages and invokes drive; this
component creates no hidden timers, unbounded work queue or fake resource samples.

This layer does not finalize application results, grant artifact deletion, apply
hard output quotas or authenticate its private HTTP caller. Those remain separate
owners. The full installation/container path needs qualification after composition.

Implementation acceptance requires: saturation is checked before charge or retains
fresh-owned never-prepared setup for retry; completed controllers close before
eviction; pending/failed cleanup owners are never evicted to recover a slot. Exercise
more than64 sequential completions and a blocked65th uncertain owner. Cancel/close
fences must survive pending enqueue/admit continuations and be checked immediately
before preparation/launch. Only durable queued intents and existing accepted
reservations count as accepted; pending_full does not. Bind the public collectOutputs
implementation directly when constructing AttemptController, without a new public
port. Reconstruction includes the same deterministic secrets mount as fresh staging.

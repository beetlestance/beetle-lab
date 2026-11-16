# Preflight before enqueue; semantic validation under admission

Status: selected first-release flow; preflight adapter and full run API pending.

## Decision

The application preflights bounded JSON against the installed schema, approved
manifest/image/schema identities, capabilities, settings/budget bounds and scoped
sealed input/opaque-secret metadata. It pins those immutable inputs and durably
enqueues a run pending engine validation. It does not read datasets or import an
engine compiler. Hashes identify the preflighted bytes; they are not proof that
validation ran or that a target test passed.

The agent admits the complete staging/execution/collection budget before setup.
Inside that container, the engine verifies staged files and identities and invokes
its one compiler. Full semantic checks, dataset parsing and compilation finish
before readiness requests or target load. They consume the same accepted limits
and deadline. A validation timeout/OOM is a resource/execution failure, not proof
that configuration was invalid.

Preflight errors retain synchronous 400/413/422 semantics. Successful run enqueue
returns 202 pending semantic validation, never a promise that all suite errors
were already eliminated. A semantic rejection is durable `invalid_config`, run
`errored`, outcome `inconclusive`, with bounded safe issue codes/paths. Cancellation
precedence remains unchanged. Track validation status `pending/passed/failed` for
the exact pinned execution inputs, separately from phase and final test outcome.

## Reason and limits

Full k6 validation may parse up to 32 MiB of datasets. Doing that synchronously in
the backend duplicates engine ownership or hides heavy unadmitted work. Running
an uncharged validation container has the same accounting problem. This decision
clarifies validation timing; it does not remove current-feature requirements.

A separate validation-only operation, if exposed by an editor/client, must itself
be an admitted task with its own cancellation/evidence. Export already requires
admitted heavy work and uses the same compiler. No general DAG scheduler or
compiled-artifact reuse protocol is introduced. Validation evidence is bound to
scope/revision/config/effective target/input/image/compiler/schema/secret identities;
unknown secret versions remain unknown. It cannot establish later target readiness.

The actual installed preflight adapter, authenticated dispatch, run/outbox storage,
staged loader, admitted compilation gate and terminal result path remain required.
`ValidationIdentity` is the private preflight identity record, not a full semantic
compiler result. No operational end-to-end run is claimed by this decision.

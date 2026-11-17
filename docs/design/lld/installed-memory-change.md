# Installed capacity change

## Scope

Grow per-run memory within the existing execution pool. The first required use is
512 MiB to 1 GiB on an existing local installation. Preserve configurations,
organisation/workspace overrides, immutable Offers, identities in completed history,
artifacts, retention, credentials, control reserve and headroom. Memory changes
keep the existing pool size. Output changes grow only the aggregate backend/agent
output pools inside the existing storage allocation and free-space reserve; per-run
budgets, memory and disk ownership charges remain unchanged.
A 1 GiB run can consume the whole shipped 1 GiB execution pool; two such runs
cannot be admitted together. This operation does not infer host capacity.

## Authority and configuration

The original root `installation.json` remains immutable provisioning evidence.
Its request digest and four baseline configuration/token hashes remain valid.
`config/configuration-state.json` is the sole mutable configuration selector.
It shares the existing read-only directory mount, so atomic replacement is visible
inside services; an individual file bind would retain a stale inode.

A ready selector preserves baseline installation/request/Journal authority bindings.
Its optional generation binds an operation UUID, installation UUID, original request
digest, requested capacity kind/amount and all three selected configuration objects
under one bounded digest. Older memory generations without the request metadata
remain readable; their completed replay is restricted to memory operations.
The receipt limit is 128 KiB. Credentials are referenced, never copied into generations.
Each selected configuration is validated by its owning service; installation IDs and
backend/agent profile identities must agree. The catalogue derives new identities.
Baseline files and completed Offers are never rewritten to the new identity.

Both serving loaders require a ready selector and check unchanged baseline bytes.
After acquiring their existing serving leases they recheck the captured selector;
stale configuration cannot outlive a maintenance transaction. An unfinished, missing,
malformed or inconsistent selector refuses serving. Explicit private receipt paths
support manually composed configurations; there is no missing-file serving fallback.
Trusted offline initialisation can validate baseline files before a selector exists.

## Offline transaction

The caller stops backend and agent and retains the Compose configuration gate when
present. The coordinator acquires both existing startup leases and uses the existing
cold-source inspection: no queued/charged/active work, unacknowledged delivery,
unfinished export/input/output mutation, or live native runtime. The stopped agent
must use the canonical configuration, rather than an external operator override.
Completed history and retained files remain intact.

1. Validate baseline pins, hashes, installation and Journal authority.
2. Capture the current persisted installation settings and version. Derive a grow-only
   request preserving other user values and installed policy. Refuse pool overflow.
3. Build the complete generation through the existing catalogue constructors.
4. Atomically publish a `reconfiguring` selector containing the operation UUID,
   expected settings, requested capacity kind/amount and proposed generation; fsync its directory.
5. Apply the chosen field change through the settings owner under one CAS
   transaction. Preserve unrelated settings; do not invent a host observation.
6. Close the original metadata writer before publishing the ready generation.
7. Drain original IO before releasing startup leases. Failed cleanup retains custody.

Initialising a selector for an older installation occurs only during this explicit
offline operation from verified baseline evidence, before any settings change.
Ready means committed configuration. Normal agent startup must configure its Journal
and obtain fresh resource observations before it can admit work.

## Failure and replay

The caller supplies and retains one operation UUID. Matching replay after completion
returns unchanged. An unfinished selector requires the same UUID, capacity kind and amount;
the generation is derived again and must match, rather than being silently replaced.
Settings may be exactly old or exactly the committed next version/value. A different
version or value is a conflict. Ambiguous commits stay fenced until matching replay
resolves their actual state. Earlier memory-only pending records are normalized
without changing their proposed generation. Temporary receipt publication is operation-owned and
resumable; no general cleanup or baseline repair is attempted.

## Verification

Policy tests cover grow-only limits and preserved reserves/settings. Composed tests
use the real configuration loaders, catalogue and SQLite owners to cover common
identity selection, stale/missing/unfinished selector refusal, replay, CAS conflicts,
rollback, running-agent refusal and failure after settings commit before publication.
Native acceptance additionally requires restart on the committed generation and
inspection of an actual run container's memory limit. Fixtures alone do not establish
that the user's installation has changed.

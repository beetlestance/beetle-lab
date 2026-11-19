# Decision 033: An origin change is a selector field, not a new fingerprint

Status: accepted. Recorded on 19 November 2026. Amends [decision 032](032-private-network-access.md).

## Decision

An existing Compose installation may change its browser origin with an explicit offline
command, `setup origin --from <current> --operation-id <uuid>`, taking the new origin from
`BEETLE_ORIGIN`. The change is recorded as an optional `origin` field of the mutable
selector (`config/configuration-state.json`) with the baseline origin, the current origin
and the operation ID. The baseline receipt and its request digest never change.

- Services must be stopped, both startup leases held, and no upgrade or capacity change may
  be unfinished.
- `--from` is a compare-and-set guard. Each operation ID is recorded outside the root;
  replay answers from that record and never writes again.
- The target follows decision 032 unchanged: HTTPS unless loopback, explicit network
  opt-in, exact Host, Origin and CSRF checks. No browser pairing step is added.
- Suites, runs, credentials and resource settings are not touched.

## Why

The origin is part of the provision request, and its digest is checked by receipt capture,
the Compose gate, every generation and the installed-request resolver. Keeping the baseline
in the selector lets all four keep their recorded value, so an origin change cannot be used
to rewrite the installation's identity, and an interrupted change has one file to
reconcile. The selector already carries the other offline mutations (capacity generations,
the upgrade fence), and both preserve unknown-to-them fields by copying the selector.

Records live beside the upgrade receipts in the Compose home, outside the root, so an
upgrade rollback cannot desynchronise them. Origin changes wait for unfinished upgrades, so
the rollback's restored selector always holds the current origin.

## Alternatives

- Rewrite `requestDigest`, the gate row and every generation digest: rejected. It rewrites
  recorded identity, which capacity and upgrade forbid, and leaves three places to reconcile
  after an interruption.
- Fold the change into `setup upgrade`: rejected. The upgrade's blocker set and backup are
  far larger than an origin change needs.
- Let the backend reread the field at serve time: not needed. Setup gates every start and
  passes the origin the backend checks.

## Consequences

Releases that predate the field refuse the selector, so an older release cannot serve an
origin it cannot check. That is protection, not a rollback procedure: to run an older
release, first change the origin back to the baseline with a current release, which removes
the field. An installation records at most 256 origin changes.

## Review triggers

Revisit for multi-user or hosted deployment, a second mutable binding (instance name or
home), or if the backend needs the origin from configuration instead of its environment.

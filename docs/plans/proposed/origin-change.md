# Plan: change an installation's origin

Status: proposed, not built. [Decision 032](../../decisions/032-private-network-access.md)
keeps an installation on the origin it was set up with until a supported command
exists. This plan describes that command and the one choice it needs.

## Why setup refuses today

`externalOrigin` is a field of the provision request, and the receipt records only
the request's digest (`installation.json` `requestDigest`). The origin is written
to no configuration file: the backend reads `BEETLE_EXTERNAL_ORIGIN` from Compose.
The digest is checked in four places:

- receipt capture (`tools/install/src/receipt.ts`, `requestDigest === c.requestDigest`);
- the Compose gate (`bootstrap.sqlite` `request_digest`, `tools/install/compose/gate.ts`);
- every committed generation (`previousDigest`, capacity and upgrade);
- `originChecked` in `tools/install/src/installed-request.ts`, which names a changed
  origin as `binding_changed external_origin` when the baseline used the former
  loopback default. Any other changed origin falls through to `recovery_required`.

Browser sessions carry no origin, so a change needs only a new pairing.

## Options

1. **Selector field (recommended).** Add an optional, selector-only receipt field
   `externalOrigin: { baseline, current, operationId }`, beside `generation` and
   `upgradeFence`. The baseline digest never changes. `installedRequest` rebuilds the
   digest from `baseline` when the requested origin equals `current`, and passes
   `current` to backend configuration validation. Releases that predate the field
   already refuse unknown receipt fields, so a rollback to one fails closed.
   The command is `setup origin --origin <url> --operation-id <uuid>`: services
   stopped, both startup leases held, the same `network_access_required` checks as
   setup, one atomic receipt rename, idempotent on replay with the same ID.
2. **Rewrite the digests.** Recompute `requestDigest`, the gate row and every
   generation's `previousDigest`/`digest`. Smaller to read afterwards, but it
   rewrites recorded identity, which the capacity and upgrade owners forbid, and an
   interrupted rewrite has three places to reconcile.

## Work for option 1

- `contracts/src/installation-generation`: capture and select the new field.
- `tools/install/src/receipt.ts`, `installed-request.ts`, `capacity/state.ts`,
  `upgrade/receipt.ts` handling: accept and preserve it; capacity and upgrade keep
  it unchanged.
- `tools/install/origin/` and a `compose-origin.js` bundle, modelled on
  `compose-capacity.ts` (gate, home, settlement).
- Tests: replay, interrupted rename, loopback → HTTPS, HTTPS → loopback, refusal
  without `BEETLE_ACCESS=network`, rollback of an older release refusing the field.
- Docs: installation contract, decision 032 amendment, the private-network guide's
  "not supported yet" paragraph, troubleshooting.

Open: whether the command should also be reachable through `setup upgrade`
(one operation) or stay separate (recommended: separate, smaller blocker set).

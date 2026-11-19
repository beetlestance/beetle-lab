# Origin change

How a ready Compose installation moves to another browser origin without losing state.
`tools/install/origin/` owns the operation and its host-side records; the installed-request
resolver (`tools/install/src/installed-request.ts`) owns how every later start proves the
original fingerprint ([decision 033](../../decisions/033-origin-change-selector.md)).

## Command

`docker compose run --rm setup origin --from <current origin> --operation-id <uuid>` changes
the origin to `BEETLE_ORIGIN` (the loopback default when unset). The target passes the same
checks as every start: one canonical origin, HTTPS unless loopback, `BEETLE_ACCESS=network`
for a non-loopback origin or bind, an IPv4 bind ([decision 032](../../decisions/032-private-network-access.md)).
A fresh home refuses with `invalid_input`; the advanced request-file installer has no
origin command.

- Preconditions, checked offline before anything is written: both startup leases (a serving
  owner is `conflict`); no live engine or agent container; no `upgradeFence` and a terminal
  upgrade receipt (`origin_blocked upgrade`); the selector in phase `ready`
  (`origin_blocked capacity_change`). The daemon pin is not checked.
- `--from` is a compare-and-set guard: it must equal the origin served now, else
  `binding_changed external_origin`. The resolver accepts the request only if it rebuilds the
  receipt's `requestDigest`, so a wrong baseline cannot be selected.
- Order: append a `pending` entry to `<home>/origin/operations.json` (outside the root, at most
  256 entries, only the newest pending); one atomic rename of
  `config/configuration-state.json` that sets or removes its `origin` field, refused with
  `conflict` if the selector moved since it was read under the leases; mark the entry
  `committed`. Nothing else under the root is written.
- Replay with the same ID and origins finishes a pending entry (a staged selector temporary
  resumes) or returns `unchanged` for a committed one without writing, so a stale replay never
  overwrites a newer change. The same ID with other origins is `conflict`; a pending entry for
  another ID is `origin_blocked origin_change_pending`; a full history is
  `origin_blocked origin_history_full`.

## Selector field

`origin: {version: 1, operationId, baseline, current}` is present only while `current`
differs from `baseline`, the origin the request was recorded with; returning to the baseline
removes it. `baseline` never changes, so `requestDigest`, the Compose gate row and every
generation's `previousDigest` stay as recorded. Capture is strict: exact keys, UUID, two
canonical valid origins that differ. The baseline receipt never carries the field.

- Every start compares the requested origin with `current` (else `binding_changed
  external_origin`) and proves the digest with `baseline`. The backend reads only
  `BEETLE_EXTERNAL_ORIGIN`; its Host, Origin and CSRF checks are unchanged. Setup gates every
  start, so the backend does not reread the field. Browsers keep state per origin: the new
  origin starts a new automatic-access session ([decision 015](../../decisions/015-automatic-local-access.md)); there is no pairing step.
- Capacity changes and upgrades carry the field unchanged. Upgrade `prepare` refuses with
  `upgrade_blocked origin_change` while an origin entry is pending. An upgrade rollback
  restores the selector as it was at `prepare`, which is the current origin because origin
  changes wait for unfinished upgrades.
- Releases that predate the field refuse the selector outright (`recovery_required`), because
  their receipt capture rejects unknown fields. That protects the installation from serving
  an origin it cannot check, but it is not a rollback procedure: no older release can start
  it until a current release runs `setup origin` back to the baseline, which removes the field.

Tests: `tools/install/test/origin-operation.test.ts`, `tools/install/test/origin-records.test.ts`,
`tools/install/test/compose-upgrade-arguments.test.ts`, `tools/install/test/installed-request.test.ts`.

## Related

- [Installation](installation.md), [Upgrade](upgrade.md), [Resources](resources.md#offline-capacity-change)
- [Private-network guide](../../../site/src/content/docs/guides/private-network.md)

## Anchors

| Code | Reviewed |
| --- | --- |
| `tools/install/origin/` | `c6b16c6e65dd` |
| `tools/install/src/origin-selector.ts` | `aec1b4512d09` |
| `tools/install/src/installed-request.ts` | `2dd80b0c540c` |
| `tools/install/compose/origin.ts` | `32a5b59d55d6` |

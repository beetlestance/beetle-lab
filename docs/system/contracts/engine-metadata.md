# Engine display metadata

`getInstallationStatus` may return `engines[].engine` with the installed engine's
`id`, declared `version` and `configVersion`. Missing metadata stays absent.
This is an informational label, without admission, execution or result authority.

The capacity source captures these fields and the installed profile identity only
from an already checked capabilities frame. A fresh ready status sample must name
exactly one engine matching the approved profile, ID, image digest and config
version. The digest must also belong to the verified-image facts. Stale, missing,
ambiguous or mismatched facts omit the label; malformed/control-bearing versions
are refused. Version strings contain at most 128 Unicode scalars.

The in-memory status board detaches and freezes nested facts. Neither caller
mutation nor a later report changes an earlier snapshot. This adds no database
write, native inspection, background loop or dispatch permission.

The startup view matches the full Run selector before displaying the version.
It reads once when startup needs it, with explicit retry for unavailable metadata;
metrics and cancellation do not depend on that read. This label identifies the
installed selector, not a persisted record of a historical run's engine version.

## Anchors

| Code | Reviewed |
| --- | --- |
| `contracts/api/v2/installation-status.schema.json` | `81648e3beffa` |
| `app/src/ports/installation-status.ts` | `e5773cb780a6` |
| `app/src/adapters/outbound/capacity/status.ts` | `8ca95c5a3607` |
| `app/src/application/installation-status/` | `1cd7c2b126ab` |
| `web/src/features/runs/live/engine-version.ts` | `c9ac4a1517c5` |

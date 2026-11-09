# Input client and inventory evidence

Runtime/client integration: `d35f71e` (including the Node smoke-fixture correction).
Date/environment: 2026-11-09, Node26.7.0/macOS arm64; synthetic data only.
Scope: shared byte client, workspace inventory/deletion and compiled HTTP consumption.
Upload/download UI, actual browser and release qualification remain pending.

## Implemented boundaries

The public contracts API exposes createInputTransferClient and its types. Preparation,
append and full download share two operation slots without a waiting queue. Native
Blob reads, fetch, stream reads/cancellation and SHA256 originals retain their owner
through abort/close. Preparation and full output are <=8MiB, append and JSON <=64KiB.
Downloads require successful EOF and checksum; expected byte count alone is insufficient.
Header/record snapshots and immutable acknowledgement binding reject invalid replies.

The workspace Inputs route exposes paged inventory, explicit current status and
confirmed deletion. One original deletion identity/version survives unknown results;
202 is acceptance, not completed cleanup. Action slots use authoritative selected
GET records, with pending-deletion and post-settlement observation fences.

A session transfer-owner helper drains an old client before replacement. It is
tested but not yet wired into BrowserSessionGate or transfer controls. This does
not establish session-level transfer behavior in the running product.

## Review and scoped checks

Independent contract opinion cleared the API and bounded preparation amendment.
Independent code reviews cleared byte binding/integrity and original lifetimes.
UI review found a pending DELETE/GET race: actions could reappear before deletion
settled. Both held-response regressions first failed; the corrected inventory passed
18 tests and independent re-review. Helper review found replacement could await a
stale drain; its regression first failed, then all five helper tests passed and
re-review cleared the generation check.

The combined focused command covering contracts/src/api/input-transfer,
web/src/features/inputs, web/src/app/inputs.test.tsx and the session-owner helper passed
96 tests/11 files in15.77s. Node and frontend TypeScript, scoped ESLint,
architecture910 and documentation142 passed after browser BufferSource types were corrected by preserving
native ArrayBuffer provenance. No cast or extra payload copy was introduced.
`npm run build:web` also exited0; the existing main-chunk size warning remains.
The latest full gate remains the earlier2,886-test checkpoint; scoped results do
not substitute for a new full gate or concurrent engine qualification.

## Actual compiled HTTP

`npm run build:api` exited0. The updated `npm run smoke:api` exited0 using the public
client against the compiled backend/SQLite/native files over owned loopback HTTP.
It prepares65,543 bytes, independently checks SHA256, appends two chunks, seals,
observes publication, downloads through successful EOF/hash, deletes, logs out and
observes clean SIGTERM. No engine or external target starts.

The first attempt failed before transfer: it supplied browser-owned Origin/Cookie
as client options, correctly rejected by the guard. The Node fixture now supplies
that browser transport behavior through fetch and passes only CSRF in client headers.
This is real HTTP client/server evidence, not a browser cookie-jar/proxy test.

## Remaining acceptance

Wire the helper/client into session epochs, prepared upload intent/resume controls
and verified download UI. Browser tools currently lack their execution surface;
no screenshots, keyboard audit, browser buffering or proxy-framing proof is claimed.
Full-size live client/HTTP qualification, containers/architectures, resource overhead,
backup/soak and the complete run/results/reports workflow remain outstanding.

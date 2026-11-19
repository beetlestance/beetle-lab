# Offline origin change

`index.ts` is the host operation behind `setup origin --from <origin> --operation-id <uuid>`
(decision 033). The caller resolves the request with the origin it was recorded with
(`../src/installed-request.ts` candidates) and supplies the target, already held to the
Compose access and bind rules. One operation per process; services must be stopped.

Order: phase `ready` and a matching request digest, both startup leases
(`../upgrade/quiescence.ts`), no upgrade fence, a terminal upgrade receipt and no live
container; then a pending record, one atomic selector rename that sets or removes
`origin`, and the committed record. The selector is reread under fresh pins and must be
canonically unchanged. `files.ready` with `<operationId>-origin` resumes a staged temporary.

`records.ts` owns `<home>/origin/operations.json`: strict, at most 256 entries, unique IDs,
only the newest pending. A committed ID replays as `unchanged` without writing, so a stale
replay never overwrites a newer change. `originChangePending` lets upgrade prepare refuse.

`../src/origin-selector.ts` captures the selector field strictly; `installed-request.ts`
accepts the current origin and proves the digest with the baseline. Capacity and upgrade
copy the selector, so they carry the field. Suites, runs, credentials and settings are
never opened for writing. Older releases refuse the field; that is not a rollback path.
Contract: docs/system/contracts/origin-change.md.
Focused checks: `tools/install/test/origin-operation.test.ts`, `origin-records.test.ts`.

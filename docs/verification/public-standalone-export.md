# Public standalone export workflow

Locally verified on native Linux arm64 Docker, with a host backend. This is not
shipped-image, Compose, real-browser, amd64 or release qualification.
The [private admitted path](admitted-standalone-export.md) remains the engine/source
foundation; this slice connects a separate durable public job to that path.

## Implemented behavior

A saved immutable revision can submit a purpose-bound export, list/read its job,
request cancellation and download its verified published script. Organisation and
workspace scope, session/origin/CSRF and receipt-first request replay apply.
The functional controls live beside saved revisions; the UI redesign is deferred.

Metadata migration015 adds separate export jobs, immutable full originals, input
pins, sources, source-free absence and native artifact slots. It shares queue order,
pending limits and execution/storage policy with performance jobs. It creates no
performance Run, test verdict or backend-local compiler. A normal resource-profile
alias maps explicitly to its installed offline engine; a missing mapping exposes
no selectable export profile. Default installer mapping is still pending.

Initial delivery binds Journal authority and reserves output before remote IO.
Reconciliation reuses the same immutable assignment after uncertainty; acknowledged
polling reads compact control state. Known generation completion requires matching
stopped/released execution evidence, a verified export source, actual native byte
publication and settled producer originals. Descriptors alone do not make jobs ready.
Authenticated final producer absence has separate custody; no source is fabricated.

Backend payload reservation drops to the published script size, or zero for a
verified source-free/failed generation. Each job retains its3MiB metadata reserve.
Input pins and agent-source/control lifetime remain retained until future producer
retirement/delete orchestration proves cleanup. Publication does not purge or ACK
agent data and does not claim to refund its retained storage.

One shared connection, original-call credits, transfer owner and native byte-store
serve both purposes. Export file paths and identity domains are separate; existing
Run bindings/preimages stay unchanged. Shutdown fences both schedulers and drains
remote, transfer, finalization and download originals before releasing native custody.

## Native evidence

Command, with supplied matching private images and compiled worker overrides:

```sh
node --import tsx tools/qualification/native-application/export/public-smoke.ts AGENT_IMAGE PERFORMANCE_IMAGE EXPORT_IMAGE LOCAL_CONTEXT
```

The native command never builds or pulls images and creates only synthetic owned
roots, credentials, ports, containers and networks. It verified:

- Authenticated public revision submission and identical receipt replay.
- One actual offline engine, exit0, no OOM and network mode`none`.
- A23,313-byte script downloaded through public HTTP with its exact SHA-256.
- Wrong-workspace download refusal.
- Backend and agent restart, unchanged public job/source/script and no second engine.
- Zero readiness, work or unexpected target requests; exact-label cleanup passed.

The dynamic qualification port was refreshed after agent restart; Compose's private
service address is a separate installation concern. Three failed fixture attempts
were retained: an extra descriptor field, frozen listener options and the old
pre-restart dynamic port. Each cleaned up its owned resources. One optional Docker
log capture failed in the successful proof; native/source/download/cleanup checks
passed and the inspection evidence was retained. No missing log is relabelled as
captured. Image/source vectors and full private evidence stay outside public docs.

## Scoped acceptance

Focused checks cover receipt replay before changed eligibility, shared Run/export
queue and isolation barriers, immutable originals/reopen, compact polling, purpose
and scope refusal, known failure/source-free settlement, raw SQL refusal of source
adoption/credit release against running snapshots, real native file publication,
public full/range downloads and shutdown original retention. A690KB UTF-8 original
round-trips through the compiled metadata worker under two shared large-call credits.

A genuine baseline schema14 worker created an existing queued Run. Upgrade to15
preserved all27 prior tables' data, original Run/receipt, foreign keys and queue
order; reopen and the next global queue allocation passed. A separate late-schema
collision test proved migration rollback retains version14/data before retry.

Frontend controls cover identical replay after unknown create/cancel outcomes,
ready-only downloads, no configured engine and retired-scope cache fencing.
Affected existing Run observation/artifact/download checks retain their semantics.
The native proof preceded the final impossible-output-budget intake guard. Current
HTTP/compiled-worker checks cover that rejection before mutation; the positive
native path is reused, not claimed as a second execution of the later build.
Independent review accepted the shared seam, corrected native SQL stopped-evidence
guard and remaining public composition; it did not rerun checks.

## Remaining

Default Compose installation must provision the offline image/profile mapping.
Actual producer/source retirement, retention/delete/refund orchestration, cold
restore, backup/restore, packaged browser/image qualification, resource abuse/soak,
scans and native architecture matrix remain separate requirements. In-flight crash
and delayed-daemon absence are not established by the completed restart proof.

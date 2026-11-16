# Backend file deletion runtime

Status: reviewed local implementation with actual native/compiled-worker proof.
Base d766a53; source is the integration commit containing this report.
Contract: [driver](../design/lld/output-deletion-runtime.md).

## Installed behavior

The backend output runtime now discovers existing committed deletion intents and
processes one file step at a time through the same native byte/deletion owner.
Actual preparation and original settlement precede plan persistence. Only the
persisted plan authorizes a later unlink and exact absence receipt. A finite cursor
and ordinal retain at most one intent; no second namespace or cleanup queue exists.

The parent owns both export and deletion children. Shutdown fences both and waits
for their originals before closing native files. Native result failure notifies
immediately while retaining outstanding settlement. Rejected quiescence remains
pending and cannot release the child or namespace. A separate fixed30s watchdog
also fences/notifies while metadata is held; timeout never discards its original.

This driver creates no intents, public route or automatic retention selection.
Producer/source/event/payload records, input pins and ALL charges remain retained.
Backend files_absent is not deleted, source cleanup, a tombstone or a refund.

## Evidence

Focused lifecycle cases prove actual-plan ordering, metadata/native held originals,
cancellation, immediate negative notification, rejected quiescence custody, busy
native admission and same-row recovery after lost committed plan reply. Boundary
cases reject mismatched scope/run/ordinal/deletion/phase/plan before native effects,
oversized discovery and late metadata completion after the unchanged deadline.

Actual files are published with existing fixtures, then a compiled metadata worker
commits the deletion intent. The driver persists the native plan before a simulated
caller reply loss. Metadata and native namespace are reopened. Native removal and
its metadata absence write then lose their usable caller reply after real commit.
After another reopen, the installed output parent processes remaining files using
its own shared namespace instance and reaches files_absent. No in-memory receipt
or fresh native token supplies recovery authority.

Independent on-disk snapshots preserve all13 producer/result/event/allocation/usage
tables exactly; storage charge and original result reads remain unchanged. This
proves synthetic native/worker composition, not Docker/k6/browser execution.

Initial affected-parent lane:90 passed, five TCP cases failed sandbox EPERM.
Only those socket cases were repeated with permission. Final changed-driver/native
and corrected TCP lane:21 passed in15.74s. Node types, changed lint, architecture
and docs passed. An initial task dependency-link error prevented collection and
was corrected without changing gates. Test fixtures were corrected to construct
immutable values instead of assigning readonly properties.

Independent review found the metadata wait lacked an active deadline notification;
the fixed watchdog and held-original regression corrected it. Reviewer accepted
the correction. No full suite, image rebuild or release qualification is claimed.

## Remaining

Agent producer/source retirement and cleanup acknowledgement, final purge/refund,
public deletion controls, retention selection and cancelled unknown-output cleanup
remain separate work. No real user files or existing service were changed.

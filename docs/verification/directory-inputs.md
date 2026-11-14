# Directory input intake

Candidate: based on4e2eba0, `feature/parity-inputs`. Local macOS arm64,
Node26.7.0. Synthetic data and task-owned resources only.
Inventory: F03 / packet B02. This is not packaged-browser acceptance.

## Behavior and limits

Workspace Inputs offers a directory chooser alongside single-file upload. The
selected top directory and nested relative folders are preserved below the chosen
destination. Browser FileList does not describe empty directories; these are not
created. Existing exact folder names are reused. Folded spelling aliases stop the
import; an existing input is never overwritten or implicitly deleted.

Selection is validated before content preparation or writes: 128 files, each at
most8MiB, total128MiB, 128 folders, 128KiB aggregate path metadata, eight folder
levels including destination. Unsafe relative names, folded aliases, duplicate
files and file/directory collisions fail. Preview captures File references and
metadata without reading content. Folder discovery stops at20 pages/2000 entries;
an unavailable/cyclic destination or excessive combined depth stops before writes.

One file owner prepares at most8MiB and sends sequential64KiB chunks. Confirmed
publication advances the next file. Per-file progress distinguishes pending,
current, published and explicitly skipped. A refused create stops; a lost chunk
requires a status read; unknown create/seal retains the original request identity.
Folder creates likewise freeze the original request before dispatch and require
explicit retry. There is no automatic failed-write retry or overwrite.

The batch is not atomic. Cancellation, departure, discard or skip can leave folders
and partial inputs. Skip is available only for a paused file; it is not proof that
its backend record was deleted. Discard clears the local owner. Workspace/client
replacement disposes it and fences late dependent writes/callbacks without closing
the shared transfer client. Concurrent namespace changes remain server-authoritative;
there is no atomic directory snapshot or rollback guarantee.

## Immutable replacement

To replace data, upload it under a new name and select its new immutable input ID
in a new suite revision. Existing revisions and queued Runs retain their exact
original pin. Referenced originals cannot be deleted. This deliberately replaces
legacy destructive overwrite; moving folders does not change input content IDs.

## Scoped evidence

Final local lane:54 cases across8 files, web/Node TypeScript, scoped lint,
architecture, documentation and frontend build passed. Both directory and existing
single-file HTTP smokes passed. The initial HTTP lane was sandbox-denied; later
fixture failures were retained. The fresh fixture now initializes its required
recovery gate, canonicalizes the temp root and explicitly selects paired access.
No serving/recovery control was created for any existing installation.

Focused tests exercise selection bounds/unsafe paths, aliases, nested folders,
sequential preparation, publication, conflict/skip, unknown chunk status recovery,
committed-folder reply loss, identical replay, held-response cancellation/disposal,
and workspace departure. The composed controls test mounts both input choosers,
checks separate labels, preview, import progress and clearing without backend delete.
An application test uses the actual metadata worker and input service to create
both revisions, a queued Run and replacement bytes, then reads the unchanged old
bytes and verifies deletion protection. Its byte port is an in-memory fixture.

`web/test/smoke-directory-inputs.ts` runs the actual controllers/clients against the
compiled Fastify backend, SQLite worker and native input files on a private
loopback port. It loses a successful committed folder-create response, verifies
identical explicit replay and a single folder, imports nested nonempty/empty files,
confirms publication, hashes and downloads, then logs out and closes the backend.
It starts no engine or target load. This proves controller/HTTP custody, not a real
browser picker, frontend proxy, native-browser crypto or platform qualification.

Independent review inspected replay/cancellation/isolation and requested committed
reply-loss and held-folder departure coverage; those cases were added. Full
integration/release checks remain owned by B08–B11. No user service, image,
publication or production data changed.

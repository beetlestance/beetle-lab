# Native output bytes

Public entrypoint: `openLocalOutputBytes` in `index.ts`; implements `OutputByteStore` and separate `OutputDeletionStore` capabilities.
Existing private sibling roots share the permanent namespace lease's parent.
The factory reserves process ownership before capture and acquires the lease first.
Jobs reserve global 2/token1 credits synchronously; no callback queue exists.
Closed records are <=4096 bytes; append snapshots only intrinsic 1..65536-byte views.
Intrinsic signal checks and fresh monotonic deadlines fence subsequent work.
The shared custody owner supplies original IO, physical verification and SHA checks;
shared promotion supplies no-overwrite alias recovery and all publication flushes.
Domain-separated identities bind immutable metadata, root pair and original inode;
published identities additionally retain the complete final file signature.
Reads (`durable.ts`) accept a published file whose inode moved (VirtioFS restart, restored
copy) only after size, owner, 0600 mode, one link and the sealed SHA-256 hold; that live
identity is pinned for the start, and the recorded identity is never rewritten.
Prepare never reconstructs known custody. Only fresh null-identity transferring
state can create checked empty staging; interrupted tails are compared, not truncated.
A transferring reconciliation receipt cannot authorize metadata phase regression.
Receipts wait for original closes and post-close named/ancestor checks.
Close cancels intake, drains jobs, then closes the private namespace lease last.
Failed original close keeps job settlement pending and retains job/token/lease fences.
No SQL lifecycle, dispatch, intent creation, finalization or quota refund lives here.
Private fault seam: `store.ts` accepts native operations and a monotonic clock.
Contract: `app/src/ports/output-bytes.ts`, `docs/system/contracts/outputs-collection.md`.
Focused native tests: `app/test/files/output-bytes/*.test.ts`.

prepareRemoval verifies present published custody and returns a namespace/record/intent
commitment after original closes. Metadata must persist that actual plan before remove.
Missing fresh preparation refuses; absence replay requires the same captured plan.
remove preserves staged/unknown files, uses shared checked unlink, and confirms absence
only after all closes plus lease/root/ancestor/name/ancestor rechecks. Same token/global
credits protect both methods. See docs/system/contracts/outputs-settlement.md; no runtime wiring.

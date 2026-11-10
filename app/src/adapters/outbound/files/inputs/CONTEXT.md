# Local input bytes

Public entrypoint: `openLocalInputBytes` in `index.ts` implements the private
`InputByteStore` port; no metadata transitions or admission limits live here.
Existing private canonical sibling roots are pinned, including their ancestry.
UUID/hash-derived directories and files use0700/0600 and same numeric UID.
Append preserves the durable prefix; publication uses no-overwrite hard links,
file flush and both parent flushes. Recovery classifies exact deterministic names.
Deletion requires explicit deleting state and proves durable absence.
Reads verify the entire expected hash/size before awaited bounded sink writes.
All native descriptors belong to synchronous jobs, through once-only close.
Failure codes are fixed; cancellation drains originals. Failed close retains the
job/handle with pending settlement, allowing the service to fence intake.
Physical custody owner: sibling `custody/index.ts`; input jobs map neutral errors.
Native test seam: `store.ts`/`native.ts`; production always uses Node operations.
Limits:8MiB expected payload,64KiB chunks; statfs supplements logical quota.
Contract: `docs/design/lld/input-publication.md`, `app/src/ports/input-bytes.ts`.
Focused verification: `npx vitest run app/test/files/inputs --maxWorkers=1`.

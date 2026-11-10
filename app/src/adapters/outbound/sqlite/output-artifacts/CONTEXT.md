# Output artifact metadata

The existing OutputCustody transaction and Metadata worker queue own these writes.
Inputs bind the original EventBinding, both adopted digests, ordinal, logical writer
and expected slot version. Immutable artifact values come from the sole manifest.
Requests and replies are captured within 4096 bytes. No extra original credits,
file/network operations, terminal projection or allocation changes occur here.

The native namespace owner recovers the stored writer; SQL never proves producer
death or replaces a different writer. Publication records the exact native receipt
only after the caller fences production and awaits result and settlement.

Changing writes require exact CAS. Equal replay preserves version; older matching
progress returns the current higher offset. Publication clears writer atomically.
Migration010 guards the same transitions against raw SQL; failed transactions roll
back. Base reads and adoption replay derive current slots through one decoder.

Focused tests: `vitest run app/test/storage/output-artifacts*.test.ts`.

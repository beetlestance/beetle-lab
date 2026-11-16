# Native file custody

Public entrypoint: `index.ts`; shared app-local physical primitives only.
`Custody` retains every opened file/directory descriptor through original close.
`Directories` pins private canonical sibling roots and checks named/open ancestry.
Locations take trusted, previously validated path components and a final name.
`PhysicalFile` checks private ownership, inode identity, links and full SHA256;
reads allocate at most `FILE_CHUNK_BYTES` (65536) bytes.
Native failures remain original errors; fixed physical failures use
`FileCustodyError`. Callers map them to their own service error vocabulary.
Cancellation stops subsequent work; failed close retains the handle in its owner.
The caller retains that owner and controls job settlement/admission/lifecycle.
No input metadata, publication policy or output store lives here.
Focused verification: input native tests in `app/test/files/inputs` and
`app/test/files/custody-extraction.test.ts`.

# Suite use cases
Public entrypoint: index.ts. Commands snapshot bounded JSON before canonical intent
hashing; allocation IDs excluded, route suite identity included. Reader/store results
are validated and ownership checked. Store owns atomic mutation and global receipt replay.
No engine/compiler, runtime capacity, filesystem or network work.
Revision envelopes <=2MiB; other mutations <=64KiB; query authority <=2KiB.
Test: npx vitest run app/test/application/suites.test.ts

# Suite use cases
Public entrypoint: index.ts. Commands snapshot bounded JSON before canonical intent
hashing; allocation IDs and trusted revision savedAt excluded, route suite identity included. Reader/store results
are validated and ownership checked. Store owns atomic mutation and global receipt replay.
No engine/compiler, runtime capacity, filesystem or network work.
Revision envelopes <=2 MiB; other mutations <=64 KiB; query authority <=2 KiB.
Test: npx vitest run app/test/application/suites.test.ts

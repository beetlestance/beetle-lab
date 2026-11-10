# Private collected output source

Pure value boundary for a verified source manifest, private file custody and
durable collection intent. Contracts: docs/design/lld/output-source-commit.md and
output-collection-intent.md. The four pure codecs capture closed owned inputs,
validate local identity/chronology/custody relationships and verify content seals.
Journal transactions, controller producers and transport remain separate work.

Source digests describe content/custody, never pass/fail, publication, file absence
or physical-release authority. Reuse existing JSON, result seal, root, checkpoint
and identity owners. Capture closed owned values before hashing or worker issue.
Respect separate public/private byte limits; raw result length is not canonical
sealed content length. No native IO, catalogue lookup or engine invocation here.

Digest vectors live in agent/test/output-source/vectors/v1.json. Focused codec
tests validate failures and boundaries as well as those positive vectors.
Focused command: vitest run agent/test/output-source --maxWorkers=1.

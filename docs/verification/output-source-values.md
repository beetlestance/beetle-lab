# Private source values and stopped-root facts

Status: independently reviewed, locally verified components. Durable collection
intent/source transactions, matching-receipt finished-release gating and backend
transfer/publication remain required; these components grant none of that authority.
Contracts: [source commit](../design/lld/output-source-commit.md) and
[collection intent](../design/lld/output-collection-intent.md).

## Pure values

Codec source `7fa1d52b698ce80220c64817634e4fdf56eac37a` passed85 tests/3 files,
real2.10s. Tests exercise all five fixed vectors, mixed identities even after valid
rehashing, provider failures/reentry/original mutation, strict carrier rejection,
UTF-8/result limits, exact safe sums and immutable output. Affected Node types
passed, real7.86s, after one fixture readonly-clone typing correction; changed-file
lint passed, real1.95s, before that type-only fixture edit.

Independent reconstruction verified every stored preimage, SHA256, result seal,
byte count and intended digest-domain relationship. Separate implementation review
found no codec correctness defect, but required an explicit bounded private-carrier
precondition: native JS own-key reflection is not allocation-bounded on arbitrary
foreign graphs. Correction `1fdd0000de3185bd10875bd20188a5ef7cca7c0d` changes only
comments/contract text; every runtime rejection/copy/encoding gate remains intact.
Integration: `1ab023b72de57fbbb84ee7dcff22453821beb26f`.

Original external bytes must be capped before parsing, SQL JSON before native
materialization, and private request encoding before worker cloning. Actual
Journal/transport acceptance must prove those boundaries. Malformed-object unit
rejection is not memory qualification or an arbitrary JavaScript sandbox.

## Native root producer

Source `59280ea51cce9e40139177fe532d4fb08a56dc49` passed134 tests/14 affected
files, real16.25s: control collection, output facts/post-close and controller tests.
Changed-file lint passed, real1.59s; affected Node types passed, real9.28s.
Only stopped_verified values carry frozen root identity. The existing file owner
pins current named/descriptor metadata, preserves it across prefix-verification
passes, and waits original descriptor closes plus post-close named-root checks.
Output collection shares the same exact bigint formatter. Synthetic controller
fixtures remain explicitly synthetic and confer no native-source authority.

Independent review required a genuine early-deadline ownership oracle. Corrected
source `1c2d9d05aa2727b2ba60d9531e652b672b31c61b` passed23 focused root-facts
tests, real1.12s; one-file lint passed, real1.53s. Its fake timer expires while the
post-close native read remains held; cached close must remain pending until that
original settles. Cleanup independently drains the original even if the assertion
fails. Review confirms removing the quiescence await would fail the new oracle;
no production timer or gate changed. Integration:
`c13ded650deb8f96cf2c2d166b6138aad79aaedf`.

## Original controller binding

Source `0b86e51ba521812ce82d2bfdd8dc06a761f8a960` captures only original Offer
scope, engine, installed identity and output budget before awaiting the same
Journal's physical UUID. The controller supplies its immutable runtime plan digest.
Owned frozen metadata preserves original UUID spellings and requires generation1;
config, inputs and secrets are not retained. Focused tests passed29 cases, real1.29s;
changed production-file lint passed, real0.75s; affected Node types passed, real6.72s.
Independent review accepted the exact source in approximately55s, reusing those
checks without rerunning them. Integration: `d749b76b9305762128900d311013b6cd07b564da`.
This proves metadata capture, not native custody or a connected source lifecycle.

Evidence is Darwin arm64/Node26.7.0 component verification. No full-suite rerun,
durable source receipt, complete backend/engine path, native Linux architecture
matrix, container install, power-loss, soak or release qualification is claimed.

# Verified output source: decisions and ownership

The original proposal is superseded by the focused contracts below. This page
preserves its decisions and navigation; it grants no additional API authority.
Source values, Journal storage and controller lifecycle are implemented and reviewed
locally. Transfer, backend publication and complete release qualification remain
separate work; see [source evidence](../../verification/output-source-journal.md).

## Settled decisions

A sealed EngineResult proves content integrity, not stopped native file custody,
a test verdict, application publication or permission to delete files. The actual
collector owns hashing and descriptor quiescence; the trusted controller submits
those observations, and Journal transactions validate durable original identity.
JSON cannot prove process lifetime or native quiescence.

Public manifest identity excludes private paths and runtime/create/start evidence.
Separate digest domains cover public content and complete private source custody.
Raw result files may be1MiB while canonical journaled EngineResult remains65536
bytes. Exact source/intent requests survive ambiguous commit replies. Pending
collection after owner recreation never becomes failed solely from timeout or
source absence; recovery must preserve pinned roots and avoid target execution.

CPU/RAM release, event ACK and application publication are distinct transitions.
Retained agent files and backend output reservations keep their charges. Backend
must verify every full artifact hash; provisional range bytes do not inherit
whole-file content proof from the manifest digest. No source receipt alone permits
source deletion or refunds unused backend storage.

## Current owners

| Need | Owner | State |
| --- | --- | --- |
| Private/public values, digest preimages and bounds | [Source commit](output-source-commit.md) | Implemented/reviewed values and Journal gate |
| Precollection intent and conservative recovery | [Collection intent](output-collection-intent.md) | Storage/controller components implemented locally |
| Journal operations, quota and receipt release | [Source Journal](output-source-journal.md) | Implemented/reviewed component |
| Native root/result byte facts | [Collection custody](output-collection-custody.md) | Implemented/reviewed producers |
| Bounded ranges and durable event closure | [Output transfer](output-transfer.md) | Reviewed direction; exact interfaces pending |
| Shared payload budget and backend publication | [Output adoption](output-adoption.md) | Reviewed direction; exact interfaces pending |
| Existing logical output allowance | [Output allocation](output-allocation.md) | Reservation implemented; settlement pending |

Transfer/adoption drafts do not accept endpoint schemas, metadata ports, migration
IDs, final outcome eligibility, nonexecution closure or deletion protocols. Those
remain required before their code and before a complete first release can qualify.

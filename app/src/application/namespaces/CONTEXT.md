# Namespace use cases

`mutateNamespace` snapshots canonical client intent, calls the atomic writer and
checks returned entity kind/scope/route identity. CREATE allocation IDs are excluded
from intent; PATCH binds route ID/version. No automatic mutation retry.

`getNamespace`/`listNamespaces` require explicit kind/scope and a reader port.
Authority is independently snapshotted before I/O; the reader receives a separate
frozen request. Neither reader nor pending caller mutation can widen scope/limit.
Bounded JSON snapshots (1 MiB) plus shipped API schemas check adapter results.
Wrong owner/identity returns not_found; malformed, duplicate or oversized adapter
results are internal contract failures. Pages cannot exceed the requested limit.
Returned DTOs are frozen isolated copies, never a mutable cache of another scope.

Only reader/writer ports perform I/O. Node identity and SHA-256 effects are injected;
HTTP/authentication, SQLite transactions and serialization stay with their owners.
Focused checks: app/test/domain/namespace-queries.test.ts and namespace mutation
tests; HTTP-to-SQLite integration lives under the HTTP adapter tests.

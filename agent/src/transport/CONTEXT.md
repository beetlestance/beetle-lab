# Private runner HTTP

createAgentServer composes shipped runner routes. It does not listen, schedule,
launch Docker, close the journal or finalize artifacts. Bootstrap owns those effects.
Handlers use trusted installation services plus the public journal, not raw SQL.

Authentication runs before body parsing. One mounted bearer credential, constant-
size hash comparison, bounded raw headers and no Origin/Cookie/browser-site metadata.
Attempt routes require organisation/workspace/generation headers and matching path
and body identities. Global capability failures have no invented namespace IDs.

Runner validators own request/reply DTOs. Bound/snapshot JSON before observing
response fields; reject getters and non-object serializer bypasses. Query cursors
use canonical decimal grammar. Unknown fields, generations and scopes reject before
effects. Errors never return raw config, credentials, exception text or URLs.

RequestWork shares 32 originals across metadata and source operations. Source GET
and chunk POST atomically reserve a maximum-two subset before body parsing; chunks
are limited to 1024 bytes. SourceWork retains the issued service and request/response/
socket cleanup together, including after stop hints. Source replies use Connection:
close, 75776/90112-byte caps and shared content validators before serialization.
Live GET independently reserves two of the same 32 credits and a fixed 5 s lifetime.
It uses the same physical original owner; source slots remain separate. Shared
snapshot capture/scope checks cap successful replies at 64 KiB, with no-store.
preClose fences intake, stops source parsers/sockets and drains all original work.
InstallationController must close separately before bootstrap closes the journal.

HTTP metadata evidence is separate from engine execution and result finalization.
Offer and cancelOriginal share two pre-body slots and identical Offer bounds.
Fresh cancellation does not fall back to enqueue. Contract: docs/system/contracts/run-lifecycle.md#cancellation.
An explicit OutputSourceReader owns durable source/closure/native range checks;
absent wiring returns 503. Transport never manufactures closure or publication.
Explicit finalization ACK endpoints remain separate work.
Focused checks: agent/test/transport, Node TS and changed lint/structural gates.

History GET uses one separate shared credit and 30 s SourceWork lifetime. Its reply
is <=2 MiB and 65536 JSON nodes, <=900 actual source windows with explicit sampled
coverage. Scope/subset checks precede encoding; byte/node pressure compacts actual
windows, preserving endpoints. It grants no sealed source or publication authority.

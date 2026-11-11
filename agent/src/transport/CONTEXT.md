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

RequestWork shares32 originals across metadata and source operations. Source GET
and chunk POST atomically reserve a maximum-two subset before body parsing; chunks
are limited to1024 bytes. SourceWork retains the issued service and request/response/
socket cleanup together, including after stop hints. Source replies use Connection:
close,75776/90112-byte caps and shared content validators before serialization.
Live GET independently reserves two of the same32 credits and a fixed5s lifetime.
It uses the same physical original owner; source slots remain separate. Shared
snapshot capture/scope checks cap successful replies at64KiB, with no-store.
preClose fences intake, stops source parsers/sockets and drains all original work.
InstallationController must close separately before bootstrap closes the journal.

HTTP metadata evidence is separate from engine execution and result finalization.
Offer and cancelOriginal share two pre-body slots and identical Offer bounds.
Fresh cancellation does not fall back to enqueue. Contract: cancellation.md.
An explicit OutputSourceReader owns durable source/closure/native range checks;
absent wiring returns503. Transport never manufactures closure or publication.
Explicit finalization ACK endpoints remain separate work.
Focused checks: agent/test/transport, Node TS and changed lint/structural gates.

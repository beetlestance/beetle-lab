# Private runner HTTP

createAgentServer composes six shipped runner routes. It does not listen, schedule,
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

RequestWork owns at most32 original service calls through response disconnect and
server shutdown. No hidden retries/queues; preClose fences intake and drains all
originals. InstallationController retains its own async stop/preparation work and
must close separately before bootstrap closes the journal.

HTTP metadata evidence is separate from engine execution and result finalization.
Artifact/range and explicit finalization ACK endpoints are not implemented here.
Focused checks: agent/test/transport, Node TS and changed lint/structural gates.

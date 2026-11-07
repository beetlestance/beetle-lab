# HTTP boundary

`schema-compilers.ts` configures strict draft2020 validation before route setup.
Register only shipped schemas. Request validation does not coerce/remove/default
values. Serializer-invoked responses reject violations rather than dropping data.

Composition supplies the shared bounded JSON encoder and a response byte ceiling.
The encoder must reject accessors/non-JSON and bound allocation itself; the bridge
also checks returned bytes. Schema failures expose fixed errors without values.
Request byte limits remain Fastify bootstrap's responsibility. Artifact streams
use their own authenticated range/transfer owner, not this JSON serializer.

Fastify bypasses its serializer for strings, buffers and streams, including raw
JSON text. This compiler alone does not enforce a global response budget. W10 must
enforce JSON route send policy and test that bypass; artifact byte routes need
their explicit transfer budgets. Do not claim complete response enforcement yet.

Focused test: `npm run test:v2 -- app/src/adapters/inbound/http`.
The initial fixture proves compiler semantics only. Product routes, authentication
and the production shared-encoder binding remain pending their owning tasks.

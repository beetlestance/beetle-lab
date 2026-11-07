# HTTP boundary

`schema-compilers.ts` configures strict draft2020 validation before route setup.
Register only shipped schemas. Request validation does not coerce/remove/default
values. Serializer-invoked responses reject violations rather than dropping data.

Composition supplies the shared bounded JSON encoder and a response byte ceiling.
The encoder must reject accessors/non-JSON and bound allocation itself; the bridge
also checks returned bytes. Schema failures expose fixed errors without values.
Request byte limits remain Fastify bootstrap's responsibility. Artifact streams
use their own authenticated range/transfer owner, not this JSON serializer.

`api-route.ts` binds shipped operations with `registerApiOperation(server,name,handler)`.
It validates canonical page queries before AJV, derives route schemas/status from
the catalogue and gives handlers DTOs rather than a reply. It snapshots bounded
JSON objects before sending, rejecting Fastify's string/buffer/stream bypasses.
Configure compilers and authentication first. This policy applies only to these
registered operations; artifact/SSE byte routes need explicit transfer budgets.

Focused test: `npm run test:v2 -- app/src/adapters/inbound/http`.
Synthetic and runner-catalogue fixtures prove compiler semantics and shared-encoder
binding. Actual use-case wiring, authentication and safe global error mapping remain
W10 responsibilities. The registration helper is not an authorization boundary.

# Execution contracts

Public entrypoint: `@beetle/contracts` (`src/index.ts`). JSON Schema 2020-12 in
`runner/v1` owns the wire shapes. `validate(name, unknownJson)` returns a typed
value by reference or at most 16 frozen structural issues (`path`, `code`). It
never removes fields, coerces values, supplies defaults or returns AJV internals.
Only shipped schemas are compiled; manifest schema URIs are identifiers, not fetches.
`runnerSchemas` and `runnerMessageSchemas` expose deeply frozen shipped trees and
containers for consumers' HTTP compilers. No arbitrary-schema compiler is exported.

Workspace build tooling may import `@beetle/contracts/tooling/inference` to expand
trusted schema references. It is a generation helper, not an engine runtime API.

Generate: `node --import tsx contracts/scripts/generate.ts`.
Check: `node --import tsx contracts/scripts/generate.ts --check`.
Test: `npx --no-install vitest run contracts` (configured maximum two workers).
Types: `npm run typecheck`. Generated provenance is in
[src/generated/manifest.json](src/generated/manifest.json); each generated schema
maps to its source and SHA-256. Reference-expanded typing projections avoid deep
inference while preserving schema semantics. See the generated
[API reference](src/generated/reference.md) for the six JSON routes.

`createRunnerClient(transport)` supplies typed JSON methods with schema-derived
UUID/cursor validation before encoding. `createHttpTransport({baseUrl, fetch?,
headers?, maximumBytes?, timeoutMs?})` rejects request accessors before AJV.
Headers/private URL come from the installation owner. No retries, redirects,
cross-origin or non-`/runner/v1/` calls. Errors exclude exception text and raw bodies;
a valid non-success reply carries `ProtocolError`.

`encodeJson(input, maximumBytes)` is the shared bounded serializer. Its byte limit
must be a positive safe integer <=16 MiB. It rejects accessors, non-JSON/non-finite
values, sparse arrays, cycles, depth over 64, collections over 4096 or over 65,536 nodes.
Client defaults: 1 MiB per request/response, 30-second deadline. Hard ceilings:
16 MiB, 300 seconds. Response reading uses one bounded accumulator and at most 4096
fragments. Reads observe abort/deadline even with injected stalled bodies. Cleanup
initiates cancellation without waiting for an uncooperative source to settle.
Caller cancellation returns `cancelled`; the deadline returns `timeout`.
Neither proves an admitted execution stopped: reconcile an ambiguous offer
against the agent journal before retrying the same intent.
Raw parsing and wrapper stdout's 64 KiB line limit remain transport duties.
Authenticated artifact streams/ranges belong to the artifact transport owner.

`estimateStaging` and `serializeStagedOffer` share policy1 pre-write accounting
between backend dispatch and agent staging. Callers validate Offers first. The
pure estimate includes exact bounded Offer JSON, input bytes, secret allowances
and fixed manifest/metadata charges; unsafe totals reject without resolving secrets.
`stagingPolicy` and `supportedStaging` preserve recorded policy/charge compatibility.

# Execution contracts

Public entrypoint: `@beetle/contracts` (`src/index.ts`). JSON Schema 2020-12 in
`runner/v1` owns the wire shapes. `validate(name, unknownJson)` returns a typed
value by reference or at most 16 frozen structural issues (`path`, `code`). It
never removes fields, coerces values, supplies defaults or returns AJV internals.
Only shipped schemas are compiled; manifest schema URIs are identifiers, not fetches.
`runnerSchemas` and `runnerMessageSchemas` expose the readonly shipped catalogue
and IDs for consumers to register with their own HTTP compiler. No arbitrary-schema
compiler is exported.

Generate: `node --import tsx contracts/scripts/generate.ts`.
Check: `node --import tsx contracts/scripts/generate.ts --check`.
Test: `npx --no-install vitest run contracts` (configured maximum two workers).
Types: `npm run typecheck`. Generated provenance is in
[src/generated/manifest.json](src/generated/manifest.json); each generated schema
maps to its source and SHA-256. The generated
[API reference](src/generated/reference.md) lists the six JSON routes.

`createRunnerClient(transport)` supplies generated typed JSON methods;
`createHttpTransport({baseUrl, fetch?, headers?, maximumBytes?, timeoutMs?})`
validates requests and responses without retry. Headers and the private base URL
are supplied by the installation owner. Cross-origin and non-`/runner/v1/` calls
and redirects are rejected. A transport error carries no remote body or exception
text. A valid non-success reply carries the typed `ProtocolError`.

Client JSON defaults: 1 MiB each request/response, 30-second deadline. Hard ceilings:
16 MiB, 300 seconds. Serialization rejects non-finite/non-JSON values, sparse
arrays, cycles, depth over 64, collections over 4096 or over 65,536 total nodes.
Response reading uses one bounded accumulator and at most 4096 stream fragments;
overflow cancels the reader. Caller cancellation returns `cancelled`; the deadline returns `timeout`.
Neither proves that an admitted execution stopped. Reconcile an ambiguous offer
against the agent journal before retrying the same intent.
Raw JSON parsing and wrapper stdout's 64 KiB line limit remain transport duties.
Authenticated artifact byte streams/ranges belong to the artifact transport owner.

# Public API client boundary

Public exports through `../index.ts`: `createApiClient(options)` and
`createApiHttpTransport(options)`, with `ApiClient`, input/result/failure/transport types.
The frozen client derives all named methods and DTOs from `apiOperations`/`ApiTypes`.
Methods accept `{ params, query, body, signal }` only where their descriptor permits;
parameterless reads accept an omitted object. Query limits are numbers in client code.
Inputs snapshot through shared `encodeJson` before schema validation/URI encoding/fetch.
Only JSON data enters validation/transport; non-enumerable and symbol JSON properties
are omitted by that shared encoder. Observed accessors fail without invoking getters.
Unknown own method fields and schema extras fail as safe `request` results.
Params/body/response ownership, entity route IDs, every page item, retention candidates,
intent/settings/snapshot identities and effective source ancestry are compared.
UUID identity comparisons ignore letter case without rewriting payloads or aliasing
URN-prefixed and unprefixed forms; names, cursors and protocol data retain their case.
Organisation entities are installation-owned; settings record IDs are separate IDs.
These guards supplement backend SQL scope/authorization checks; they establish neither
authentication nor cursor signatures, hierarchy transactions, retention policy or cleanup.
The shared transport alone owns JSON network I/O, same-origin prefix checks, no redirects,
body byte/depth/node/collection bounds, deadlines, cancellation and safe structural errors.
Defaults: 1 MiB, 30 seconds; configurable maxima: 16 MiB, 300 seconds. URL max: 2048 chars.
No automatic retries; a failed mutation can have an unknown server outcome.
Caller abort reports `cancelled`, elapsed deadline reports `timeout`; no raw exceptions.
Structural API errors are preserved as `protocol`; untrusted replies fail as `response`.
Native fetch cookie defaults apply; auth/CSRF are backend composition responsibilities.
HTTP raw query decoding is explicit in the app's `page-query.ts` before strict AJV;
only canonical decimal `limit` strings convert. JSON body coercion stays disabled.
Focused checks: `npx vitest run contracts/test/api/client
app/src/adapters/inbound/http/page-query.test.ts --maxWorkers=2`;
`npm run typecheck`; scoped ESLint. Set `NODE_OPTIONS=--max-old-space-size=1024`.

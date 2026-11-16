# Namespace semantics

Public entrypoint: `index.ts`; application entrypoint: `../../application/namespaces/index.ts`.
API types come from `@beetle/contracts/api`; inputs have passed structural schema validation.
Names are trimmed, NFKC/lowercase folded for sibling uniqueness; root depth is one.
Moves consume a complete root-to-parent chain of at most eight records and exact
bounded subtree height. Root identity and all owner IDs remain immutable.
The store contract owns one read/decide/uniqueness/version/intent/write transaction;
application evidence is never a preflight authorization to write later.
Only serializable commands cross the worker boundary; named domain decisions run
inside the storage worker transaction, with no callback RPC.
No production repository, SQL, HTTP, clock, UUID generator or deletion is implemented.
Commands copy caller data; errors contain static messages and typed safe codes.
`projectNamespaceIntent` returns CREATE `{kind, request}`, PATCH `{kind, id, request}`.
The full client request/scope/requestId (and PATCH expectedVersion) is hashed;
server CREATE id/rootFolderId allocations are retained only on the write command.
Receipt replay precedes write decisions and returns original CREATE IDs/rootFolderId;
fresh retry allocations never change client intent. PATCH response IDs remain bound.
Check: `npx --no-install vitest run app/test/domain --maxWorkers=2`.

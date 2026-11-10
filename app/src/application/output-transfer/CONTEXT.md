# Output transfer owner

Public entry: `createOutputTransfers` implements `ports/output-transfer.ts`.
The interface is unchanged. Inputs bind the retained EventBinding; the owner
adopts the gateway's verified source and matches local metadata before file work.

Two jobs, one per captured binding, process at most 128 artifacts serially.
Chunks use the shared exact-range verifier and a 65536-byte decode window.
Only the narrow injected output, writer metadata and native file capabilities
are used. No dependency shutdown, execution, terminal state or release occurs.

Each job retains its actual promises and native settlement independently of its
result. Cancellation/close fences producers synchronously; failed cleanup retains
credits and parent ownership. Close is cached and drains only this owner's work.
Recovery reuses the durable writer/token; publishing goes directly to native
publish and published state uses read-only prepare with exact identity matching.

Focused checks: `npx vitest run app/test/output-transfer`, changed-file ESLint,
and `npx tsc -p tsconfig.node.json --noEmit`.

# Automatic output runtime

Status: implemented with production wiring; local synthetic composition qualified.
Port: `app/src/ports/output-runtime.ts`. Bootstrap entry:
`app/src/bootstrap/output-runtime/index.ts`, `openOutputRuntime(options)`.
Consumes [transfer](output-transfer-owner.md), [settlement](output-finalization.md)
and the existing installation-owned gateway. It cannot offer or cancel engines.

## Ownership and scheduling

One installation opens one output runtime after metadata is ready and before
advertising new execution capacity. Its factory owns output file storage, the
transfer service, and its scheduler; injected metadata/gateway/run readers remain
externally owned. Production composition must supply actual finalizations.
Omitted output runtime support in a fixture must never imply successful publication.
Production agent composition always supplies the real output factory to its parent
owner, which awaits it before capacity polling and delivery start. A private
optional factory supports subset owner fixtures. Bound capability facades preserve
the consumed methods and receivers before capacity/output provisioning awaits.

Capture paths/configuration and bind dependency methods before foreign awaits.
Use the shared installation freeSpaceReserveBytes and randomUUID writer IDs.
Keep at most two active exact EventBindings, no duplicate binding, no growing
history, per-attempt retry timers or unbounded pending queue. One scanner original
at a time uses the existing bounded32-item output scan and finite upper cursor.
Advance fairly past active/unbound candidates and restart after a finite pass;
never repeatedly select the first active candidate while starving later work.
Wait at least the configured interval between scheduling turns. Capture/validate
foreign pages with the existing shared discovery implementation, publicly exported
through the runner adapter; no copied cursor/page parser.

Transfer result and settled are separate originals. Keep an active slot and its
binding until both retire. A published transfer then reads the current scoped Run
and calls finalizations.finalize with its version and the returned source digests.
Verify returned binding/digests/receipt bounds before accepting completion. Pending
settlement or a version conflict leaves the same retained attempt discoverable;
retry publication/settlement later without starting test effects again. If the
binding no longer matches the active Run, fail explicitly rather than attach it.
The metadata finalization transaction, never the scheduler, decides terminal state.

Transport/source_unavailable transfer errors remain visible as fixed problems and
allow a later finite-pass retry after originals settle. Source pending is ordinary
pending. Invalid input, integrity, cleanup, unexpected storage errors and malformed
positive replies fail the runtime, fence new work and notify onFailure once.
Local busy means defer, never create more jobs. A callback failure remains explicit.
This scheduler cannot refund storage, delete sources, clear writers or change pins.

Only the initial source GET's exact `source_absent` transfer error permits the
absence handoff. After both transfer originals retire, the same active slot reads
retained proof or fetches/adopts a bounded bound proof, then finalizes against the
current scoped Run version. Source-present and source-pending work never reads
absence custody. Required `absences`, `observations.observe`, and gateway
`output`/snapshot-only `attempt` capabilities are bound before startup awaits;
missing capabilities fail startup.

An absence finalizer's pending execution reply permits one full bound snapshot
refresh per pass through that same gateway and existing `dispatch.observe`.
Runtime validates the full snapshot, rereads Run/version, and retries the exact
proof once. Metadata owns admission/result/ACK/receipt authority. Proof, snapshot,
observation and absence finalization originals retain the same slot/native lease;
close fences subsequent calls and drains every issued original.

## Native roots and shutdown

Fixed canonical private roots are dataRoot/outputs/staging and
dataRoot/outputs/published; permanent lease is dataRoot/outputs/namespace.sqlite.
Use the existing private-directory initialization responsibility: factor its
generic implementation behind the input wrapper if needed, preserving input
behavior and stranded-close ownership. Do not copy its native validation/sync code.
Directory identity, ownership, mode0700 and symlink refusal remain enforced.
No engine-relative/public path influences these roots.

Fresh output namespace creation permits createLease=true. Reopen uses the retained
lease; never recreate a missing lease in a namespace that may contain output data,
replace it on contention, or probe a locked inode with a second native handle.
An interrupted fresh initialization must either recover with proof of no prior
output custody under exclusive metadata ownership or fail startup explicitly.
No successful partial runtime or silent deletion of an existing namespace.

Close synchronously fences scheduling and transfers, aborts issued transfer hints,
and retains scanner, Run read, settlement and file originals. Wait for transfer
producers before allowing lease release. Native files may be fenced while draining,
but unknown settlement cannot be converted to a timeout success. Cache close;
failed native cleanup retains the owner/lease. Never close metadata or gateway.
Startup failure performs the same owned cleanup and preserves its original error.
State contains only fixed codes, active0..2 and running/failed/closed status; no
private paths, source values, exception strings or growing diagnostic history.

## Acceptance

Use real compiled metadata and native file storage with a synthetic task-owned
runner peer. Prove automatic adopted-source publication and terminal projection,
pending prerequisites/recovery without engine routes, finite-pass fairness at two
slots, late original ownership, close and startup failures, corrupt positive
replies and visible bounded retry behavior. Do not require the unfinished metadata
adapter for unit scheduler tests: use the frozen finalization port; defer only the
actual composed finalizer seam until that implementation is available.
Prove fresh private roots/reopen/symlink or replaced directory refusal and missing
lease fail-closed behavior. Preserve existing input initialization controls when
factoring shared roots. No full build/Docker/browser/real-k6 claim from this packet.
First-install distribution and connected native-k6 qualification
remain explicit next integration work, not implied by a passing scheduler fixture.

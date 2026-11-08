# Output guard

The public contract is `index.ts`; the watch-service implementation is
`OutputGuardService` in `service.ts`. The composition root binds the actual
filesystem scanner through its constructor seam.

`bounds.ts` captures bounded data properties, copies scopes through the public
control protocol helper, and retains immutable RuntimePlan handles. `watch.ts`
owns each initial result, stop original and cached draining close.

The service owns at most64 registrations and two original scans. A completion
pump rotates over registrations without a pending queue; busy retries back off.
The independent watchdog uses registration time until the first complete sample,
then successful scan start time. Unknown samples never renew freshness.

Close fences callbacks and drains original scan/stop promises. Failed scanner
cleanup or stop rejection retains the registration and refuses clean shutdown.
Acknowledged stop intent and successful watch close do not certify runtime exit.

Focused checks: `npx --no-install vitest run agent/test/guard --maxWorkers=1`,
`npx --no-install eslint agent/src/guard agent/test/guard`, and
`npx --no-install tsc -p tsconfig.node.json --noEmit`.
See `docs/design/lld/output-guard.md` for limits and qualification requirements.

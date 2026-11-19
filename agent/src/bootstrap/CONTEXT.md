# Installed agent runtime

Public API: index.ts. runtime.ts owns exactly one process runtime, from verified
installation and fresh journal through actual guards/publisher/scheduler/private
HTTP composition. No test/backend factory is accepted from a job or HTTP caller.
Trusted catalogue, transport and providers come from the executable configuration.
One output source reader binds the same Journal to the native range owner and is
passed to the HTTP adapter through its outputs option. No second pool or loop is
created; HTTP routes and backend publication require their own integration evidence.

capabilities.ts keeps one informational actual observation, clipped by configured
policy and reserve/headroom. This is not admission authority or a reservation.
capacity-observation.ts adds optional 1.0 daemonCapacity (raw Docker-info totals) only when both were measured.

Startup aborts fence continuations after originals settle. Shutdown starts intake,
publication, scheduling, installation and staging drains independently, then guard
and observer closes. Journal closes only after all cleanup succeeds. Failure retains
the process owner/journal; another runtime cannot hide uncertain ownership.
Executable still owns listening and transport lifetime; no artifact deletion ACK.

Contract: docs/system/contracts/execution-protocol.md.
Checks: npx --no-install vitest run agent/test/bootstrap --maxWorkers=1;
npx --no-install eslint agent/src/bootstrap agent/test/bootstrap.

Installed live approval selects k6 only from validated catalogue configuration
and an opted-in profile with the assigned mailbox mount. It shares producer
policy/epoch rules, retaining compact approval only; all profiles remain off.
Private live HTTP is wired to existing Supervisor ownership, never actor creation.

Startup/shutdown diagnostics expose at most four allow-listed cause codes, never
error text, stack, paths or credentials. Diagnostic failure cannot block cleanup.

Startup order: reserve the single process owner, then check installation root,
daemon binding, installed images and the ready authority gate against the journal
UUID before opening the journal; then start guards, the publisher, then the
scheduler. Ready to admit only after the publisher commits an observation. At most
one failed runtime owner is kept.

`main.js` (via container.js) serves or runs `reconcile [--apply]` (decision 030; stop-signal.ts first): same
owner, startup checks, then only shared RetirementServices; no configure, guard, scheduler or server.

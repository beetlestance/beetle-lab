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

Startup aborts fence continuations after originals settle. Shutdown starts intake,
publication, scheduling, installation and staging drains independently, then guard
and observer closes. Journal closes only after all cleanup succeeds. Failure retains
the process owner/journal; another runtime cannot hide uncertain ownership.
Executable still owns listening and transport lifetime; no artifact deletion ACK.

Contract: docs/design/lld/agent-runtime.md.
Checks: npx --no-install vitest run agent/test/bootstrap --maxWorkers=1;
npx --no-install eslint agent/src/bootstrap agent/test/bootstrap.

Installed live approval selects k6 only from validated catalogue configuration
and an opted-in profile with the assigned mailbox mount. It shares producer
policy/epoch rules, retaining compact approval only; all profiles remain off.

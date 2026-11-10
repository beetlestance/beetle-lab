# Attempt controller

Owns one admitted, already staged RuntimePlan through launch supervision, bounded
control intake, generic stopped-output verification and reservation release.
It does not enqueue/admit/stage, schedule timers, expose HTTP, finalize application
outcomes, remove containers/files or retry test execution. Installation composition
must recover/stage plans and keep this owner alive while operations are outstanding.

Public factory uses the real control reader; trusted composition supplies journal,
supervisor and output collector. The private constructor accepts fault-test reader
ports. One active launch/tick call owns all original work; concurrent calls reject
busy. Budgets snapshot synchronously after ownership reservation. Cancellation is
independent of that lane and uses supervisor clocked durable intent before signalling.

Stopped intake requires definitive launch settlement and a created/exited runtime.
Each wrapper batch commits through the journal before reader acknowledgement.
Collection waits for original reader/collector quiescence and cached close results.
Failed original closes permanently prevent release. A later supervisor observation
and settled collection result supply release evidence; unknown dispatches stay
charged. A same-millisecond observation waits rather than inventing a timestamp.

Reservation release records collection finished/failed, not a test pass or an
application finalization acknowledgement. The journaled engine result remains
provisional. No cleanup/deletion authority follows from cursor acknowledgement or
this controller. Restart of an already released attempt reports its durable release
state; it never launches that attempt again.

Read durable source then intent before supervisor/collector work. One SourceSession
retains exact intent/source/release requests through ambiguity. Only receipt release
finishes collection. Preexisting intent always means recovered custody, including
same-Journal recreation; recovered failure stays charged. Artifact-only recovery
uses pinned native root/checkpoint and a fresh bounded budget, never target launch.
Installation source-first catalogue/staging recovery is a separate composition step.

Focused checks: agent/test/controller, Node TypeScript, changed ESLint and structural
gates. Synthetic Docker/collector tests prove wiring, not actual Linux execution.

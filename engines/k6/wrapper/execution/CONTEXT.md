# One native invocation and evidence collection

`runCompiledK6(options)` composes accepted build, native process, exact numeric
decoder/accumulator and strict private-summary collector. `ok` describes pipeline
collection only, never test pass/fail. Outcome mapping, control journal, artifacts,
staged compilation, admission and release remain caller responsibilities.

Inputs: accepted immutable CompiledInput, canonical installed paths, exclusively
owned directory/UID, explicit limits, trusted sinks and optional parent signal/clock.
Launch options, callbacks, attempt, limits and clock methods are captured before use.
The public native adapter is Linux-only; private test ports add no product fallback.

Invocation reservation covers maximumBuildBytes plus the fixed1MiB native summary;
build peak includes scratch. Caller separately reserves control/window/result files.
Logical bytes only; no physical quota or installation-wide capacity authority.

One sticky fence spans build/execute/collect: admitted wall deadline, wall/monotonic
high-water, a nonextending local monotonic ceiling and parent cancellation. Future
admission, invalid/rollback clocks and reentrant close fail closed. Marker callback
follows source-point validation; its UTC observedAt is retrospective receipt time.
Native exit codes remain observations. Partial native output never yields complete
numeric totals. Complete parser/native byte counts must agree before numeric finish;
allowed post-stop summary evidence retains source partial status.
Optional collectStarted is captured and awaited once after confirmed stop, before
numeric finish/summary IO. It lets the caller journal the real phase transition;
receipt and terminal UTC times remain distinct. Failure is typed summary error.

`result` may fail while original work remains outstanding; late build cannot launch.
Unknown native receipt does not wait on stalled close. `quiesced`/cached close
retain original work and close failures. `final` waits for all original cleanup
attempts to settle, then exposes latest actual facts with the first result outcome.
It cannot upgrade failure, downgrade published success, infer stop from close, or
certify overall quiescence after failed close; callers check quiesced separately.
Complete publication still waits cleanup and the final reentry fence. First fence wins.

Build/uncooperative callbacks cannot be preempted. Native termination is independent
of blocked delivery; agent/Docker own hard RAM/PID and whole-container termination.
Synthetic fixtures do not qualify native/container controls.

Check: `vitest run engines/k6/test/execution --maxWorkers=2` and all TypeScript projects.

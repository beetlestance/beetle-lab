# One native invocation and evidence collection

`runCompiledK6(options)` composes accepted build, native process, exact numeric
decoder/accumulator and strict private-summary collector. `ok` describes pipeline
collection only, never test pass/fail. Outcome mapping, control journal, artifacts,
staged compilation, admission and release remain caller responsibilities.

Inputs: immutable accepted CompiledInput, canonical installed paths, exclusively
owned output directory/UID, explicit transport/record/collection/build limits,
trusted async numeric/marker sinks and optional parent signal/clock. Launch options,
callbacks, attempt, limits and clock methods are captured before any callback.
The public native adapter is Linux-only; private test ports add no product fallback.

The caller-reserved invocation logical bytes must cover maximumBuildBytes plus
the existing 1MiB native-summary cap. Build peak includes simultaneous scratch.
Other concurrent control/window/result files require separate caller reservations.
This is not a physical disk quota or an installation-wide reservation counter.

One sticky fence spans build/execute/collect: admitted wall deadline, wall/monotonic
high-water, a nonextending local monotonic ceiling and parent cancellation. Future
admission, invalid/rollback clocks and reentrant close fail closed. Marker callback
follows source-point validation; its UTC observedAt is retrospective receipt time.
Native exit codes remain observations. Partial native output never yields complete
numeric totals. Complete parser/native byte counts must agree before numeric finish;
allowed post-stop summary evidence retains source partial status.

`result` may fail while original build/native/IO/sinks remain outstanding. Late
build completion cannot launch a child. Unknown native receipt does not wait on a
stalled close. `quiesced`/cached close retain all original issued work and close
failures; failed close cannot later become successful. Complete pipeline publication
waits for original cleanup and a final fence after quiesced observers. First fence
reason wins; every factual observation already available remains in the receipt.

In-process build and uncooperative callbacks cannot be preempted here. Native
owner termination remains independent of blocked delivery; hard memory/PID and
whole-container termination belong to the enclosing agent/Docker boundary.
No native/container qualification is implied by synthetic port/filesystem tests.

Check: `vitest run engines/k6/test/execution --maxWorkers=2` and all TypeScript projects.

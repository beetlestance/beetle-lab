# Standalone build lifetime evidence

Status: reviewed engine component; admitted standalone export remains pending.
Source: feature commit containing this report, based on7767f26.
Contract: [build lifetime](../design/lld/standalone-build-lifetime.md).

startStandaloneBuild wraps the existing standalone builder with captured scalar
options, an AbortSignal and a fixed monotonic deadline. Downloaded script timeout
remains independent. One original builder call is retained after logical stop;
settled/close wait for its reply, including late failure. Result checks the deadline
again after return, even if no timer callback ran. No retry or waiting queue.

The original helper moved to builder.ts without changing its implementation or
public export. No compiler, runtime or file cleanup logic was duplicated. A stopped
result does not prove physical preemption, native descriptor closure or released
container/disk ownership. Parent still owns those boundaries and final publication.

Initial34 lifecycle and existing export cases passed in4,015ms, including an actual
compiler/esbuild/native-script-custody chain without invoking a load engine.
Checks cover captured scalar mutation, held original cancel/close, late failure,
pre-start stop, late success, monotonic rollback and one-timer expiry.
Independent review required unexpected timer setup failures to latch clock_fenced
rather than leave an original without its deadline timer. The correction and two
new clock/timer exception regressions passed with all12 lifecycle cases in1,758ms.
Existing helper cases were not repeated after this lifecycle-only correction.

Final changed-file lint passed in1,142ms, Node types8,666ms, architecture6,455ms
and engine bundle536ms. Documentation checks precede integration. Original command,
exit and timing evidence is retained; no user service or target was changed.

Assignment/revision binding, dedicated agent purpose, durable admission/recovery,
result publication and public HTTP/UI/client workflow remain. This component does
not advertise standalone-export capability or complete F15/container qualification.

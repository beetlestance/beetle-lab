# Staged export operation evidence

Status: independently reviewed engine composition; admitted public job pending.
Source: feature commit containing this report, based on5123467.
Contract: [operation](../design/lld/standalone-export-operation.md).

The engine consumes one trusted opened staged session, verifies the complete
assignment digest and exact canonical Offer/generation1 binding, compiles once
through the existing loader, builds once and obtains native script custody.
Original staged close finishes before success. Cancellation retains every issued
compile/build/hash/close operation; no partial file cleanup or capacity release is
inferred. Caller still owns physical admission and later result publication.

Initial execution could not write Vite's mistakenly shared cache; task-owned cache
directories corrected the setup. Five composition cases then passed; one test tried
to spy on a deliberately frozen staged method. A forwarding fixture corrected that
oracle without changing production immutability. Original failures are retained.

Review found fence aborts incorrectly conflated deadline/clock with cancellation,
and supplied fences lacked an enforced staged deadline. Fixed codes now preserve
those distinctions. AttemptFence.narrow applies the staged deadline without
extending an existing wall, monotonic or phase ceiling. Ten affected cases passed
in2,297ms, including actual staged inputs/compiler/build/native custody, exact
Offer mismatch, staged close failure, held original cancellation, close before
start, three stop reasons and loose/tighter deadline ceilings.

Lint initially rejected complexity12 in profile capture. Profile validation now
has its own responsibility; no threshold changed. Final lint passed1,043ms, Node
types18,606ms, architecture6,271ms and engine bundle561ms. Documentation checks
precede integration. Independent review accepted both semantic corrections without
rerunning checks. No target, real credential or user service was used.

This is not a published capability or complete F15: agent admission/dispatch,
metadata intent/replay/reconciliation, result/source publication and public
HTTP/download/UI/client integration remain, with container/release qualification.

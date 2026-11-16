# Automatic output and terminal settlement evidence

Status: locally implemented and reviewed. The connected host-backend/real-agent/k6
slice is [locally verified](native-application-k6.md); browser and release
qualification remain pending. Contracts: [runtime](../design/lld/output-runtime.md),
[settlement](../design/lld/output-finalization.md).

## Implemented owners

Runtime `514da39` owns two bounded publication jobs, one finite-pass scanner and
native output roots/lease. It retains result and settlement separately, reports
fatal errors before unknown settlement and drains originals before lease release.
Private-root initialization is shared with inputs without duplicating native logic.
Actual metadata finalization uses one immediate transaction and immutable compact
receipt. It verifies original source pins/seal, settled release, published artifacts,
the exact event end and full confirmed ACK before terminal projection and credit.
Only unused payload allowance is refunded; metadata65536 remains reserved.

Parent wiring `eda1c11`, corrected by `69987d7`/`3975949`, provisions outputs before
advertising capacity. Source/delivery/output failures fence peer work; callbacks do
not await their own composite shutdown. All original drains precede gateway and
metadata shutdown. Consumed dependency methods bind before provisioning awaits.

Settlement `4953d26`, corrected by `e75b03e`, rejects a stored snapshot sequence above
the source's immutable event end before mutations, both through API and native
receipt insertion. Older snapshots remain valid. Positive fixture sequences were
made coherent; the contradictory case is retained as a negative test.

## Scoped evidence

Settlement has29 original new cases and42 controls with passing observations;
the sequence correction adds four regressions and29 affected passing controls.
Cases include committed reply loss/reopen, one credit, cancellation ordering,
native replacement/rollback/evidence fences, indexed closure, late ACK and unknown
wrapper facts. Wrapper exit and child k6 exit remain separate outcome evidence.
Independent review checked source, native SQL, assertions and captured logs.

Runtime has53 scoped passing observations including actual native files, compiled
metadata and loopback source HTTP. Its component composition uses a controlled
pending finalizer and makes no terminal claim. Native-root controls retain input
initialization/stranded-close behavior. Independent review checked12 source paths
and seven captured logs.

Parent wiring has76 scoped passing observations, including actual startup/delivery
HTTP controls. Four selected capture-correction controls pass, including two held
await mutation regressions. Reviews cover lifecycle and the capture correction.
Execution commands/exits/times are worker-report evidence; redirected raw logs
were unavailable for this parent packet. No suite was repeated to manufacture logs.

## Actual component connection

`app/test/output-settlement/connected.test.ts` connects the actual runtime,
compiled MetadataWorker, native byte store, HTTP gateway and actual finalizer.
A synthetic source serves131089 binary bytes plus an empty artifact. Trusted
synthetic release/events/ACK are supplied through the actual metadata ports.

Two cases establish normal completion and persisted cancellation. They wait for
actual pending/execution and pending/events replies and assert no terminal/refund
before release/full ACK. Actual published bytes and hashes match independent
expected bytes. C+M+A and the refund are computed independently; replay after
metadata reopen preserves the exact Run, receipt and storage charge. Results stay
readable and terminal attempts leave pending discovery. Strengthened cases passed
in4.29s and changed lint in1.02s. After the sequence fence and parent wiring landed,
the composed cases passed in4.62s; Node types passed in8.35s, architecture checked
1513 sources in2.86s and documentation checked241 files in0.30s. No component
suites or heavy builds were repeated for this composed check.

This is sequential cancellation, not an additional race test. Reopen here covers
metadata after settlement, not interrupted publication or output-runtime reopen;
those have separate component evidence. The synthetic source peer does not prove
agent authentication or target execution. No Docker build, browser, native-k6,
resource/soak, hosted CI or release qualification is established by this seam.
Source-free/error closure, agent publication acknowledgement/deletion, staging-parent
custody and retention remain required first-release work.

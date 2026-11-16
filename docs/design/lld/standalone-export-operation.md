# Staged standalone export operation

Status: engine composition only; physical admission and public job lifecycle pending.
Consumes one already opened trusted StagedInput and caller-owned AttemptFence.
Before compilation, capture the complete export assignment with shared integrity
validation, require generation1 and exact canonical Offer equality with staged
headers. Reject invalid output-root/UID profiles before compile or build effects.
Narrow the fence to staged authority without extending an existing parent ceiling.
The metadata owner still proves immutable revision/config relationship;
assignment digest is not admission. Reject secrets through shared capture/compiler.

Transfer staged compile/close ownership to this operation. Compile exactly once
with the existing staged loader, then invoke startStandaloneBuild with independent
script timeout/build allowance and the original fence remaining lifetime. Recheck
the parent fence between phases and before returning native script custody.
Retain every issued compile/build/hash original through close and cancellation;
never delete partial output, release capacity or synthesize terminal generation.
Only a complete successful native descriptor plus known build usage may return.
Errors use fixed diagnostic codes; cancellation, deadline and clock remain distinct. Parent must recheck its fence before publication.

The operation assumes trusted in-process objects, exclusive fresh outputRoot and
separately admitted physical container. It does not open HTTP routes, advertise
runner capabilities, produce result seals or infer container/IO absence from an
opaque builder promise. Future agent/metadata publication owns those guarantees.
Acceptance: actual staged compilation/build/native custody, assignment mismatch
before compile, pre-start cancellation and close, builder failure/held original
and cleanup failure retained. No real target, credentials or user service.

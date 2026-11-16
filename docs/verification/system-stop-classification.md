# System stops and user cancellation

Native ARM metric-pressure trial3 on source images b48936d8 exposed a projection
defect:885 successful synthetic requests preceded runtime exit137/OOMfalse with
verified `artifact_incomplete`; the public Run became cancelled. No user cancel
 was sent. Normal and independent cleanup passed. The trial remains failed and
 does not establish output exhaustion, slow-reader cancellation or the guard's
 underlying inspection failure. Private evidence: `.agent-work/flood-slow/arm3`.

The runner `cancelRequested` flag fences every stop, including system failures.
The backend incorrectly ORed it into the public user-cancellation flag. Dispatch
observations now retain the remote fence only in the attempt snapshot; public
user intent stays backend-owned. Pure snapshot merging remains unchanged.

Migration029 atomically replaces only the source and source-free finalization
views. Applied migration SQL, persisted rows, immutable receipts and charges remain
unchanged. Verified OOM has memory-limit precedence. Verified wrapper system
reasons timeout/output_limit/artifact_incomplete/clock_integrity remain errors,
including a later user request. Unknown physical exit facts remain pending.
Otherwise the existing durable-user-cancellation precedence is preserved.
Validated source-free proofs use the same system-cause rule after existing scope,
sequence, release, event and custody gates. No missing proof becomes success.

Twelve new regressions failed before the correction. The affected storage plan
then passed157 tests across14 files in48.73s, including both finalization paths,
real worker cancellation ordering, native insertion guards, scope/custody checks,
unknown exits, OOM, replay, populated schema28 preservation and rollback. The
updated observation/version tests retain their original chronology/atomicity gates.
Independent review found no remaining blocker. Static checks are recorded with the
integration commit; these local checks do not replace a new packaged candidate.

Existing historical public flags may already conflate system/user stops. The
migration does not infer their original intent or rewrite historical projections.
A matching new candidate still needs native qualification before this correction
is claimed as packaged behavior. Legacy/default images are unchanged.

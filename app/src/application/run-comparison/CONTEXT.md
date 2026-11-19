# Run comparison use case
Public createRunComparisonService accepts scoped run/result/revision readers, shared
metric lookup and digest provider. compare returns the ACTUAL original promise;
HTTP owns its fast cancellation race and retains that promise through settlement.
One active comparison, no queue/cache, whole 30 s context. Close fences and drains.
Capture2..4 distinct canonical terminal runs, immutable config pins and sealed
result scopes. Reconcile full Run, full revision and result-seal identity after IO.
Configs remain transient <=1 MiB each; only the matched SLO limit may leave.
Optional SLO rows (<=256) and firstFailedSlo use native facts and unique rule matches;
metric/stat mismatches keep the limit unknown. No extra IO or native regrading.
The unchanged 262144-byte cap can omit optional detail to preserve required data.
Shared k6 schema/layout maps baseline aliases through stable request/assertion IDs;
peer lookup must return the exact remapped series identity, not merely a matching
kind. Missing input, missing points, source absence and missing results differ.
Metric archive parsing/projection/native custody remain in run-metrics.
Fingerprint target, inline/uploaded inputs and secret references only; never resolve
secrets or infer target revision/contention. Shared contracts own warning/diff facts.
Equal revision pins skip diff traversal only after canonical content equality.
Other config diffs cap 65536 visited/4096 pending pairs,depth 64,100 pointers and512
encoded bytes per pointer; limits become explicit root/parent limited changes.
Output schema, semantic binding and262144-byte encoding all validate before return.
No tables, writes, engine/target calls, retries or raw exceptions in DTOs.
Checks: app/test/run-comparison and http/run-comparison; affected metric lifetimes,
bootstrap comparison composition, Node types/lint/architecture/docs.

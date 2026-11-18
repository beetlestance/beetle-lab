# Target sample recording

Public entrypoint: TargetArchive and its prefix/options types in index.ts.
Input: trusted admitted root/UID/scope/interval/allowance/check, validated samples.
Output: immutable completed prefixes for target-samples.ndjson, no sealed artifact.
The file starts with a versioned scope/UUID/interval header and appends sample
records with contiguous sequence numbers. Every line includes its newline in the
prefix length and SHA-256. Samples are detached before asynchronous work begins.
One write original at a time; concurrent intake refuses busy without a queue.
At most 256 samples, 1 MiB, 16 KiB per record, <= 64 KiB positional native writes.
Bytes are reserved before issue and failed/partial writes stay charged. A prefix
advances only after a whole line completes; an in-flight write keeps the old one.
Fence/failure/close withdraw prefixes. Close drains issued originals, then closes
all retained handles; failed close remains failed. No per-sample sync, retry,
unlink, background loop, retained sample corpus or authority over sealed reports.
AppendFiles owns the same fixed-file native custody as the metric archive.
AttemptTarget wires recording after the measured transition, carving 1 MiB from
the admitted output/execute allowance. Approved live frames may carry its prefix
inside the metric archive hint. Native target backfill remains unwired; the final
target-runtime.json format and sealed authority are unchanged.
Focused checks: vitest run engines/k6/wrapper/target-archive
and engines/k6/wrapper/target-sampling/recording.test.ts.

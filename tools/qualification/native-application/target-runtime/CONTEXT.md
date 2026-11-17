# Native target observation parity

Verified source images, one owned synthetic target/attempt. Stock runtime controls.
40work requests with 100 ms wait plus 3 s cooldown; one sampler request per second.
The target returns fixed known/zero/missing/invalid fields, one invalid JSON and
one HTTP503 sampler response. Work assertions still pass. At most 32sampler reads.

Hash/length-verify the target-runtime artifact, decode with the shared strict
codec and assert fixed values/nulls, before/during/after, missed2 and fixed reasons.
Target-reported scope is distinct from engine enforced controls; private/thermal
extra source fields must not be retained. No fabricated sensor or engine values.
This is native artifact acceptance; real-browser target view/heuristic acceptance
and broader sampler fault/limit/cancel cases remain separate.

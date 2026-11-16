# Native environment and mounted secrets

Verified source images `b48936d870f7e500d3b6c3f91a17eb5a267904ed`, native Linux ARM64,
Node24.22.3. Frozen trial3 passed in59.048s; normal and independent cold cleanup
both returned0. Private evidence: `.agent-work/native-secrets`, plans, source
hashes, all attempts and stopped-journal copy. No external credentials or targets.

The ordinary packaged installation starts with its original immutable config and
receipt. An explicit operator override copies that config into a private UID1000
file and adds exact organisation/workspace/name/provider/reference/version bindings.
One value comes from a named environment variable; another comes from a private
read-only mounted file. The default config hash stays identical across rebindings.
No installer receipt or serving metadata is rewritten.

The synthetic target compares hashes of both received headers and never echoes
them. The initial run passed three physical requests. A different workspace using
the same names/versions failed `setup_failed`, created no managed engine and made
no extra readiness or workload requests. Changing only the private binding scope
made that same workspace/revision pass three requests. Total:2readiness,6work,
0rejected requests. This counterfactual supports the scoped binding interpretation;
`setup_failed` alone is not a specific secret-provider diagnosis.

Both successful runs downloaded/hash-verified all eight artifacts. Raw canaries
were absent from those16downloads, public terminal/result envelopes and the seven
bounded service log tails. The two engine containers use the shipped Docker
`logging=none`; those unavailable streams are explicitly counted, not audited.
No claim covers every persisted file, export, UI surface, encoded transformation,
future plugin or third-party target that might return credentials in its response.

All originals request32MiB output each, retaining at most96MiB within the stock
128MiB pool. CPU1/memory512MiB/PID128, installation ceilings and all gates stay
unchanged. The denied preparation still retains its disk hold. Trial1's stopped
journal demonstrates two retained64MiB holds; execution release is not a refund.

Trial1 failed51.683s when the qualifier tried to read deliberately disabled engine
logs. Trial2 failed126.633s on a single rebound createRun503 after agent restart.
The corrected qualifier waits for identity-bound agent capabilities and fresh
settings through bounded GETs before mutations. It does not retry mutations.
Both failed trials retain their original reports and verified cleanup.

Remaining: native AMD64 secret qualification, other scope/version negatives,
private-file alias/size matrices beyond existing provider tests and wider leakage
surfaces. This is scoped env/mounted acceptance, not full Q06 or security closure.

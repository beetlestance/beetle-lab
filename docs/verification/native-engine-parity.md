# Native executor and outcome parity

Scope: owned synthetic packaged k6 execution on native Linux ARM64/Docker Desktop,
Node24.22.3 observer. Runtime images are the verified23bb8c82 source archive from
CI43756923411, not a new publication. The archive SHA256 is
`3bb63ef544bb9b97522d863ae8433786836c09cf152aa12905e38afa09439c4a`.
Role config/OCI-manifest identities are checked before Compose effects.
Compiler/runtime/result sources, contracts/engines, lockfile and Compose are
unchanged between23bb8c82 and harness base5a15a8e0; the later private V2 live-wire
compression is outside this evidence. No V2 stream acceptance follows.

## Frozen fixture

Each of three fresh installations retains at most two runs. Shipped agent pool,
1CPU/512MiB/PID128 engine controls, output guards and runtime defaults are unchanged.
Only an owned target has an extra dynamically selected loopback port. Its eleven
known work routes cap128 requests each and512 in total; unexpected routes fail.
No external target or credentials. Outer deadline600s, each run90s/200 bounded
public polls, target reads4096 bytes. Public mutations are never retried.

The ordinary run uses all six executors together, bounded two-second duration
executors and small finite iteration counts. One scenario starts one second later.
Separate runs exercise reached/exhausted discovery, ordinary SLO failure, HTTP500
required assertion failure and connection reset. ADR011 defines transport failures
as skipped/unknown assertions, not failed assertion evaluations.

## Recorded native results

| Profile | Result | Execution evidence |
| --- | --- | --- |
| Ordinary + reached discovery | Passed49.288s | Six routes:4/2/20/20/3/6 physical requests; delayed first request1002ms later. Ordinary exit0/passed; discovery exit99/passed with reached=true. |
| Exhausted discovery + SLO | Passed49.415s | Discovery exit0/inconclusive, reached=false; ordinary SLO exit99/failed with native failed verdict. |
| Required assertion + transport | Passed46.426s | HTTP500:3 requests/3 required failures/0 transport failures, failed exit99. Reset:3 requests/0 required failures/3 transport failures, inconclusive exit0, one unknown required definition. |

All three completed profiles passed normal and independent cleanup. Engine inspection
confirmed stopped originals, expected generation/image and advertised hard caps;
no OOM flag. Target readiness occurred once per run and unexpected count was zero.
These prove real executor use and scoped offsets, not precise arrival scheduling,
statistical load accuracy, every graceful-stop race or performance at large VU counts.

The first failure profile was refused40.846s: the qualifier incorrectly expected
connection reset to produce failed assertion outcome. Runtime returned inconclusive
as ADR011 requires. The preceding HTTP500 case passed its failed/exit99 oracle;
normal and independent cleanup both passed. The corrected qualifier retains native
run/result evidence before asserting verdicts and checks a hash-verified native
summary <=1MiB for distinct transport/required-failure totals. This correction
changes no runtime result, resource limit or supported outcome semantics.

Two schema/outcome fixture tests, Node types, lint, architecture and docs pass.
Independent review corrected the owner descriptor before native effects and cleared
the outcome/counter correction. The [AMD finite profiles](native-source-conformance.md) subsequently passed these three cases on verifiedb48936d8 images. [Request/data/assertion evidence](native-request-data.md) and [ARM secrets](native-secrets.md) remain separate. This packet does not close target observers, flood, soak, every boundary or all A04/A07.

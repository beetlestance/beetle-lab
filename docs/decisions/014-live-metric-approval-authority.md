# Decision014: live metric approval authority

Status: shared policy/assignment implemented; actor/private transport wired; backend wired; browser/activation pending.

A frame's subset digest proves consistency, not permission to choose descriptors or
an epoch. Generic readers require trusted expected scope/epoch/subset; never learn
approval from the first frame or an image's self-declared output.

The existing pure k6 label/catalogue rules now live in a Node-free shared engine
contract, reused by compiler/parser and the installed policy owner. Validated raw
config and compiled input preserve request/assertion order, IDs and counts; no
readiness assertion is invented. Compilation, datasets, secrets and threshold
validation stay engine-owned. The generic agent consumes a policy capability.

A shared assignment derives a UUID from canonical scope/generation, intent digest
and exact runtime spec digest under a versioned purpose. Staging already writes
RuntimePlan.specDigest into the readonly StagedAttempt, so producer and approver
independently possess the same trusted inputs. No new channel/credential/sidecar or
wire field is required. Image/manifest digests are not interchangeable with spec.

The deterministic UUID identifies one logical producer; it is not authentication.
Durable single-start/control-journal fences must prohibit replacement under the
same launch identity. Any permitted new producer needs a new generation/identity.
Golden vectors pin policy behavior; incompatible changes require a new version.

Both sides freeze the same approved subset before native effects. Latency, errors,
throughput and load receive default priority under the unchanged20-series cap;
omissions remain explicit. Keep profiles off until actor authorization, authenticated
routing, consumer ownership and native end-to-end qualification are connected.

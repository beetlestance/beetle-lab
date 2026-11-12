# Native live metrics

Status: native Linux arm64 completion and cancellation verified.

Current production Dockerfiles built task-specific agent/k6 images. An authenticated
public API run exercised actual k6 execution, the private tmpfs mailbox, bounded
Docker archive read, trusted agent approval, scoped backend reconciliation and
public snapshot codecs. One VU made20 work requests plus one readiness request;
no unexpected target requests. Four observed publisher revisions contained15–17
series from the admitted20-series subset, then switched to a sealed passed result.

Verification checked all four published artifact files/hashes, contiguous durable
events/ACK, final receipt and independent storage accounting:75,033 retained bytes,
16,702,183 refunded bytes and140,569 charged bytes including metadata. Task
containers, networks and the guarded128KiB/four-inode mailbox volume were removed.
Cancellation after two native revisions also passed: public state became
cancelled/inconclusive, subsequent live reads returned503, the actual engine was
stopped without OOM, and matched execution/event charges were released. The engine
did not seal a result; no output source/finalization was invented. Its16,842,752-byte
output allocation remains retained for the separate publication/retention owner.
Both task runs cleaned their containers, networks and mailbox volumes.
This is functional evidence, not an overhead measurement or release qualification.

Native work exposed two integration faults. Docker reports the named-volume
summary mode as z; inspection now accepts that exact labeling metadata while
retaining requested NoCopy, name/driver/RW, ownership and tmpfs-option checks.
Docker documents [SELinux volume labels](https://docs.docker.com/reference/cli/docker/container/run/#mount-volumes-from-container---volumes-from).
Small native metric chunks also waited for the full64KiB read size. Available
bytes are now delivered immediately under the same cap and single awaited sink;
a regression failed before the fix and51 affected process cases passed afterward.
This follows [Node readable.read semantics](https://nodejs.org/api/stream.html#readablereadsize).

The qualification checker was updated from a historical two-artifact assumption
to the sealed contract's128-artifact cap, exact inventory count and per-file hashes.
Failed fixture/checker attempts remain recorded separately. No user services were
restarted. Browser, native amd64, Compose, resource abuse, crash recovery and
sustained overhead qualification remain outside this proof.

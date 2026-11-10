# Backend capacity publication loop

Status: implementation contract. [Connection](backend-connection.md) owns actual
agent/disk sampling; [capacity wire](capacity-wire.md) owns original source leases.
The loop owns scheduling and publication into the existing SQLite capacity cache.

## One original iteration

startRuntimePoller({source,publish,intervalMs?}) starts one immediate asynchronous
iteration. Default interval250ms, allowed25..60000ms. Schedule the next tick only
after the original sample and original publication settle. No overlapping calls,
waiting queue, detached retries or Promise.race drainage. Capture port methods and
configuration once. Bound private observation copies to64KiB before publication.

RuntimePublisher returns true only for accepted cache publication; false is an
explicit observation refusal. The concrete SQLite bridge maps invalid_input and
invalid_value to refusal for nonnull observations only. These can occur when an
original source expires between sampling, ingress and worker dequeue. Other errors
propagate. A false revocation is a failure, never successful unknown publication.
The bridge never retries a mutation or replaces original timestamps.

After a null source or refused observation, publish null once if the previous fact
was accepted. Further unknown ticks perform no null writes. This preserves the
first revocation fence rather than advancing it beyond every new producer cycle.
The initial cache is unknown; a source predating bootstrap may be refused until
a genuinely newer source arrives. Such refusal remains visible, not published.

The status is published, unknown, failed or closed, with a bounded reason enum and
an in-flight flag. Published describes the last acknowledged write, not current
capacity or permission to dispatch. SQLite independently enforces source expiry
and the agent remains final physical admission authority. No credential, path,
exception message or measurement value enters this diagnostic state.

Unexpected sampling/publication exceptions fence further ticks and retain the
original failure. No success is fabricated. close subsequently rejects with that
failure, preserving a simultaneous source-close failure in a bounded aggregate.
A source returning null is ordinary unavailable evidence, not an exception.

## Delivery composition

agent-owners.ts shares one gateway between capacity and the delivery loop. A fatal
producer exception stops delivery synchronously without awaiting that child from
inside its producer. A captured synchronous failure notification also covers
poller-local bounded encoding/freezing errors; it cannot return a Promise.
Notification exceptions are retained with the original failure. Both drains remain owned; published status cannot
hide the failure. Metadata publication failure retains the original error and
lease expiry rather than retrying a positive mutation. Delivery failure fences
new positive publication, drains the poller and its pending write, then publishes
null once; a failed revoke is retained, never advertised as durable revocation.
The failure callback cannot await delivery/composite close, which would await itself.

## Shutdown

close fences new iterations, clears its own timer and aborts the active source
signal. It starts source.close and waits for both the active iteration and original
source close. An in-flight publication remains owned until its original result.
A result arriving after close cannot publish a new known fact or schedule a tick.
Repeated close returns the same original promise, including rejection. The source
is owned here; the shared gateway is closed separately after this loop drains.
Metadata must remain open until the loop finishes its original publication.

Acceptance: no overlap under slow source/publisher; repeated unknown coalescing;
initial/refused old frame then genuinely newer recovery; private copies; rejection
and unexpected errors; held sample/publication/source close after abort; reentrant
close; stable close failure; no timer or publication after closure. Real SQLite
queue expiry and executable bootstrap wiring require integration evidence too.

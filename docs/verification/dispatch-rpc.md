# Durable dispatch storage and metadata RPC

Status: locally verified private storage/worker boundary. The installation-owned
agent delivery loop and complete execution path remain pending.
SQL correction source: `948c3ab9a789cf1c3689c55726b397eaf7343b73`.
Integrated full-gate source: `f8b54c1d5e24d781735de9361f0b29fbe873adef`.

## Behavior

Metadata.dispatch now exposes bounded scan/readOffer/claim/observe through the
actual compiled SQLite worker. Discovery uses compact indexed facts, captured
finite cursors and the same eligibility owner as authoritative claims. Each new
claim reserves original logical execution cost and output allowance before marking
possible delivery. Matched observations acknowledge/project/release atomically.
Replay retains the original identity, Offer, cost and first-delivery mark; capacity
or registry drift cannot manufacture absence or release retained output storage.

Current total/per-run/profile/staging ceilings, shared input/output storage and
isolation barriers are checked in the immediate claim transaction. The original
runtime observation identity/lease is rechecked after writes, before commit.
Pending discovery is bounded before interpretation at 4,097 rows and charged
ownership at 65; overflow fails rather than silently truncating fairness/evidence.

Both worker producer and parent consumer validate bounded closed values and exact
identity. Suites and original Offer reads share the existing TWO large originals;
no second pool was introduced. Failure fences intake and retains pending ownership
until termination. Close drains FIFO work; close/abort share native termination.

Independent review found an original-Offer carrier bug: adding the response wrapper
reapplied the generic 65,536-node limit to an already-valid original. Normally
accepted 65,528/65,536-node Offers reproduced it; identical regression bytes and
stored originals passed after the single fixed-carrier owner was introduced.
Original JSON byte/node/depth/collection limits were preserved. The carrier adds
nine nodes/one depth, rather than escaping JSON or widening the generic codec.

## Evidence

Independent SQL/resource, query/Offer, RPC boundary and lifetime source reviews
found no remaining blockers in these components. A weak lifetime oracle was
strengthened: the same test fails under test-only early credit erasure and passes
normally, asserting two retained originals before termination and none afterward.

Focused checks covered actual SQLite claims, quota/fairness, rollback, maximum-node
originals through SQL/worker/parent, reopen/replay with unknown capacity, shared slot
saturation, pre-capture refusal, malformed replies, safe wire-ID exhaustion and
held termination. Existing worker/suite/run/input/runtime regressions also passed.

The full `NODE_OPTIONS=--max-old-space-size=1024 npm run verify:v2` exited 0:
3,820 tests/359 files; test phase 452.99s. Contract/API/k6 generation checks, all three
type targets, lint, architecture 1,088 sources, docs 174 pages and frontend build
passed. The existing 609.69kB frontend chunk warning remains.
Node24-target backend bundles built. Compiled API and input-controller smokes passed
pairing, authoring, unavailable enqueue/scoped reads, input publication/deletion,
lost create/chunk/seal replies, identical replay, downloads, logout and SIGTERM.

## Limits

Host: Node26.7/macOS arm64 with synthetic data and local fixtures. Fake worker tests
establish selected original-call/failure behavior; native IPC is not a hostile-code
sandbox. Slot counts do not establish exact resident-memory or performance bounds.

These checks do not demonstrate backend-to-agent PUT/lost-reply/restart delivery,
a completed load stream, durable event ingestion/ACK, artifact transfer or terminal
result finalization. Native Docker/Compose, amd64/arm64, supply-chain, backup and
resource/soak qualification remain. The released default application is unchanged.

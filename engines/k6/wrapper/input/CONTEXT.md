# Engine staged input

`openStagedInput(options)` returns `{result, quiesced}` for bounded Node header IO.
Trusted packaging supplies explicit canonical read-only roots, owner UID, installed
k6 engine/version/configVersion/schema identities, signal and headerTimeoutMs.
The 1..60,000 ms opening ceiling bounds IO before metadata exposes the admitted
deadline; it is not execution admission. Optional expected staging pins must come
from trusted launch authority. Offer/staging cross-bind scope/intent and raw hashes;
generation/spec are asserted by trusted staging and optionally compared with pins.
Offer raw bytes pin config identity; no independent journal authorization is proven.

The header result exposes frozen offer/manifest/staging and a managed AttemptBudget.
Header IO reads only staging.json (64 KiB), offer.json (1 MiB), manifest.json (64 KiB),
then bounds exact directory entries and stats secret files (64 KiB each/1 MiB total).
Secrets are never opened, read, hashed or logged. The unchanged pure secret bridge
preserves opaque references/declared versions and checks their exact config set.

Call `compile()` once, after initializing the control journal. Its `{result, quiesced}`
loads inputs sequentially (8 MiB each/32 MiB aggregate, 64 KiB descriptor reads),
checks raw size/hash/fatal UTF-8, validates config/secret references and invokes the
existing suite compiler once. Unsupported input URNs retain their wire spelling
and fail compiler validation. Typed failures contain only safe bounded codes/paths.
No readiness, native process, target traffic or reservation release occurs here.

The absolute admitted deadline includes staging/compile time. Wall rollback/invalid
clocks, monotonic expiry, abort and close fence further IO and result publication.
Synchronous compiler work is fenced before/after; it cannot be preempted in-process.
`close()` caches its original outcome; failed close cannot become eligible success.
`quiesced` waits for every issued operation and original close; failed close rejects,
and unresolved kernel IO remains pending. Cancellation/deadline result can precede it.
The trusted immutable mount profile is required: identity checks cannot guarantee
isolation against hostile same-UID concurrent directory/mount replacement. Offer
and manifest image agreement does not independently establish this container image
or agent-enforced controls. Narrow IO lifecycle tests mock Node filesystem calls.

Focused check: `NODE_OPTIONS=--max-old-space-size=1024 node node_modules/vitest/vitest.mjs run engines/k6/test/staged-input --maxWorkers=2`.

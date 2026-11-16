# Private native summary collection

`readK6Summary` accepts a compiled suite, trusted private output directory and UID,
owned process observation, absolute attempt deadline and operation timeout (1–30000ms).
Only spawned, stopped, group-absent, closed-stdio, quiescent observations allow IO.
It returns `result`, `quiesced` and idempotent `close()`. Cancellation/deadline may
settle result before IO finishes; quiescence waits for issued work and original
descriptor close, rejecting on close failure. Callers retain that evidence.
Final budget checks run in result-publication continuations, including after
quiescence callbacks, for both successful and failed summaries.
Original close failures remain explicit; cancellation takes precedence.

Options and process observation are captured synchronously before external clocks
or IO callbacks. The compiled suite is a trusted immutable reference. Capturing
admission evidence prevents later replacement from admitting an unknown process
or upgrading partial collection; it does not authenticate process ownership or
prove resource controls.

Only `beetle-evidence.json` is read, with no writes or removals. Directory custody
must remain immutable after process stop; same-UID hostile replacement is outside
this adapter's guarantee. File reads use no-follow/nonblocking open, regular-file,
owner, permissions, single-link, identity, size, timestamp and repeated-hash checks.
Raw input is <=1MiB, <=64 reads, 64KiB windows; JSON is depth64/nodes65536 and each
collection <=4096. Typed output contains approved numeric stats and exact native
threshold expressions only. Strict v2 validates shared native keys, scope and
denominator provenance and closed nullable native engine duration; v1 is rejected.
Missing values and null verdicts remain unknown. Execute counter rates retain
the native whole-engine duration; gauge/health roots remain engine-scoped.

SHA256 binds raw bytes only. Partial native collection remains partial. This API
does not authenticate an attempt, classify outcomes, seal results, publish
artifacts or authorize reservation release. The public wire contract is unchanged.

Focused checks: `NODE_OPTIONS=--max-old-space-size=1024 npx vitest run engines/k6/test/collection --maxWorkers=2`.

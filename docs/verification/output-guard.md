# Output guard evidence

Date: 2026-11-09. Integrated source: `62b1991`.
Reviewed watch-service source: `d96c405` (integrated correction `7e08f6b`).
Environment: Node26.7.0/macOS arm64, actual temporary filesystem and SQLite.

## Implemented path

The scanner derives output authority from a verified installation root, genuine
RuntimePlan, scoped identity and exact user/mount/labels. It streams directory
entries with fixed depth/path/call/entry bounds, checking custody and counting
logical bytes, allocated blocks and directory allocation. Pending dotfiles count.
Live growth/truncation is permitted; incomplete or transient renamed-file observations
never return partial known aggregates. Available filesystem bytes enforce a reserve.

Two original scans run process-wide. Abort/deadline retains issued operations,
including late opens and their closes. Each close is attempted once; failed close
owners remain in a bounded quarantine with their slot, rather than becoming reusable.
These are metadata observations, not immutable content verification or a linearizable
snapshot of a malicious concurrent writer.

One watch service owns up to64 registrations, a completion-driven fair two-slot
pump, busy backoff and independent freshness watchdog. Scan start time owns freshness;
held/unknown scans cannot renew it. Initial expiry resolves false while originals
remain owned. Per-watch limits, shared disk breach and unsafe/stale inspection use
typed system stops. Watch/service close fence callbacks and drain independent
scan/stop originals; failures stay visible and refuse clean close.

The public factory binds the actual scanner. Installation watches attach after
quiesced staging or exact recovery, before launch. Failed fresh setup creates no
runtime. Claimed recovery failures persist an owned system stop and reconcile,
including when a separate stop callback was rejected. Retirement drains the watch.

## Reviews and corrections

Contract review required initial registration-age expiry and completion-driven
fairness rather than launching only two watches per polling interval.
Service review reproduced unbounded descriptor capture before its field cap. The
correction selects fixed known fields without arbitrary-key enumeration and bounds
reentrant watch intake. Unknown private fields are ignored without observing them;
known accessors still fail. Five independent final lifecycle/capture probes passed.

Scanner review reproduced copied RuntimePlan prototypes passing instanceof checks.
Plans now have a process-local WeakSet brand, guarded construction token and actual
private factory. Docker, supervisor and controller boundaries reject forgeries.
Independent checks rejected prototype clones/proxies/reflective construction and
passed real plans, allocation/disk equality, path bounds and late-close fencing.

Attachment review independently passed four registration/recovery/failure probes:
no fresh launch after registration failure; claimed work stops with no restaging or
second execution after failed registration, closed guard or rejected stop callback.
Controlled lifecycle fixtures also cover readiness, cancellation before readiness,
held cleanup, reentrant close and failed cleanup ownership.

## Executed checks and limits

`npm run verify:v2` exited0 on the exact source: **2412 tests/209 files**, three
TypeScript projects, lint, generation37/23/6, architecture694, docs109 and frontend
build. Its existing611.56kB/178.59kB gzip main-chunk warning remains. The combined
focused guard/scanner/installation/HTTP run passed84 tests/12 files.

The HTTP composition now uses real catalogue/schema, SQLite, Stager, output guard,
controller and output verification for manual/scheduled completion and live output
overflow. Overflow produces output_limit, kill and release through a controlled
Docker backend, with one execution. Capacity, supervisor time and signed engine
production remain synthetic. Its frozen clock initially prevented strict post-launch
release evidence; advancing that fixture clock fixed it without relaxing production.

No real Docker build/run, native stop latency/overshoot, full-pool workload, timeout
watchdog/freshness publisher, bootstrap, hosted CI, scans, backup or soak is claimed.
Serial runtime/journal work and one-shot stop rejection still require qualification
and reserved service capacity or reconciliation. This is a soft guard, not a portable
quota or filesystem-exhaustion guarantee. Application artifact/finalization and the
rest of R0-R4 remain. No publication, deployment or protection change occurred.

# Hosted CI fixture corrections

Baseline: 88d4322. Hosted run 43638514301 at 129eb63 passed source checks and the
legacy container smoke. All six unit shards failed; native jobs were skipped.
Failures and raw job logs are retained. No hosted green claim follows from local
corrections or a passing source job.

## Corrections

The backend smoke now explicitly initializes installation-owned recovery control,
matching normal setup. The old fixture omitted that required file. Its local smoke
failure reproduced; the corrected API/input smokes passed, followed by hosted source
success. Backend recovery still fails closed when control is absent.

Fourteen test/probe files used macOS-only `/private/tmp` parents. They now use the
platform temporary directory after canonicalization. Intentional invalid-path
refusals, exclusive publication and custody assertions remain unchanged.

The metric-point fixture recompiled a complete suite/profile for every point in
the 10,000-point bounded-stream test. It now reuses the same fixed immutable profile
while still copying tags per point. Point count, decoder path and all memory/count
assertions remain unchanged; the local stream case took about 166 ms.

Final-slot capacity setup previously took 17.172 s locally and exceeded its 20 s
bound on Linux. All 4,095 offers/admissions/aborts still execute through the real
AdmissionStore and guards. An in-memory setup is copied using SQLite backup before
the real durable Journal races two admissions and an exact replay. The 4,096 hold
count, retained charge and replay assertions remain; the test bound stays 20 s.
This is concurrency evidence, not crash-durability evidence for each setup row.

## Scoped local evidence

Affected engine fixtures: 308 cases passed. Remaining hosted-failed runtime cases:
11 cases passed. The retention setup change then passed its two affected cases;
the final-slot case took 15.441 s. Original-offer and scheduled-release failures
were not reproduced locally and still require hosted confirmation.

Independent review found no weakened assertion or manufactured row/guard proof.
Types, lint, architecture, documentation and actionlint are checked separately.
No product operation, guard or global test deadline is extended.

## Native scheduling and retained outcomes

Native images now start after source checks, alongside unit shards on separate
hosted runners. Required `ci/container` additionally depends on `ci/checks`; it
requires source/unit checks, legacy smoke and both native architectures to succeed.
All 64 status combinations of the actual three-input aggregate shell script were
checked; only success/success/success passes. Legacy publication remains unchanged.
Only a closed native outcome projection is uploaded and printed. Raw assertion
messages/stacks stay in private evidence; a real failed-session assertion test
proves its token canary cannot enter public JSON. Installation files, credentials,
logs and caches are excluded. Review caught the earlier unsafe raw upload proposal.

Hosted native execution, the output-guard failure, the newer candidate's public
poll timeout, browser acceptance and registry delivery remain separate open work.

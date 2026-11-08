# Agent executable and provider evidence

Date: 2026-11-09. Integrated source: `91ec376`.
Host checks: Node26.7.0/macOS arm64. Image checks: Node24.22.2/Linux arm64.
No hosted CI, publication or deployment is claimed.

## Implemented boundary

The executable loads bounded private installation JSON and credential files,
registers the shipped k6 schema and installed catalogue, opens real input/secret
providers and connects the Unix Docker transport to the installed runtime. Startup
checks daemon identity and engine image ID, environment, architecture, runtime and
inherited volumes through read-only inspection. It never pulls or selects a tag.
Signal shutdown retains original startup work and independently drains both owners.

Providers stream namespace-scoped input bytes and resolve explicit environment or
mounted-file aliases. Private-file custody, two global file leases, lazy streams,
original-call retention and failed-close ownership are implemented. The Stager
retains responsibility for declared byte count and digest verification.

Actual Stager integration exposed copied, unbound provider methods. The correction
binds the captured methods to their service owner. Another correction distinguishes
a known completed native close followed by failed custody verification from an
unknown native close: failed input verification still rejects, while known cleanup
can drain. Failed native close remains retained and cannot authorize quiescence.

## Independent review and integrated checks

Provider review verified 30 frozen reads, passed 20 existing tests and two independent
probes, and found no blocking issue. Probes covered a held late open through service
close and known native close followed by named-file disappearance. Type/lint passed.
Coordinator matched 25 final provider source/spec/test hashes.

Executable review verified 39 frozen reads, passed 55 focused tests and one independent
late-deadline image-inspection probe, and found no blocking issue. Coordinator matched
36 repository source/spec/test hashes; the remaining reads were private task context.
Neither review claims native engine execution or release qualification.

`NODE_OPTIONS=--max-old-space-size=1024 npm run verify:v2` exited 0 on `91ec376`:
**2,511 tests/220 files**, all three TypeScript projects, lint, generation37/23/6,
architecture737, docs121 and frontend build. Tests took115.48s. The existing frontend
main chunk warning remains611.56kB/178.59kB gzip. This page was added afterward and
received the documentation gate separately.

## Executable and image smoke

`npm run build:agent` bundles main.js and its SQLite worker together.
`npm run smoke:agent` passed on the host against an owned real Unix HTTP socket
serving synthetic daemon responses. It exercised private configuration/providers,
authenticated capabilities, unauthenticated rejection, SIGTERM exit0 and rejection
of a public-readable credential with exit1, without printing credential bytes.

`agent/Dockerfile` built locally for linux/arm64 from `91ec376`, with locked
dependencies and pinned base images. The daemon's API1.47 image inspection returned
`sha256:11bf1813671a5e680a05f53e3f7ef37f5bfaa769916b8a4ae463c3aa2eebfc0f`.
The configured user was1000:1000 and the source revision label matched.

The same smoke ran against the packaged main/worker under Node24.22.2 inside that
image: one CPU,512MiB RAM,128 PIDs, read-only root, dropped capabilities, no external
network and task-owned tmpfs. No daemon socket was mounted. Its Unix daemon fixture
ran inside the same container. Exit0 and removal of the owned container were checked.
Test harness files were mounted separately and are absent from the production image.

## Remaining qualification

These checks performed **zero agent-controlled real engine executions**. Synthetic
daemon totals are fixture inputs, not measurements of available host/VM capacity.
Actual daemon image/container identity binding, cross-container staging visibility,
k6 execution and collection, Compose installation, native amd64, full-pool stop
latency, overhead, resource abuse, irreversible recovery, artifact finalization,
scans, backup/restore and soak remain required. Successful capabilities are not
evidence that the complete product submit/observe/finalize/replay path works.

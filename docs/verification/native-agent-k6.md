# Actual agent-controlled k6 execution

Date: 2026-11-09. Agent source: `73c4c1a`; staging correction: `e1635bc`.
Engine recipe/build source: `393eef2`. Local Docker Desktop, Moby29.9.2,
Linux arm64; daemon VM reported10 CPUs and approximately12.5GB RAM.
No hosted CI, publication, deployment or complete application acceptance is claimed.

## Exercised path

A local qualification harness created a fresh private installation tree, separate
agent and HTTP target containers, and one internal network. The agent used the real
daemon Unix socket; the target and engine received no daemon socket. No host ports
or external HTTP targets were used. Private credential/config/input/journal mounts
were siblings of staging. Staging used the same absolute host/agent path with matching
nonroot UID:GID; Docker Desktop bind visibility was exercised through actual k6 reads.

The packaged Node24 agent loaded its real configuration, shared k6 schema, catalogue,
providers and SQLite journal. Authenticated private HTTP accepted the offer; the
scheduler admitted it against actual daemon/resource observations. The real Stager,
DockerBackend and Supervisor created and started the engine. The engine compiled
and ran actual k6 requests, published control/result files, and the agent collected
them. No injected observation, synthetic engine result or manufactured seal was used.
Qualification requests used an internal Node client through Docker exec; the product
backend-to-agent client and Compose installation are still required work.

## Results

Each case used one VU, one iteration and one readiness request, with30s attempt
timeout and16MiB output allowance. Readiness was excluded from measured HTTP counts.

| Case | Result/native exit | Wrapper container exit | Summary/numeric bytes | Reservation |
| --- | --- | --- | --- | --- |
| HTTP200, required200 | passed/0 | 0 | 7,771/3,398 | released |
| HTTP500, required200 | failed/99 | 0 | 7,846/3,406 | released |

Both cases had measured HTTP count1 and one required assertion, with zero unknown.
Each control file contained11 contiguous events and all five phase finishes.
The result content seal matched the actual file and private API result. Both declared
artifact lengths and SHA256 values matched actual bytes; artifact files had0600 mode,
one link and the configured nonroot owner. Inspection verified actual engine identity,
exit0 and no OOM. After agent shutdown, a separate read-only SQLite connection verified
completed launch settlement, finished collection and released reservation.

Actual engine inspection matched one CPU,512MiB RAM,512MiB combined memory/swap,
PID128, read-only root, dropped capabilities, no-new-privileges and approved mounts.
These checks establish configured controls and profile matching, not resource-abuse
or latency guarantees. Task-owned containers and networks were removed; subsequent
label-filtered queries verified no resources remained for either successful case.

Agent image ID:
`sha256:b699f2ec64f25a3f4881fada030ab808c17a27daafc47ac2fe7a72f48652f87a`.
Engine image ID:
`sha256:dde928653dbcaa6ffe98bcd614bbbcef97d0827c3ea684d2c3e16a5f16bdcc1e`.
API1.47 image/container inspection confirmed the local identity relationship.

## Corrections and review

The initial native run stopped before engine creation: a writable0400 creation
was reported as0600 by Desktop. A dedicated native probe reproduced it. Staging now
creates/checks0600 while writing, then descriptor-chmods/checks0400 before fsync,
close and publication. It rejects permission changes during streaming. Final input
and secret permissions remain0400. Independent review passed21 focused tests.

The next run produced a valid passed seal but retained its charge: strict inspection
rejected OomKillDisable:null. Only that nullable field differed from an accepted
profile. The correction accepts false/null as enabled OOM killing; true, missing and
malformed values still reject. Independent review passed30 tests and checked the
[pinned Moby resource adaptation](https://github.com/moby/moby/blob/v28.2.2/daemon/daemon_unix.go#L441-L448).
Both corrected native cases above then reached actual durable release.

The complete gate on73c4c1a exited0: **2,519 tests/220 files**, three TypeScript
projects, lint, generation37/23/6, architecture737, docs122 and frontend build.
Tests took115.34s. Subsequent evidence-only changes passed the documentation gate.
The existing frontend611.56kB/178.59kB gzip main-chunk warning remains.

## Limits

The checked-in `smoke:agent:docker` command (`4cd5670`) now reproduces these cases;
see [developer instructions](../development.md). Coordinator ran both200/500 cases
on its final source with the existing images above; both checked clean agent exit,
durable release and current owned-resource absence. Independent review matched
14 frozen reads, passed Node types/lint and six synthetic helper probes, with no
blocking finding. No delayed daemon-create-after-CLI-timeout fence was qualified;
cleanup inventory queries alone cannot establish future absence after unknown work.
This covers two normal workloads without datasets or secrets. Native amd64, Compose,
restart/power loss and irreversible fencing, full-pool stop latency, resource abuse,
stack overhead, scans, backup/restore, soak and application upload/dispatch/artifact
finalization/UI remain unqualified or incomplete. R0-R4 is not complete.

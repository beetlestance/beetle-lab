# k6 image execution evidence

Date: 2026-11-08. Recipe source `4863f46` (integrated as `d705907`).
Exercise source `ab23091`; `bcf20f1` adds phase-finish assertions also checked
against the retained evidence. The image remained local.

## Reproduce

```sh
docker build --platform linux/arm64 -f engines/k6/Dockerfile -t beetle-lab-k6:local .
node --import tsx engines/k6/test/container/smoke-engine.ts beetle-lab-k6:local
```

The independently reviewed recipe built successfully with its pinned Node/k6
multiarchitecture indexes and locked dependencies. Both npm installation stages
reported zero dependency vulnerabilities at build time; this is not an OS image scan.
The local image ID was
`sha256:9ceeeca6ef44bbdbeaeea3acd4d1bb1c3152432def42d4b89209336dff4e9cd0`.
Docker reported 358,403,776 bytes of image content; that is not a compressed pull size.

The exercise ran Node24.22.2, k6v2.2.0 and esbuild0.28.2 on Linux/arm64. It used
fresh labelled volumes and an internal Docker network, with no host ports,
credentials or external HTTP targets. A trusted setup helper assigned mount
ownership; the engine ran as UID1000 with read-only input/secret mounts and root
filesystem. Each case used one VU, one iteration and one readiness request.

## Actual results

| Workload | Native exit/outcome | Container exit | Summary/numeric bytes | Result/journal bytes |
| --- | --- | --- | --- | --- |
| HTTP200 | 0 / passed | 0 | 7,780 / 3,402 | 1,143 / 4,969 |
| HTTP500 | 99 / failed | 0 | 7,846 / 3,410 | 1,144 / 4,970 |

Each case made exactly one workload request, excluding readiness from measured
HTTP count. Required-definition counts were exactly one passed or one failed and
zero unknown. Declared artifact lengths/hashes, result content seal and journal
result payload matched. Both journals had 11 contiguous scoped events, all five
phase starts/finishes and a final seal-phase finish. Output files had UID1000,
mode0600 and one link. Original containers exited; owned containers, volumes and
networks were removed after evidence was copied to private host files.

A separate same-image probe with the same resource flags observed cgroup v2:
CPU quota `100000 100000`, memory maximum536870912, swap maximum0 and PID maximum128.
Actual engine inspect data matched one CPU quota, 512MiB RAM, no swap, PID128 and
a read-only root. These are configuration/kernel observations; no CPU saturation,
OOM, PID exhaustion or timeout/output-abuse stress was run in this exercise.

At clean `bcf20f1`, `npm run verify:v2` exited 0: 2,031 tests/167 files, all three
TypeScript projects, lint, generation37/23/6, architecture575 and docs84. The
frontend retained its 611.56 kB/178.59 kB gzip main-chunk warning.

## Qualification limits

This validates the image through Docker CLI, rather than the production agent
admission/staging/supervisor/collection path. Native amd64 execution, application
and agent Node24 runtime, image supply-chain scans, power-loss behavior, resource
stress, soak and stack overhead remain unqualified. No image was published.
The complete product submit/observe/finalize/replay path remains unfinished.

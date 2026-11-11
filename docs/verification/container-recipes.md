# Separate frontend/backend container evidence

Status: locally verified component recipes. Compose, clean installation and release
qualification remain pending. No images were published or legacy defaults changed.

## Source and review

Backend build source: 5c62e5454902a2fb9d98d3ee494a05e0cfaa46c7.
Frontend final source: 11af559c08c597bd465d719f7af4223a9382b9b5.
Integrated recipes: 52fa951; relevant build-input paths matched before integration.
Independent source review covered recipes, context exclusions, build closure and
proxy settings; scoped follow-up reviewed the actual read-only startup correction.
Private evidence is retained under .agent-work/container-recipes and the accepted
worktree cleanup archive. It includes build commands/exits, metadata, image IDs,
smoke scripts/results, recorded resource IDs and review report.

## Actual checks

Docker Desktop4.98 / Engine29.9.2, Linux arm64. One dedicated BuildKit builder:
2 CPUs, 2GiB RAM; verified enforced settings. Cache GC target1GiB is not a hard
peak/in-use disk quota. No global prune, default-builder change or push.

| Check | Result | Elapsed |
| --- | --- | --- |
| Native backend image build | exit0 | 33.10s |
| Initial frontend image build | exit0 | 4.62s |
| Frontend rebuild after startup correction | exit0 | 0.93s |
| Real frontend/backend authenticated HTTP proxy | exit0 | 2.59s |
| Real NGINX with synthetic streaming upstream | exit0 | 1.46s |

Backend image ID: sha256:645503ab83df2017539e6dab60e492d2fc09f4644ae8bf45b2e9f4559d8a4f78.
Frontend image ID: sha256:97d14f6f290f07f544d814257460f36835fa8c41c9fbd18b5b7be8a50286c01f.
Both images report Linux arm64; runtime containers used read-only rootfs, bounded
32MiB /tmp, CPU/memory/PID limits and capped local logs.

Actual frontend starts before backend and serves SPA navigation. NGINX syntax
passes. Pairing, cookie/CSRF-authenticated organisation creation and durable read
pass through the proxy. Unauthenticated reads, wrong CSRF and foreign Origin are
rejected; rejected writes leave the organisation count unchanged. The agent is
intentionally unavailable; this check exercises no target or k6 execution.

Synthetic upstream checks prove the first stream frame arrives before completion,
truncated chunked output remains an incomplete HTTP body, an unknown mutation
outcome is not retried, and downstream close reaches the original upstream.
These establish proxy behavior, not an application live-event implementation.

## Failures and limits

The first harness failed before service startup because Docker local logging
requires compression disabled or more than one log file. Harness uses two capped
files and records containers before start so failed starts remain owned.
The next check found real NGINX default temp paths under /var/cache on read-only
rootfs. All five HTTP temp paths now use deployment-supplied /tmp; only frontend
was rebuilt. Follow-up source review and actual runtime checks passed.

All recorded smoke containers/networks were removed; synthetic private data remains
in task-owned evidence. The exact task-owned builder and its cache volume were removed after packaging;
recorded final local images remain available. No repeated full test suite or backend rebuild was run.
Native amd64 execution, browser checks, source/image-pull Compose installs,
SBOM/license/security scans and measured stack overhead remain release work.

## Offline installer packaging

Source: 623321ca2d19a3ad00f92ca85fab79653f59aac1; integrated e49b83d.
Independent source review found no blockers in the separate finite installer image,
CLI bundle and actual Journal/metadata worker placement. Runtime provisioning source
and dependencies were unchanged; compared before integration.
Native arm64 cached image build exit0 in 2.32s on the same capped builder.
Actual read-only, network-disabled compiled entrypoint returned exit2/invalid_input
with no arguments (0.72s), and exit1/invalid_input for a missing private request
(0.69s). Both stdout streams were empty; no socket or installation root was mounted.
Scoped build-script lint passed; documentation check passed283 files. The first
lint invocation used a nonexistent worktree-local binary; using the existing root
binary passed without installing dependencies.

This verifies packaging and argument execution, not Journal worker startup or
fresh provisioning with a real daemon. Compose/first boot remains the next task.
Private command/build/CLI evidence is retained alongside the component image
records; reviewer report and branch bundles are archived before worktree removal.

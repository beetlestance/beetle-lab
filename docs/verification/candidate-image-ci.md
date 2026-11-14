# Matched rewrite candidate images

Source: 9c326f4. Status: local Linux/arm64 functional qualification plus validated
CI configuration. No hosted execution, registry publication or pull-install claim.
The [remaining qualification blockers](qualification-blockers.md) prevent release
acceptance, including an unexplained stop in an earlier run of the same candidate.

## Pipeline and identity

`ci/rewrite-container` builds frontend, backend, agent, installer, k6 and export
images from one checkout. Builds are sequential, with a 2 CPU / 2 GiB BuildKit ceiling
and no additional swap. Native matrix runners are `ubuntu-24.04`/amd64 and
`ubuntu-24.04-arm`/arm64; no QEMU step substitutes for native execution. These
[public runner labels](https://docs.github.com/en/actions/how-tos/write-workflows/choose-where-workflows-run/choose-the-runner-for-a-job)
are configuration choices, not evidence that hosted runs have occurred.

All six inspected images must share a 40-character revision and match the expected
CI checkout. Node `x64` and Docker `x86_64` normalize to `amd64`; host, daemon,
image and expected matrix architecture must agree before creating fixture resources.
Declared labels alone are not provenance. Exact build inputs, metadata and image
IDs are retained with the local evidence.

The original container job is preserved as `ci/legacy-container`. Required
`ci/container` runs after both legacy and rewrite jobs and requires both results
to equal `success`. Its actual shell gate passed all 16 combinations of success,
failure, skip and cancellation. Actionlint and shell syntax checks passed.
The existing publication job and legacy default image remain unchanged.

## Actual local result

Docker Linux/arm64 daemon; macOS/arm64 Node 26.7 harness; Node 24 runtime images.
The dedicated builder's CPU/memory/swap controls were inspected before use.

| Check | Recorded result |
| --- | --- |
| Initial six-image build | All passed; 64.475s combined |
| Corrected installer and cached revision-label builds | All passed; 14.202s combined |
| Untouched matched-stack qualification | Exit 0; 49.039s |
| Fresh setup and automatic local session | Passed through real frontend/backend/agent |
| One k6 iteration | Passed; target counts 1 ready / 1 work / 0 unexpected |
| Required artifacts | Exact eight kinds, including warnings and diagnostics |
| Diagnostics | <=32KiB, validated scope/coverage and public SHA256; identical bytes after backend/agent restart |
| Standalone export | Real offline engine; byte length/hash, download and exact request replay survived restart |
| Persistent state | Settings, session, credential digest and Journal authority preserved; second setup/up unchanged |
| Runtime controls and cleanup | Real stopped engines inspected; exact project/installation resources removed |

This used a fresh synthetic installation, dynamic loopback port and bounded target.
No existing user installation or service was restarted. Instrumented diagnostic
runs are excluded from the accepted functional result. Private logs, source hashes,
image IDs, failed attempts and independent reviews are retained.

## Startup allocation correction

The first packaged attempt failed the metadata worker's five-second readiness
bound under the default backend 250-millicore cap. A real-source diagnostic at one
CPU opened the application; a subsequent fresh packaged startup also passed.
Both Compose defaults now allow one backend CPU. No worker, operation, scanner
or execution deadline was extended. The exact minimum allocation is not qualified.

The starter control reserve now matches the three service ceilings:

| Service | CPU ceiling | Memory ceiling | PID ceiling |
| --- | --- | --- | --- |
| Frontend | 100 millicores | 64 MiB | 32 |
| Backend | 1000 millicores | 256 MiB | 64 |
| Agent | 250 millicores | 256 MiB | 64 |
| Control reserve | 1350 millicores | 576 MiB | 160 |

The qualification derives these totals from actual containers and compares them
with the installed agent reserve before enqueue. The separate engine pool and
headroom are unchanged. These are caps/admission reservations, not idle usage.
Existing ready setup receipts reject changed request intent; this is not an
in-place development-installation policy migration. The preconfigured Compose
variant was render-checked, not qualified as a native upgrade. No user files were
rewritten.

Native amd64 execution, cold-cache/repeated/flood controls, backup/restore and
resource overhead remain qualification work. [Supply-chain work](rewrite-supply-chain.md)
records the newer candidate's scans and explicit native failure; immutable pull
manifests and rewrite publication remain B10 delivery work.
The [Browser packet](../execution/remaining-rewrite.md) and full UI redesign remain separate.

# Private retirement pipeline evidence

Status: C4b process-local end-to-end composition verified; no authenticated route,
backend ACK, refund or background continuation. [Contract](../design/lld/retirement-pipeline.md).
Baseab1f096. Actual owners are bound explicitly by Root before serving.

The pipeline composes producer drain, runtime writer removal, actual inventory/plan
persistence, bounded native steps and trusted native receipt into exact pending/cleaned
wire values. Cleaned replay repeats native qualification; raw rows never shortcut it.
Independent source review found no blocking findings and did not duplicate checks.

| Check | Actual result |
| --- | --- |
| Initial full composition | 3tests passed,12.31s |
| Composition/lifetime/corruption | 6tests passed,7.16s |
| Affected pipeline/receipt/removal/bootstrap | 32tests/11files passed,34.76s |
| Node types/lint/architecture | Exit0;12.44s/8.01s/8.23s |
| Agent build/docs | Exit0;.94s/1.29s |

Host Node26.7.0/darwin arm64. Fixtures use the real compiled SQLite worker and native
files with genuine producer/runtime/observation capabilities; Docker observations are
explicit synthetic seams. Native Linux leaf evidence remains its separate scope.
Private check-runner evidence preserves source/commands/exits/timing and initial lint
failure. Named producer/plan/batch phase helpers resolved responsibility/complexity
limits without lowering gates.

Tests verify cleaned request binding and actual root removal; receipt replay with no
extra unlink/engine create/start; root reappearance rejection; one-step pending batches
that resume the same plan; malformed/conflicting/expired calls as failures; exact work
coalescing; capacity refusal before request traps; original late open retained across
abort/close; and a corrupt durable reply terminating the carrier rather than producing
pending/cleaned. Both result and settled reject failure; settled is not native drainage.

At two occupied origins, duplicate requests receive capacity refusal before capture.
No timer frees a native original. HTTP socket ownership, authenticated request/response
transport, backend deletion ACK storage and separate quota/tombstone settlement remain
next work. User services and published images were not changed by this slice.

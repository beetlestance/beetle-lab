# Exports

A standalone export turns one immutable suite revision into a portable k6 script
without running a test. Metadata (`app/src/application/exports`, `export-runtime`,
`app/src/adapters/outbound/sqlite/export-jobs`) owns durable intent, reconciliation
and publication; the agent owns admission, staging and physical lifetime under a
distinct purpose; the engine (`engines/k6/export`, `engines/k6/wrapper/export`)
compiles, builds and seals the script; `contracts/src/export-job` owns the values.

## Public surface

All routes sit under `/api/v2/organizations/{organizationId}/workspaces/{workspaceId}`
and use the authoring session, origin and CSRF policy. Shapes: `contracts/api/v2/export-jobs.schema.json`.

| Operation | Route | Reply |
| --- | --- | --- |
| Submit | `POST /revisions/{revisionId}/exports` | 202 `ExportJob` |
| List | `GET /exports` | `ExportJobPage`, ≤ 262144 B |
| Read | `GET /exports/{exportId}` | `ExportJob`, ≤ 32768 B |
| Cancel | `POST /exports/{exportId}/cancel` | `ExportJob` |
| Profiles | `GET /exports/profiles` | installed export profiles |
| Download | `GET /exports/{exportId}/content` | script bytes; ranges honoured, `If-Range` on the SHA-256 |

The UI offers export only when an installed profile advertises the export
capability, and downloads only a `ready` job's native publication. Submission is
rejected before mutation when `maximumBuildBytes + 64 KiB control + 8 KiB result`
exceeds the budget's `outputBytes` (`app/src/application/exports/intent.ts`).

## Job states

```
queued -> dispatching -> generating -> publishing -> ready
  any nonterminal -> failed | cancelled | unknown
```

| Rule | Behaviour |
| --- | --- |
| Replay | receipt-first: an exact logical replay returns the original job before current eligibility is checked; allocated IDs and time are excluded from create identity; cancel identity includes the job ID |
| Create | one transaction captures revision, config and input pins, settings versions, installed profile and the complete assignment; the new job is `queued` with no reason |
| Cancel | monotonic; it never erases a possible delivery, and terminal release waits for original-work and container quiescence |
| Unknown | ambiguous delivery, IO or stop stays `unknown` and charged; no terminal result is invented |
| Verdict | no Run, target contact, assertion or performance verdict is synthesised |

## Assignment

`StandaloneExportAssignment` (runner v1) is a closed, separately tagged envelope
that wraps an unchanged `Offer`; it is deliberately not an Offer, and performance
intake rejects it.

| Field rule | Value |
| --- | --- |
| Purpose | `standalone_export`, version 1, export and request UUIDs, revision UUID and digest |
| Capabilities | `requiredCapabilities` contains k6 config version 1 and `standalone-export-v1` |
| Secrets | explicit `secretReferences` array that must be empty; refused before hashing or admission, and again by the compiler (`unsupported_secrets`) |
| `maximumBuildBytes` | 1..64 MiB, covers simultaneous compiler, plan and script scratch |
| `scriptTimeoutMs` | 1..172800000 ms; limits the downloaded test, not the build |
| Size | ≤ nested Offer allowance + 8 KiB; nested Offer and config are revalidated separately |
| Digest | SHA-256 of `beetle-lab.standalone-export-assignment.v1\n` + canonical JSON of every field except the digest |

The whole-job Offer timeout bounds the build. The 8 KiB result and 64 KiB control
reservations sit inside `Offer.outputBytes`; no capacity is invented. A digest is
content integrity, never admission or authentication.

## Result

`StandaloneExportResult` is ≤ 8 KiB, sealed with the shared seal core under the
separate prefix `beetle-lab.standalone-export-result.v1\n`; engine-result golden
bytes stay unchanged.

| Status | Requirements |
| --- | --- |
| `succeeded` | reason null; exactly one `standalone-k6-script` artefact at `standalone/suite.js`; `buildUsage` known with bytes ≤ peak ≤ `maximumBuildBytes`; artefact bytes equal build bytes; artefact time ≤ seal time |
| `failed`, `cancelled` | artefact null; fixed reason (`unsupported_secrets`, `invalid_input`, `build_failed`, `output_limit`, `deadline`, `clock_fenced`, `input_integrity`, `publication_failed`); usage known or null |

`captureStandaloneExportResult` binds the full assignment, usage, file and time;
`verifyStandaloneExportResultSeal` alone proves structure only. Timestamps must be
finite before they are ordered.

## Agent admission and purpose

| Rule | Behaviour |
| --- | --- |
| Intake | a private export intake captures the assignment and the approved installed profile; normal Offer intake stays performance-only |
| Durability | Journal migration 015 stores an immutable `execution_purpose` (`performance` or `standalone_export`) with the assignment and digest, atomically with the accepted Offer |
| Conflict | same scope and attempt with a missing or changed purpose or digest conflicts; recovery derives purpose from the stored record, never from a request codec |
| Staging | reserves exact `offer.json` and `assignment.json` bytes, manifest, pinned inputs and the original output allowance; `assignment.json` sits in the read-only input root; ordinary staging rejects an unexpected assignment file |
| Dispatch | needs a trusted installed image with `standalone-export-v1` and a fixed export entrypoint; purpose and digest are bound into the runtime specification; profile environment cannot override them |
| Result | a distinct `export.result` event and `export-result.json`; attempt snapshots keep `exportResult` apart from `EngineResult`; cross-purpose events and results are rejected before mutation |

Queue, capacity, reservation and the physical supervisor are shared with
performance runs. Failed or unknown work stays charged until physical stop and
native collection or retirement proof. Export originals reserve cleanup control at
admission, but no export retirement exists yet: performance retirement refuses export
purpose and backend policy 1 funds only performance Runs, so export agent output stays
retained and charged. Export cleanup must never present itself as a Run.

## Engine generation

| Component | Contract |
| --- | --- |
| `exportStandaloneScript` | one `buildRuntimeScript({mode: 'standalone'})` call over trusted compiler output; returns path, bytes and peak bytes only; errors `invalid_input`, `unsupported_secrets`, `build_failed` with no raw text |
| `startStandaloneBuild` | caller signal plus monotonic deadline ≤ 172800000 ms away; one original call, one timer; logical stop is sticky and the result may reject while `settled` still retains the original; never deletes partial output or refunds disk |
| `startExportOperation` | requires generation 1 and exact canonical Offer equality with staged headers before compiling; compiles once, builds once, rechecks the parent fence between phases |
| Script custody | `standalone/suite.js` ≤ 64 MiB; owned 0700 parents, owned 0600 file, one link, stable inode; one 64 KiB buffer, ≤ ceil(bytes / 64 KiB) + 32 reads plus one EOF probe per pass; fsync and every close before the job-root recheck |
| `runStagedExport` | opens the assignment through the shared loader with the trusted runtime digest; no k6 child or target collector |

A timeout or cancel never fabricates file absence or a refund; cleanup failure stays
explicit until physical stop. Only verified native custody publishes the file.
The script embeds the revision's inline datasets and request bodies, so it is as
sensitive as the suite itself.

## Metadata, accounting and publication

| Rule | Behaviour |
| --- | --- |
| Separation | export rows are not Runs; no synthetic Run and no export UUID in `EventBinding.runId`; metadata migration 015 is unrelated to Journal 015 |
| Charge | 3 MiB metadata per job (`EXPORT_METADATA_BYTES`) plus the payload maximum, reserved before possible delivery against shared installation storage |
| Binding | a purpose-tagged export output binding (export ID, attempt, Journal authority) in its own file-identity namespace; one byte store and transfer owner serve runs and exports |
| Reconciliation | `startExportRuntime` takes ≤ 8 candidates and ≤ 2 step originals; claims persist before Offer IO; retries reuse the same assignment and authority; no new attempt after a lost acknowledgement |
| Publication | only after the attempt is exited with admission released, or admission rejected; transfer result and settlement are both awaited |
| Absence | `source_absent` needs an authenticated agent absence proof; it settles backend custody only and never authorises agent purge or ACK |
| Pins | input pins stay held until exact producer retirement, including unknown and cancelled jobs |

Backend publication or absence does not prove agent producer retirement. No browser
path, clock timeout or current capability creates physical authority.

## Related

- [Results](results.md)
- [Decision 009: result seal](../../decisions/009-result-seal.md)
- [Decision 006: agent staging](../../decisions/006-agent-staging.md)
- [Decision 025: standalone export purpose](../../decisions/025-standalone-export-purpose.md)

## Anchors

| Code | Reviewed |
| --- | --- |
| `contracts/src/export-job/` | `ee5dbee9e357` |
| `app/src/application/exports/` | `8b2b5f2a79e4` |
| `app/src/application/export-runtime/` | `23cbf619a3fc` |
| `app/src/adapters/outbound/sqlite/export-jobs/` | `20252909c7da` |
| `engines/k6/export/` | `120bf16f289c` |
| `agent/src/journal/migration015.ts` | `e43499b5bd89` |

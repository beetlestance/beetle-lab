# Indexed history search evidence

Status: H3 locally verified at0025f70, based on integration0a9f6e2.
Scope: [search contract](../design/lld/run-history-search.md), F06/A02/V19.
This evidence is separate from [H1](run-history-query.md) and [H2](run-history-summary.md).

## Behavior and limits

Explicit Apply searches current workspace/suite/ancestor-folder names, or a
separate Run UUID prefix. Names use bounded literal Unicode search; IDs match
from the beginning. This deliberately replaces legacy concatenated-path and
arbitrary-ID substring search. Controls explain these differences. No browser
current-page filtering, config loading, native reads or extra metric-row requests.

Index source names once, not per historical run. Each candidate suite uses a
covering filtered time-keyset read; bounded top-K merge supports many historical
runs for a matching suite. Candidate/posting/folder/suite and prefix overflow
return search_too_broad, never truncated success. Workspace-name matches bypass
entity expansion. Backfill advances <=16 documents per explicit request; until
complete it returns retryable search_indexing. Restart resumes its checkpoints.

A search-only idempotent Unicode fold is shared by query/cursor normalization,
SQLite trigger/backfill tokenization and current-name verification. Namespace
sibling identity remains unchanged. The reported decomposed capital-J/caron case
is exercised through actual worker pagination, migration and reopen.

## Source-bound checks

Source-bound check evidence covers524 tests in51 files:449 contract/storage/HTTP,
29 DOM and46 native-live schema regressions. Actual application registration plus
generated client and compiled SQLite worker exercise search pagination and reopen.
Worker fixtures cover scoped Unicode names, mutable ancestry, cursor binding,
resumed backfill, late inserts, explicit overflow,258 histories for one suite,
covering query plans, atomic rename failures and unchanged namespace identity.

The first frozen lane retained a raw-writer fixture failure: its direct SQLite
connection lacked the newly required function. Other429 tests in35 files remain
valid. Registering the production function on raw writer fixtures passed20 tests
in3 files, including the unchanged100,000-folder enumeration workload. No assertion
or bound was relaxed. Hash comparison confirms only those three test files changed
from that freeze. Original failures and exact commands/logs are retained privately.

Node/web types, changed lint, API drift, architecture, documentation and API/web/
agent/engine builds pass. The amended11-command lane took48.92s; the raw-writer
correction test command reports15.51s. Independent review caught and then accepted
the Unicode correction and confirmed fixture assertions/workloads were preserved.

The shared API registry is reachable from native bundles; the built agent main
hash changed, so old image evidence was not reused as current-image qualification.
Matching local images for0025f70 built in a task-owned2GiB/two-CPU BuildKit builder,
then one native arm64 smoke passed in8.87s. It verified one readiness plus one work
request, zero unexpected requests, sealed six-artifact output, numeric-v4 summary,
exact retained logical charge104168 bytes, unchanged summary across backend reopen,
released task reservation and task cleanup. The builder was removed. Host Node26,
container Node24; this remains a narrow synthetic native control.
Engine log capture was unavailable under the configured log driver; its diagnostic
failure remains recorded, so this does not establish successful log inspection.

## Remaining qualification

DOM tests are not native browser evidence. No Compose deployment, user-service
restart, real-target load, amd64, soak, hosted CI, dependency/image scan or publication
is established by this slice. Complete R0-R4 acceptance remains separate.

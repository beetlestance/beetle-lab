# Indexed history search evidence

Status: H3 scoped acceptance in progress, based on integration0a9f6e2.
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

Pending frozen scoped lane and independent correction review. Earlier failures
and their exact commands/logs remain in task evidence: strictRequired schema
fixture, predecessor-schema fixture, schema400 versus semantic422 expectation,
TypeScript boundary fixes and changed-code complexity/unused checks. Failures
are not substituted with unrelated green runs.

No execution/image inputs change. Reuse H2 engine/agent native evidence only for
those unchanged inputs; the changed SQLite worker/API/search require their own
component/build checks. Source equality does not qualify a new packaged backend.

## Remaining qualification

DOM tests are not native browser evidence. No new Compose deployment, user-service
restart, target load, amd64, soak, hosted CI, dependency/image scan or publication
is established by this slice. Complete R0-R4 acceptance remains separate.

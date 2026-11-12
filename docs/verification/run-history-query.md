# Scoped history query controls

Status: H1 locally verified on the history slice based on ccd9369.
Scope: [history contract](../design/lld/run-history-query.md), F06/A02/V19.
H2 scalar summaries have [separate evidence](run-history-summary.md). H3 indexed
text search remains proposed.

## Behavior

RunListQuery adds exact state/outcome filters and newest/oldest requested-time
ordering, default newest. Equal timestamps use canonical UUID order. The strict
versioned cursor binds organisation, workspace, limit, filters, order and position.
Legacy UUID cursors reject; explicit Refresh starts page one.

Schema validation inserts no defaults or coercion. HTTP alone decodes canonical
decimal limit. Malformed fields return400; malformed or mismatched cursor semantics
return422 before the reader. The generated client rejects them before fetch.
Shared page checks bind filters/scope, unique IDs, ordering, requested position and
continuation. Short pages have no continuation; a final full page can have none.

The actual SQLite worker reads scalar keys and Run projections in one transaction.
Fixed covering indexes support every filter combination and both directions.
Migration017 adds outcome and state+outcome access paths; it changes no authority,
receipts, retained charges or stored runs. Missing workspace remains an error.

UI draft changes issue no reads until Apply. Apply/Reset reset pagination and
comparison selection; Refresh returns to page one. Selection persists across pages
with the existing four-run cap. Query keys include all applied parameters and only
share an identical unfiltered first page with command search. Late retired replies
cannot populate another filter/scope view. There are no per-row metric/config reads.

State/outcome membership can change between page snapshots while runs progress.
Traversal is not an immutable snapshot and does not promise exactly-once membership.

## Local evidence

The frozen scoped lane passed395 tests in30 files (34.43s), plus the existing
reader regression (one test;3.12s). Changed lint0.86s, Node types9.06s, web types4.57s,
API drift0.33s and architecture5.26s passed. The docs gate first caught a41-line
context note; after reducing it to40, docs0.59s, API build0.84s and web build1.40s
passed. Only prose changed after the frozen production inputs. The web build keeps
its existing large-chunk advisory; no warning threshold was changed.

The source-bound scoped check plan covers:

- Contract/client fixtures, cursor canonicality/binding and strict page semantics.
- Application snapshot ownership and HTTP field/response failures.
- Compiled SQLite worker pagination, tied timestamps, both directions, all states
  and outcomes, foreign/missing workspace and lifecycle changes between pages.
- v16-to-v17 index migration, unchanged retained rows/outbox and foreign keys;
  actual EXPLAIN plans use covering searches without temporary sort.
- Actual application HTTP/generated client/worker pagination across restart, with
  three original runs/attempts and no possible dispatch or engine target load.
- DOM controls, ignored late replies, comparison cap/selection lifetime, bounded
  GET requests and identical pending command-search/history query sharing.
- Changed-file lint, Node/web types, generated API drift, architecture/docs gates
  and affected API/web builds.

Independent source review found no blocking implementation issue and clarified
final full-page continuation wording. Tests use synthetic local state; no user
services were restarted and no image or repository was published.

## Limits

This is component/composed HTTP and DOM evidence, not native-browser or packaged
installation qualification. Scalar duration/request/RPS/p95/error/storage columns
and all-history text/name search are not implemented by H1. No execution engine,
auth policy, producer cleanup, retention or namespace deletion behavior changed.

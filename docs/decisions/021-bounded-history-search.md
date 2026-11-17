# Decision 021: Bounded trigram history search

Status: accepted. Recorded on 17 November 2026 from the design the code
implements; the choice predates this record.

## Decision

Run history search offers two explicit modes, current-name substring and run
UUID prefix, served by workspace-scoped trigram postings maintained by SQLite
triggers. Every query reads a fixed number of index rows (62 terms, 257 postings
per term, 256 folders, 256 suites, 257 prefix candidates). If a budget would be
exceeded the request fails with `search_too_broad`; it never returns a partial
or silently truncated page. Name indexes backfill lazily, 16 documents per
search request, and report `search_indexing` until ready.

## Why

The legacy history matched unbounded substrings over concatenated paths and
IDs. Work grew with history size and a broad query could scan every run. A
fixed read budget keeps one search inside the metadata worker's bounded
command time regardless of how many runs a workspace keeps, and lets one suite
with unlimited history still page through its matches.

Current names, not historical spellings, match because renames and moves change
membership without rewriting immutable run identity.

## Alternatives

- `LIKE '%term%'` over names and joined paths: rejected. Cost is proportional
  to the corpus and cannot be bounded per request.
- SQLite FTS with a global time sort: rejected. Ranking and ordering across all
  matches needs an unbounded sort, and FTS tokenisation does not give literal
  substring semantics for short names.
- Returning the first N matches when a budget overflows: rejected. A partial
  page looks complete and breaks keyset pagination; an explicit error asks the
  user to refine.
- Eager backfill at startup or in migration: rejected. It walks the whole
  corpus before the service is ready; lazy bounded batches keep startup and
  ordinary history independent of the index.
- Arbitrary UUID substring matching: rejected in favour of prefix-only, which
  maps to a bounded ID range read.

## Consequences

Some queries with small true intersections are refused because every term is
common. Minimum lengths (3 scalars for names, 8 characters for prefixes) and the
mode split are deliberate departures from legacy behaviour.

## Review triggers

Revisit if users routinely hit `search_too_broad` for reasonable queries, or if
search must span workspaces or organisations.

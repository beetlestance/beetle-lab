# Indexed run history search
Public entries: prepareHistorySearch (bounded durable backfill), historyKeys
(scalar search within caller transaction). Query owns normalization and cursor.
Name postings index current suite/folder names once; workspace-name match uses
ordinary history indexes. Folder expansion and suite candidates each<=256.
Per-suite reads<=limit+1 then bounded top-K merge; no historical-match cap.
Prefix reads<=257; >256 fails before filters/cursor, never partial success.
Note postings (history_note_grams): first term <=256 runs selects candidates, each
verified against its current note; merged/deduped with suite keys; no backfill.
Missing readiness returns search_indexing, broad search search_too_broad.
No native/config/metric IO, credentials or engine imports.
matchingSuiteNames serves suite-list search: kind='suite' postings only, <=256 suites.
Owner: docs/system/contracts/public-api.md, authoring.md, suite-listing.md. Tests: app/test/storage/run-search/.

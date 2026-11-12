# Indexed run history search
Public entries: prepareHistorySearch (bounded durable backfill), historyKeys
(scalar search within caller transaction). Query owns normalization and cursor.
Name postings index current suite/folder names once; workspace-name match uses
ordinary history indexes. Folder expansion and suite candidates each<=256.
Per-suite reads<=limit+1 then bounded top-K merge; no historical-match cap.
Prefix reads<=257; >256 fails before filters/cursor, never partial success.
Missing readiness returns search_indexing, broad search search_too_broad.
No native/config/metric IO, credentials or engine imports.
Owner: docs/design/lld/run-history-search.md. Tests: app/test/storage/run-search/.

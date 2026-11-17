# Organisation overview

Penpot "Organization" hero: name, workspace and run counts, settings link. One
scoped GET with manual refresh, read by `useOrganizationOverview`; WorkspaceList
reuses the same cached snapshot for per-row "Right now" (active list) and "Last
run" (8 recent headers). What the snapshot cannot prove is labelled unknown;
per-workspace suites and 24-hour runs are not shown (no fan-out). Errors hide counts.

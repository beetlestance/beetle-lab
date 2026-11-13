# Clock-integrity Run reason migration

Status: application migration020 implemented; qualification in progress.
Owner: application SQLite initialization. [Stop cause](agent-stop.md),
[absence](output-absence.md), [evidence](../../verification/lifecycle-baseline-repair.md).

The runner reason catalog now admits clock_integrity, which existing supervision,
absence derivation and native guards already emit. The migration004 runs.reason
CHECK omitted that value. Preserve the durable cause through backend finalization;
never map it to a different failure merely to satisfy an older constraint.

## Exact metadata change

Use SQLite's documented [metadata-only ALTER procedure](https://www.sqlite.org/lang_altertable.html)
for a CHECK relaxation that leaves record layout unchanged. Migration020 runs only
inside the owner's exclusive initialization transaction, with foreign keys ON.
Serving connections explicitly enable defensive mode. Development Node minimum is
24.12 for that supported API; product containers retain their pinned Node24 image.

Read only the runs CREATE statement, capped at16KiB before materialization. Require
its exact known predecessor reason-CHECK spelling exactly once, no semicolon or
pre-existing clock_integrity, and the owned table prefix. Substitute only the new
enum member. Compile that revised statement in a separate empty in-memory database
before granting the metadata edit capability. Do not rewrite applied migration004.

A synchronous private window disables defensive mode, enables writable_schema and
performs one compare-and-swap of runs.sql. It invokes no caller SQL, callback, async
work or data query. Require one changed row; increment a bounded schema_version.
Always turn writable_schema OFF and defensive mode ON before further parsing or
serving. Recheck protections through an actually denied no-op schema preparation,
read back the header/version and force reparse with protections active. Failure
propagates through rollback; initialization closes the original connection. A
restoration failure cannot leave that connection available to application work.

No table copy, Run history scan, record/root-page rewrite, index/trigger/view change,
foreign-key relaxation or payload/accounting update is needed. Old values satisfy
the relaxed CHECK unchanged. Unknown reason values remain invalid. user_version20
commits with the schema change; late COMMIT failure restores both atomically.
Schema20 is not a downgrade promise for an older image after new reasons persist.

## Required proof

Real001–019 migrations plus retained rows; all schema objects/root pages and rows
unchanged except the exact runs CHECK; current history summary/payload/charge
preservation; success and failure protection-denial checks; unknown value rejection;
reopen after commit and rollback; unexpected/oversized SQL and missing transaction/
foreign-key protection reject before editing. A restoration failure must release
the failed startup connection and preserve schema19 for retry.

Historical downgrade helpers are synthetic only. They may invert this CHECK only
when no new reason is persisted, before testing older history migrations. Never
relabel a schema20 definition as an old schema or use that helper on user data.
The supported real runtime and matching consumer registries require their own
qualification; a syntax test alone cannot establish safe startup or finalization.

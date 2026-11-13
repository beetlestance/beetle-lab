# Backend settlement guard

Private fixed synchronous insertion, per-table/original purge and counter updates.
No callback runs while its per-DB permit exists. Eligibility is derived before permit.
Exact frame permissions have one owner here; SQL alone cannot mint authorization.
Any rollback/restoration uncertainty poisons the connection before attempting close.
The Store checks poison before later commands. Foreign keys stay enabled throughout.
Contract: docs/design/lld/output-settlement.md.

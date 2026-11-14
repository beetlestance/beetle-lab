# Empty namespace deletion
One BEGIN IMMEDIATE owns receipt lookup, scoped version/emptiness, marker funding,
settings/root/entity deletion and exact receipt. Every failure rolls back all work.
Existing FKs protect suites/inputs/runs/retention epochs/settlement identities;
only harmless search-index/progress rows use existing cascade behavior.
Permanent 2048-byte markers fence entity/root/settings identity reuse; no refund.
No native file IO, recursive deletion or cleanup proof inferred from missing rows.
Tests: app/test/storage/namespace-deletion.test.ts.

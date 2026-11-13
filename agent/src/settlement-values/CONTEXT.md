# Agent settlement values
Entry:index.ts. Contract:docs/design/lld/output-settlement.md.
Canonical tombstone<=3584 plus512 logical row allowance;4096 permanent charged floor.
V1 admitted codec is byte-identical after symbol renames, preserving canonical/hash
behavior. V2 has a separate domain and explicit16384 rejected-control funding, zero
native hold/disk/C1 charges and the exact no-task cleaned receipt commitment.
Exact cleaned reply/request and Offer digest survive purge; old metadata charges remain
recorded. Pure syntax is no purge/refund permit. Exports cannot borrow either branch.

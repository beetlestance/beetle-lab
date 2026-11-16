# Admitted agent settlement
Entry:store.ts, private bounded worker operations. facts.ts reuses actual retirement,
plan/progress/receipt eligibility and exact recorded charges; rows.ts validates compact
replay independent of purged rows. purge-order.ts is the fixed FK child-first list.
4096 permanent floor transferred from actual removed hold; replay counter O(1).
Never-admitted/export have no authority here. SQL guard owns fixed transaction;
Journal client requires shared local drained observation and retains carrier/fence.
Contract:docs/design/lld/output-settlement.md. Public endpoint/controller pending.

# Agent settlement SQL guard
Entry:index.ts registers non-deterministic exact original/table/frame authorization
and exposes only fixed commit; no callback/permit setter. Guard exists only during
same immediate transaction, always cleared. Tombstone inserted before fixed FK purge.
Counters must match actual before/after; nested cross-original mutations refuse.
Contract:docs/design/lld/output-settlement.md. Local drained proof is client-owned;
this worker revalidates actual receipt, C1, released hold and complete recorded debt.

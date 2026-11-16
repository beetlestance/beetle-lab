# Shared process-local producer/read gate
Public index.ts owns one explicit gate per Journal retirement port and namespace.
At most64 scoped entries/leases; reserve before foreign calls, check durable open and
local fence before IO. A fence grants no native cleanup capability. Confirming exact
intent permits eventual eviction only after actual leases drain; restart reads still
check the immutable durable fence. Uncertain fences retain a bounded owner slot.
Original slots are reserved before factories (<=4 per lease) and strongly retained. Failed factory/quiescence/close
poisons a lease; rejection cannot free its slot or the corresponding service credit.
Cached close waits actual leases; failures retain Journal/runtime ownership.
No timer/abort/reply substitutes for actual drain. Journal and native lifetime owners
remain responsible for their own originals; future coordinator composes these ports.
Owner docs/design/lld/producer-retirement.md. Focused agent/test/producer-gate.

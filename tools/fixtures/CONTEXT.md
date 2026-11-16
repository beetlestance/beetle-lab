# Synthetic backend peers

`backend-agent.ts` supplies task-owned private config and an explicitly unavailable
loopback agent for backend/compiled browser-controller tests. Shared contracts are
the only service dependency. No runtime daemon, user data or credential is used.
An unavailable fixture preserves unknown capacity; it does not fake readiness.

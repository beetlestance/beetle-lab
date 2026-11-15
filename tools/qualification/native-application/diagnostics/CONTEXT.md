# Native stats failure diagnosis

stats.ts is invoked only after a failed lifecycle qualification and its owned
cleanup. It cannot make qualification pass. It creates one labelled idle native
engine container (15s lifetime), fixed1CPU/512MiB/swap0/PID128, UID1000, read-only,
no network/capabilities. Published image/native identity is checked before effects.
Ownership is saved before create; independent cleanup remains label-scoped.

Three sequential GETs use the approved bounded Unix transport and exact new ID:
1s,2s,1s. The2s call is diagnostic only; the producer's1s deadline is unchanged.
Only scalar status/timing/identity presence and safe raw CPU/memory/PID counters
leave the reply. Missing/foreign/malformed data stays null; raw errors and Docker
responses are excluded. This is not an accuracy or resource-qualification oracle.

The existing check runner caps the diagnostic at90s; workflow step120s. Always
attempt owned cleanup. Failure/late cleanup remains failed. No user services,
network targets, daemon prune or archive mutation is authorized by this tool.

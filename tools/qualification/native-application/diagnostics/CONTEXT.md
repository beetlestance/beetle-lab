# Native stats failure diagnosis

stats.ts is invoked only after a failed lifecycle qualification and its owned
cleanup. It cannot make qualification pass. It creates one labelled idle native
engine container (15 s lifetime), fixed 1CPU/512 MiB/swap0/PID 128, UID 1000, read-only,
no network/capabilities. Published image/native identity is checked before effects.
Ownership is saved before create; independent cleanup remains label-scoped.

Three sequential GETs use the approved bounded Unix transport and exact new ID:
1 s,2 s,1 s. The 2 s call is diagnostic only; the producer's1s deadline is unchanged.
Only scalar status/timing/identity presence and safe raw CPU/memory/PID counters
leave the reply. Missing/foreign/malformed data stays null; raw errors and Docker
responses are excluded. This is not an accuracy or resource-qualification oracle.

The existing check runner caps the diagnostic at 90 s; workflow step 120 s. Always
attempt owned cleanup. Failure/late cleanup remains failed. No user services,
network targets, daemon prune or archive mutation is authorized by this tool.

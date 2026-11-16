# Native shared-pool admission qualification

run.ts BUNDLE NEW_ABSOLUTE_OUTPUT [CONTEXT] [shared|isolated].
Qualified source archive only, stock2CPU/1GiB/PID256/concurrency2 pool;
engine1CPU/512MiB/PID128, output64MiB each. No reserve/cap changes.
Fresh project/profile; at most two retained executions. Shared adds a third
queued request then cancels it before any third target request/container.
Two organisations retain distinct suite/config/run identities. Same public SDK.
Require simultaneous physical work for shared mode, or queued second run until
isolated original stops; exact40 requests each, once-only readiness. No mutation retries.
Outer600s; explicit1024-request fixture allowance. Bounded public polls and target counts; no user installation or real targets.
Independent cold/cleanup.ts must follow normal teardown. Evidence private.
Does not establish all crash races, actual RSS or idle/thermal sensor readiness.

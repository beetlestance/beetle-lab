# Repeated-run memory observations

This is a cold analysis of the accepted four-run ARM fixture, not another load
trial. Source imagesb48936d8; original proof in [finite repeated load](bounded-repeated-load.md).
The192.684s trial passed400requests/run with three readers, no service restart,
history purge or enlarged pool. Private derivation records the source report SHA
in `.agent-work/memory-analysis-d1406da3.json`.

Process RSS is read externally; shared pages are counted more than once. Values
below are medians of each post-idle window, in MiB. Each window has7–8samples.

| Service | After warm-up | After run2 | After run3 | After run4 |
| --- | ---: | ---: | ---: | ---: |
| Frontend | 9.93 | 9.93 | 9.93 | 9.93 |
| Backend | 157.85 | 157.98 | 158.54 | 145.72 |
| Agent | 139.96 | 140.91 | 140.99 | 141.11 |

The frontend stayed flat. The backend's final median fell below its initial idle
median153.12MiB. The agent rose from initial idle132.10MiB to141.11MiB; after the
warm-up window it increased about1.15MiB, with the last two increments about0.08
and0.12MiB. All observations remained under64/256/256MiB service ceilings.

These data support a bounded four-run observation, not a zero-growth or leak-free
claim. The strict no-retained-growth target is not established for the agent.
RSS alone cannot distinguish reachable allocations, allocator retention, code
warming or garbage-collection timing. No causal diagnosis is inferred from the
shape of these four points, and no target or service limit is raised.

[Cold accounting](cold-repeated-accounting.md) independently reconciles the actual
retained files, receipts and paid debt of the same stopped fixture. Intentional
persistent history is separate from process RSS and must not be silently purged
to improve the measurement. The later telemetry component benchmark uses another
workload/assembly and cannot substitute for this installed-stack growth proof.

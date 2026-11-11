# Attempt resource observations

`index.ts` exposes internal monitor/admission composition and summary type.
Supervisor owns at most 64 monitors and shares two original read slots, no queue.
Ticks drive 1s sampling/5s summary cadence. Each monitor retains one original,
constant-size aggregate and an original deadline timer capped at 1s.
Cancellation/exit aborts new sampling; close retains ignored-abort originals.
No timers survive completion; no monitor closes transport or Journal.

Docker readings are aggregate container observations. CPU is latest cumulative
whole milliseconds, memory/PIDs are sampled maxima, never kernel lifetime peaks.
Null and explicit source/reason/counters preserve missing observations and resets.
Restart begins fresh maxima with a discontinuity marker. Output stays null; only
verified CPU/memory/PID controls are listed. There is no function CPU attribution.
The supervisor evidence owner serializes durable lifecycle/resource ordinals;
the monitor never writes Journal or starts/stops containers. Exit drains sampling
and final publication before stopped state can authorize source collection.

Contract: docs/design/lld/attempt-resources.md.
Tests: vitest run agent/test/telemetry agent/test/supervisor/resources.test.ts.
Synthetic fixtures establish bounds/ownership, not native overhead qualification.

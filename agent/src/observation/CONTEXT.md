# Resource observation boundary

Entrypoint index.ts. Read resources-observability LLD and admission CONTEXT first.
One original sample; opaque verified root/statfs + pinned read-only Docker baseline.
CPU/RAM are daemon/VM totals. PID/output/staging are configured aggregate policies;
physical aggregate PID capacity remains unknown. No idle/thermal/guard invention.
Operational failure returns unknown; caller must publish it instead of old readiness.
Close aborts and waits for original sample promises, not shared transport sockets.
No admission, scheduling, runtime mutation, cleanup or retry authority.

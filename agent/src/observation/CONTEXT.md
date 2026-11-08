# Resource observation boundary

Entrypoint index.ts. Read resources-observability LLD and admission CONTEXT first.
One original sample; opaque verified root/statfs + pinned read-only Docker baseline.
CPU/RAM are daemon/VM totals. PID/output/staging are configured aggregate policies;
physical aggregate PID capacity remains unknown. No idle/thermal/guard invention.
Operational failure returns unknown; caller must publish it instead of old readiness.
Close aborts and waits for original sample promises, not shared transport sockets.
The publisher in publisher.ts composes actual observer/output/timeout ports and
owns full journal observation writes; no scheduling or runtime mutation authority.
One original sample, one original write and one pending frame. Unknown revocation
is independent of held sampling/writes. Preserve resource timestamps; only a newer
actual sample can restore readiness. Local monotonic start age owns freshness.
Clock/guard failures revoke; write failures retain ownership and reject close.
Close fences callbacks, drains originals and publishes final unknown revocation.
External bootstrap still owns observer/guard/transport/journal shutdown.
Publisher contract: docs/design/lld/observation-publisher.md.
Checks: npx --no-install vitest run agent/test/observation agent/test/integration/observation-publisher.test.ts --maxWorkers=2.

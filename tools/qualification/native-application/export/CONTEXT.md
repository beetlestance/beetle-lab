# Standalone export qualification

runner.test.ts composes actual staged engine generation, publication and shared
agent native collection. This cross-service proof belongs in tools, not an engine
unit directory. Synthetic fixture owns all roots and no target is executed.
smoke.ts is an explicit native Docker command: AGENT_IMAGE EXPORT_ENGINE_IMAGE
[LOCAL_CONTEXT]. It requires a matching compiled Journal worker, optionally through
BEETLE_AGENT_WORKER_FILE. It creates only synthetic task-owned roots/containers.
It checks lost-reply replay, fixed offline dispatch, physical stop, exact source
chunks/restart, conflicts/scoping and late cancellation without target traffic.
Images are supplied, never built or pulled here; logs and evidence remain local.
Component tests alone do not imply these native facts.

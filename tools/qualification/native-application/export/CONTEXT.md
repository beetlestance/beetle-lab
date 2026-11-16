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

public-smoke.ts accepts AGENT_IMAGE PERFORMANCE_IMAGE EXPORT_IMAGE [LOCAL_CONTEXT].
It installs both purposes, uses actual public revision/job routes, verifies public
script download, physical offline stop and same source/job/script after backend
and agent restart. Dynamic qualification address refresh preserves installed/Journal
identity. Supplied images and matching compiled workers stay explicit. Default
Compose offline-profile provisioning is outside this host-backend proof.

# Installed engine catalogue

Public entrypoint: `createEngineCatalog` from `index.ts`; existing catalogue types
and the shared maximum remain exported there.

Inputs are trusted local registrations plus unknown offer envelopes. Registration
JSON is bounded, copied and frozen; opaque ConfigSchema instances must carry the
shared adapter's runtime brand. Selectors and persisted validation pins are exact.
All registrations share one installation, staging root and UID policy.

Preflight snapshots at most 2MiB with an independent 1MiB config limit, validates
the runner envelope and installed
configuration structure, and probes runtime/profile feasibility with a temporary
copy raising only budget fields below manifest minima and omitting config, inputs
and secret references after original validation. These payload fields do not affect
native guards; future guards consuming them must amend the projection. Admission
decides the original budget; the returned Offer remains unchanged. `prepareRuntime` itself,
registration and actual staging/recovery keep strict minimum/maximum guards.
Public journal `configDigest` owns configuration identity.
No dataset reads, secret resolution, semantic compilation, network or filesystem
I/O occurs. There is no asynchronous operation or cancellation lifecycle.

Outputs are immutable private offers, installed engines and validation identities.
Failures expose only fixed CatalogError reason tags. Recovery validates every
persisted pin and current config bytes, rejecting missing historical installation
identity rather than selecting a replacement.

Focused check: `npx vitest run agent/test/catalog --maxWorkers=2`.
Owner spec: `docs/design/lld/engine-catalog.md`.

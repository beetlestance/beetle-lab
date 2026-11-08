# Installation and private HTTP evidence

Date: 2026-11-08. Combined source: `acd98d4`.
Independently reviewed catalogue: `d76789d`; installation: `bf77743`;
private HTTP: `8f49458`. Integrated counterparts preserve their runtime source.
Environment: Node26.7.0/macOS arm64, real temporary files and SQLite.

## Implemented composition

The installed catalogue pins manifest/profile/config/schema identities and derives
admission profiles. Shared schema preflight is bounded, synchronous and strict;
it reads the language-neutral k6 schemas without importing engine compiler/runtime
code. Full semantics and dataset parsing remain admitted engine work. The catalogue
and admission share a32-profile bound and public runtime-plan/config-digest owners.

InstallationController connects durable enqueue, admission, verified staging and
AttemptController. It retains original preparation/cancellation/driver work,
permits cancellation reconciliation, retires settled uncharged owners safely and
keeps charged/uncertain cleanup owned. Preparation saturation does not start or
retry execution. Recovered claimed runtimes use exact pins/spec digest and tick;
abandoned pre-create setup is not restaged.

The private Fastify adapter implements six generated runner operations. It requires
a trusted bearer credential, rejects browser metadata, fences scope/generation and
bounds bodies, queries, URLs, headers and concurrent original service calls.
Responses are captured and validated before field observation or serialization.
Server shutdown waits for retained original metadata operations. No route exposes
runtime drive, Docker flags, schema installation or raw allocation capabilities.

One composition test exercises authenticated Offer -> actual catalogue/schema ->
SQLite admission -> actual Stager -> controlled runtime -> actual control intake ->
sealed output verification -> capacity release, followed by scoped HTTP state/events.
Docker execution, capacity observations and the signed engine producer are explicitly
synthetic. Fastify.inject exercises handlers/client codecs, not real TCP parsing.
The fixture proves composition, not a native k6 request or application finalization.

## Independent review and corrections

Catalogue review reproduced a required hard-quota capability passing preflight
when advertised by a manifest. The actual offer now supplies the public runtime
helper's hard-quota flag; preflight and recovery both reject unsupported enforcement.

Installation review reproduced running cancellation blocking cleanup and effect-free
requests exhausting64 owner slots. Corrections preserve launch fences while allowing
reconciliation and require settled/version-stable/journal-confirmed uncharged state
before retirement. Independent probes passed original scenarios, stale retirement
races and unavailable-observation retention. Tests also cover66 sequential completed
owners and64 uncertain owners blocking a65th.

HTTP review reproduced a journal snapshot getter observed before capture, with an
incorrect events continuation. The correction captures/validates first: independent
probes observed zero getter calls and zero dependent event reads. Ordinary, stale
and foreign-snapshot cases passed their expected outcomes.

## Executed checks

At clean `acd98d4`, `npm run verify:v2` exited0: **2,265 tests/193 files**, all three
TypeScript projects, lint, generation37/23/6, architecture654 and docs99. Frontend
build passed with its existing611.56kB/178.59kB gzip main-chunk warning.

The first combined gate passed2,263 tests but one physical staging fixture failed
with a one-second happy-path budget. Its explicit budget is now ten seconds; a
controlled slow-provider regression still requires the original one-second job to
expire without writing late input. Production enforcement was unchanged. The
focused staging checks passed30 tests before the final integrated gate.

## Remaining qualification

Actual startup/scheduling, measured resource observations and timeout/output guard
freshness, private agent image/Compose and the full Linux container path remain.
Configured PID allocation must not be labelled measured physical capacity. Uncertain
old dispatch needs a genuine retirement authority; stopped inspection alone is not
proof that no late start can occur. Application outbox/artifact storage, terminal
seal/finalization acknowledgement, UI testing/reporting and release qualification
remain. No new Docker build/publication, real socket, native AMD64, hosted CI,
backup/soak or image/security/license scan was performed by this slice.

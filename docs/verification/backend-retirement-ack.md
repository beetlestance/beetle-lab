# Backend cleanup ACK evidence

Status: source-local immutable metadata ACK; driver/native composition remains pending.
Base0868e80. [Contract](../design/lld/backend-retirement-ack.md).

The existing compiled metadata owner reuses actual C4d request derivation and stores
one exact cleaned reply in the pre-reserved policy1 ACK cell. No accounting refund,
new namespace proof or public route is introduced. Unit producer replies are synthetic;
they qualify metadata validation, not authenticated HTTP or physical cleanup.

Initial18cases passed5.36s. Expanded23cases/4files passed9.22s, including actual
compiled-worker commit with discarded response, termination, reopen and immutable
replay with unchanged usage. Controlled reply corruption and caller mutation refuse.
SQL tests cover missing/nondeterministic registration, raw writes before/after a permit,
REPLACE/update/delete, INSERT/COMMIT failure and nested-trigger substitution. Real
schema21 migration preservation and late trigger-collision rollback are included.
Reentrant insertion, unsent refusal, missing control and oversized trusted input are
also covered. Frozen affected lane98cases/21files passed48.30s; lint7.74s,
Node/frontend/runtime types17.19s, architecture5.95s, docs.64s and API build.92s
exited0. Independent review accepted the guarded metadata implementation. Private
check-runner evidence retains source identities and the initial complexity failure;
message-envelope and file-reply responsibilities were separated without lowering gates.

The historical fixture projection removes only an empty ACK schema before projecting
older control policy; it refuses if any committed ACK exists. Source application
schema is22; Agent Journal remains a separate owner/version. No full-suite or native
whole-chain success follows. The25 known unrelated baseline failures remain documented
in [control evidence](backend-cleanup-control.md). User services and images unchanged.

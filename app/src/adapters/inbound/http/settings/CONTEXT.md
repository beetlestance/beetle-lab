# Settings resource routes

`registerSettingsRoutes(server, options)` registers the six shipped GET/PATCH
installation/organisation/workspace operations using existing API contracts.
Use `createApiServer`, `configureSchemaCompilers` and composition's metadata error
classifier. The required injected `authorize` onRequest guard runs before body
parsing and all reads/writes. No anonymous fallback, session bootstrap or listener.
Route and body scope must match; wrong owner returns scoped not-found.
Application checks bounded snapshots, returned scope and effective provenance.
PATCH uses a private immutable identity read independent of runtime/effective
resolution, then existing transactional version/intent receipts. No retries.
Responses expose the Settings DTO only; admission drain is an internal store
signal. Composition must reconcile effective settings before admission; this
plugin cannot promise reliable post-commit agent propagation or kill active work.
Retention PATCH persists policy only; preview/apply/deletion remain separate.
Tests use synthetic authorization, Fastify inject and real temporary SQLite.

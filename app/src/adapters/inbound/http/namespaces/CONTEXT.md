# Namespace resource routes

`registerNamespaceRoutes(server, options)` registers shipped create/read/update/list
operations for organisations, workspaces and folders in an encapsulated plugin.
Use the API server factory and configure schema compilers before registration.
Composition MUST supply `authorize`, a session/origin/CSRF onRequest guard; there
is no anonymous fallback, listener, people/IAM or pairing implementation here.

HTTP schemas/status/paths come from the operation registry. Query parsing remains
the shared canonical page decoder. Mutation route scope must match body scope;
wrong parents return not_found. UUID case is equivalent, URN/bare remain distinct.
Application use cases own identity/version/intent checks; storage owns SQL/FKs.
ID/digest effects and reader/writer ports are injected by bootstrap.

Create replay may allocate unused fresh IDs; canonical client intent excludes
allocations, so the store returns original IDs/root. No automatic mutation retry.
Reader results are bounded/schema-checked; wrong-scope results never reach replies.
Deletion, settings, suites/runs and retention are separate resource owners.

These plugins do not establish a usable authenticated installation until session
bootstrap/proxy integration is implemented and qualified. Tests inject a synthetic
guard and use real temporary SQLite, not an anonymous product listener.

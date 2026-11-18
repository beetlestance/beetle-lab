# Capabilities

What the rewrite provides today. Open gaps live in the [backlog](../plans/backlog.md);
measurements live in [evidence](../evidence/README.md).

- Docker Compose starts separate frontend, backend, agent and k6 engine containers.
- Administrator browser sessions, organisations/workspaces, suites and immutable inputs;
  suite descriptions, stamped revisions and editable run notes; folder-first suite
  listing by latest run, with inline current names, recorded timing, group counts,
  filters and suite-name search; ordinal revision history with exact predecessors.
- Revision authoring saves suite details and config atomically; Run setup edits
  secret binding references and file/inline/range datasets. Verified input column
  discovery supplies the request value palette.
- Run/cancel, persisted results, metric history, comparison, reports and exports.
- A scoped result-metric overview supplies pooled latency, checks and bounded endpoint totals; the result UI renders these tiles and filtered endpoints.
- Scoped overviews include exact hourly submission counts and current outcomes.
- Public HTTP API, generated schemas and downloadable AI-agent instructions under
  `/reference`. An MCP server is not shipped.
- Configurable run budgets within installed limits and explicit retention controls;
  run pinning protects up to 256 runs per workspace.
- Read-only installation status (agent reachability, measured host facts, verified image/engine-version
  metadata, pool usage) and run queue position; CPU use and available memory are not measured.
- Cold backup and fresh read-only historical restoration. General in-place upgrade,
  downgrade and mutable restore are not claimed.

The legacy executable source and automatic publishing path are removed in the rewrite.
No replacement default image was promoted. Use source Compose; the old single-image
`:latest` is not the supported rewrite installation recipe.

The Docker host trust boundary is recorded in
[decision 018](../decisions/018-docker-host-trust-boundary.md).

## Anchors

| Code | Reviewed |
| --- | --- |
| `contracts/api/v2/` | `ad5b28c1d1ed` |

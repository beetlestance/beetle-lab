# Current product and release status

This is the current status owner. The acceptance ledger is an implementation and
evidence inventory, not a blanket release certificate. Historical progress reports
are indexed in [HISTORY](HISTORY.md) and retain their original source/platform scope.

## Available

- Docker Compose starts separate frontend, backend, agent and k6 engine containers.
- Local browser sessions, organisations/workspaces, suites and immutable inputs.
- Run/cancel, persisted results, metric history, comparison, reports and exports.
- Public HTTP API, generated schemas and downloadable AI-agent instructions under
  `/reference`. An MCP server is not shipped.
- Configurable run budgets within installed limits and explicit retention controls.
- Cold backup and fresh read-only historical restoration. General in-place upgrade,
  downgrade and mutable restore are not claimed.

## Open work

| Area | Gap |
| --- | --- |
| Report parity | Readable target-memory/CPU/GC sections are implemented with explicit missing values, chronology/reset checks and advisory interpretation. Native published-output acceptance remains pending. |
| Target metrics | Explicit GC total/average/maximum millisecond fields and active handles are collected. Older artifacts remain decodable; source regression checks cover the real field names. Native evidence remains pending. |
| Capacity changes | A resumable offline memory increase is implemented and applied locally at 1 GiB with preserved history. Native engine-limit proof is pending; retained output reservations currently block the verification run. Other installed-capacity changes still need support. |
| Storage and diagnostics | Queue time counts toward the five-second worker deadline; failure is sticky. Reproduce overload and improve failure reporting while preserving uncertain-write safety. |
| Sampler confinement | Corrected by appending sampling paths under the configured target and checking origin before fetch. Regression tests cover scheme-looking paths; release acceptance remains open. |
| Migration extension | Migration 026 now has its own version guard. Prior-025 upgrade coverage passes; adding a later migration still requires its own upgrade tests. Migration 015 already has a caller guard. |
| Publishing | Manual release authority/protection needs review. Existing legacy registry images remain available; merging source did not withdraw them. |
| Qualification | Reconcile release criteria and hosted evidence. The retained local repeated-memory observation does not substitute for missing hosted qualification. |
| Maintainability | Formatting, dense functions and database-row boundary validation need targeted work. A cast count alone does not prove every row is unchecked. |

The legacy executable source and automatic publishing path are removed in the rewrite.
No replacement default image was promoted. Use source Compose; the old single-image
`:latest` is not the supported rewrite installation recipe.

## Evidence boundaries

Historical source CI passed at 4fabd9fa; see [the evidence index](HISTORY.md).
Recorded native Linux amd64/arm64 checks and the 30-minute stream remain useful
within their original inputs. Neither a passing fixture nor a historical closeout
establishes complete real-workload parity or readiness after unrelated changes.
Known report and configuration gaps keep release acceptance open.

## Separate scope

A full UI redesign, additional engines, generated test cases, shared PostgreSQL/S3
storage and hosted IAM are later phases. Report content and basic configuration
usability are functional work, not deferred visual polish.

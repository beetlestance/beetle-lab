# Current product and release status

This is the current status owner. The acceptance ledger is an implementation and
evidence inventory, not a blanket release certificate. Historical progress reports
are indexed in [HISTORY](HISTORY.md) and retain their original source/platform scope.

## Available

- Docker Compose starts separate frontend, backend, agent and k6 engine containers.
- Administrator browser sessions, organisations/workspaces, suites and immutable inputs.
- Run/cancel, persisted results, metric history, comparison, reports and exports.
- Public HTTP API, generated schemas and downloadable AI-agent instructions under
  `/reference`. An MCP server is not shipped.
- Configurable run budgets within installed limits and explicit retention controls.
- Cold backup and fresh read-only historical restoration. General in-place upgrade,
  downgrade and mutable restore are not claimed.

## Open work

| Area | Gap |
| --- | --- |
| Report parity | Readable memory/CPU/GC reports pass source and packaged ARM64 checks. Independent comparisons matched 36 numeric points and three GC calculations. Isolated Playwright verifies actual displayed values, downloads and reloads. |
| Target metrics | The real packaged workload published all 121 target samples, including GC total/average/maximum millisecond fields. Older artifact compatibility and explicit missing values remain covered. |
| Capacity changes | Supported memory/output increases are applied locally at 1 GiB/512 MiB inside the unchanged 2 GiB storage allocation. History and held reservations were preserved; an actual engine run passed at the 1 GiB limit. |
| Storage and diagnostics | Real-worker slow-burst, overload, stall and uncertain-write tests pass for the no-progress watchdog and redacted diagnostics. Current packaged workload and hosted stream/conformance checks pass. Native filesystem-stall injection is not claimed. |
| Sampler confinement | Corrected by appending sampling paths under the configured target and checking origin before fetch. Regression tests cover scheme-looking paths; release acceptance remains open. |
| Migration extension | Migration 026 now has its own version guard. Prior-025 upgrade coverage passes; adding a later migration still requires its own upgrade tests. Migration 015 already has a caller guard. |
| Publishing | Release protections are applied and the read-only guard passes: default workflow token read-only, no Actions PR approvals, and akshay253101 review required for the integration-only beetle-release environment. No replacement image was published; legacy registry images remain available. |
| Qualification | Source CI and both native image jobs pass at 40c4a5c1. Hosted conformance, 30-minute stream and four-run memory/latency evidence pass within their finite scopes; see [measurements](verification/audit-corrections.md). The original conformance failure remains unexplained. |
| Maintainability | Targeted settings rows validate identity/scope/version/value schemas; malformed-row and original-receipt replay cases pass. This does not certify all SQLite rows or whole-repository formatting. |

The legacy executable source and automatic publishing path are removed in the rewrite.
No replacement default image was promoted. Use source Compose; the old single-image
`:latest` is not the supported rewrite installation recipe.

## Evidence boundaries

Historical source CI passed at 4fabd9fa; see [the evidence index](HISTORY.md).
Recorded native Linux amd64/arm64 checks and the 30-minute stream remain useful
within their original inputs. Neither a passing fixture nor a historical closeout
establishes complete real-workload parity or readiness after unrelated changes.
Scoped browser functionality passes in an isolated Playwright container. Release
protections are applied; publication still requires explicit authorisation.

## Separate scope

A full UI redesign, additional engines, generated test cases, shared PostgreSQL/S3
storage and multi-user IAM are later phases. Report content and basic configuration
usability are functional work, not deferred visual polish. Long report lines can
produce horizontal page overflow; that known presentation defect remains in the
deferred UI work, and responsive visual quality is not certified by these checks.

# Release-readiness observations at a646d39a

These observations were recorded as rows of the former `STATUS.md` "Open work"
table and were current at commit `a646d39a`. Hosted qualification ran at
`40c4a5c1`. They describe what was measured, not what remains; open work is in
the [backlog](../plans/backlog.md).

| Area | Observation |
| --- | --- |
| Report parity | Readable memory, CPU and GC reports pass source and packaged ARM64 checks. Independent comparisons matched 36 numeric points and three GC calculations. Isolated Playwright verifies displayed values, downloads and reloads. |
| Target metrics | The real packaged workload published all 121 target samples, including GC total, average and maximum millisecond fields. Older artifact compatibility and explicit missing values remain covered. |
| Capacity changes | Supported memory and output increases applied locally at 1 GiB and 512 MiB inside the unchanged 2 GiB storage allocation. History and held reservations were preserved; an engine run passed at the 1 GiB limit. |
| Storage and diagnostics | Real-worker slow-burst, overload, stall and uncertain-write tests pass for the no-progress watchdog and redacted diagnostics. The packaged workload and hosted stream and conformance checks pass. |
| Sampler confinement | Sampling paths are appended under the configured target and the origin is checked before fetch; regression tests cover scheme-looking paths. |
| Migration extension | Migration 026 has its own version guard; prior-025 upgrade coverage passes. Migration 015 already has a caller guard. |
| Publishing | Release protections are applied and the read-only guard passes: default workflow token read-only, no Actions PR approvals, and review by akshay253101 required for the integration-only `beetle-release` environment. No replacement image was published; legacy registry images remain available. |
| Qualification | Source CI and both native image jobs pass at `40c4a5c1`. Hosted conformance, the 30-minute stream and four-run memory and latency evidence pass within their finite scopes; see [audit corrections](audit-corrections.md). |
| Maintainability | Targeted settings rows validate identity, scope, version and value schemas; malformed-row and original-receipt replay cases pass. |

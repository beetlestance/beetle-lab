# Historical records and evidence

The working set no longer contains chronological rewrite task reports. Their
complete contents, failed trials and links are preserved at immutable revision
`4fabd9fa0db7c9de3fe6be8a749eeace83cfdddc` before this cleanup. These records are historical evidence, not
current status; use [STATUS](STATUS.md) for open work and supported limitations.

| Record | Immutable source |
| --- | --- |
| Verification reports | [Full directory](https://github.com/beetlestance/beetle-lab/tree/4fabd9fa0db7c9de3fe6be8a749eeace83cfdddc/docs/verification) |
| Original work packages, estimates and execution plans | [Execution archive](https://github.com/beetlestance/beetle-lab/tree/4fabd9fa0db7c9de3fe6be8a749eeace83cfdddc/docs/execution) |
| Retired live/restart smoke programs | [Native application tools](https://github.com/beetlestance/beetle-lab/tree/4fabd9fa0db7c9de3fe6be8a749eeace83cfdddc/tools/qualification/native-application) |
| Previous closeout claims, including their limitations | [Historical closeout](https://github.com/beetlestance/beetle-lab/blob/4fabd9fa0db7c9de3fe6be8a749eeace83cfdddc/docs/verification/qualification-closeout.md) |

## Selected hosted records

| Source | Record and scope |
| --- | --- |
| 4fabd9fa | [Main CI 43921220533](https://github.com/beetlestance/beetle-lab/actions/runs/43921220533): exact-source standard CI; no automatic legacy publication. |
| 0a59a1f5 | [Cutover CI 43917595258](https://github.com/beetlestance/beetle-lab/actions/runs/43917595258): 11 required gates; the merged 4fabd9fa tree is identical. |
| cf44e96a | [Native long observation 43883876529](https://github.com/beetlestance/beetle-lab/actions/runs/43883876529): AMD64 long-stream/final-drain proof; successful live-read p95 was 193.16 ms, with unavailable reads retained. |
| b48936d8 | [AMD telemetry 43877241094](https://github.com/beetlestance/beetle-lab/actions/runs/43877241094): qualifying component assembly, not a production off-mode or backend HTTP benchmark. |

Local/private reports are not published hosted artifacts. Their observations must
remain labelled local until the corresponding hosted requirement has actual proof.
Reusing any record requires matching relevant code, dependency/build/configuration
inputs and platform. Earlier failures are not relabelled by later passes.

For an offline full clone, historical files are also available with `git show`,
for example `git show 4fabd9fa:docs/verification/long-stream.md`. No second checked-out
copy is required.

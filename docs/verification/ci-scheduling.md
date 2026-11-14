# Rewrite CI scheduling

Status: locally validated workflow configuration, based on 6423cc5. Hosted
execution is unverified; no workflow was pushed or dispatched by this task.
This is the scheduling part of B10. Matched rewrite-image delivery remains open.

The old ten-minute `ci/checks` job ran the entire rewrite suite alongside source
checks. It now has three responsibilities with explicit dependencies:

| Job | Work | Bound |
| --- | --- | --- |
| `ci/source` | Existing legacy/source/generated/type/lint/architecture/docs checks, frontend/API builds and API/input smokes | 15 minutes; compiler heap 2 GiB |
| `ci/tests (N/6)` | One Vitest shard after source succeeds | 20 minutes each; three concurrent runners; 1 GiB Node heaps |
| `ci/checks` | Required aggregate gate after source and matrix | 2 minutes; both results must equal `success` |

The matrix keeps file isolation and one worker per runner. Fail-fast is disabled
so a failing shard does not hide the remaining shard results. Test output remains
in workflow logs. Existing `ci/container`, publication definitions, triggers,
permissions, action pins and concurrency policy are unchanged.

The aggregate uses `always()` to evaluate dependency outcomes and fails if either
source or matrix is failed, skipped or cancelled. Whole-workflow cancellation can
also cancel the aggregate; it does not grant a successful check. This follows
[GitHub dependency/condition semantics](https://docs.github.com/en/actions/how-tos/write-workflows/choose-what-workflows-do/use-jobs)
and the [workflow matrix contract](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax).

## Actual local checks

- `actionlint` 1.7.12 passed the actual workflow. The task-local binary came from
  its official release with the published archive checksum verified. Optional
  ShellCheck/Pyflakes integrations were unavailable; all shell steps separately
  passed Bash syntax checks.
- The actual aggregate shell step was executed for all 16 combinations of
  `success`, `failure`, `cancelled` and `skipped`. Only success/success exited 0.
- Every original source/legacy/build/smoke command was compared in order with
  the expanded old `verify:v2`. Only the test command moved to the matrix.
- The installed Vitest public sequencer, with the actual resolved configuration,
  assigned 165/165/165/164/164/164 files. Their disjoint union is all 987 configured
  files. This collected filenames without executing tests.
- YAML comparison confirmed unchanged container/publication jobs and top-level
  policy. No application source, dependency or test configuration changed.

The first collection probe found that this Vitest version's `list --shard` lists
all files. The accepted check therefore uses its real sequencer rather than
claiming that repeated lists demonstrate disjointness. An initial Python download
failed certificate validation; the system TLS trust store succeeded without
turning off verification. Private failed and passing evidence is retained.

The [combined local acceptance](integrated-acceptance.md) remains the source test
evidence. This scheduling edit does not repeat that gate, establish hosted pass
status, change branch rules or qualify release images. Required-check enforcement
and a first real hosted run still need verification after authorised publication.

# Scoped check runner

Public entry: runChecks(plan, newOutputDirectory, optionalAbortSignal) in index.ts.
CLI: node --import tsx tools/check-runner/cli.ts PLAN.json NEW_OUTPUT_DIRECTORY.
Plan: absolute cwd and 1–16 checks, each {id, argv, timeoutMs}. No shell expansion.
IDs and exact argument vectors must be unique; the whole plan validates first.
Each command runs sequentially once; failure stops the remaining plan. A new output
directory is mandatory, so reruns require a new evidence location and explicit plan.
Per-command timeout is 1–900,000ms; combined stdout/stderr is capped at 1MiB.
Timeout, output overflow or cancellation stops the POSIX process group with TERM,
then KILL after 100ms. Windows is explicitly unsupported. No automatic retries.
Logs and summary.json retain actual commands, statuses, exits, times and byte counts.
A duplicate spelling of the same semantic command cannot be detected; this runner
does not sandbox commands or replace review of a task's accepted check plan.
CLI input is bounded to 64KiB. Logs/output directories must be task owned.
Focused tests: tools/check-runner/runner.test.ts.

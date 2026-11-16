# Execution activity
Public entry: ExecutionActivity({run, terminal}), composed by RunDetail and keyed
by requested scope/run/active attempt. Uses the generated client and registered
runEvents query key. readTimeline owns at most two bootstrap reads, then one
resume read per operation. Abort signals and a retired owner fence both calls.
The single query stores projected display data only; at most 100 rows / 64 KiB
UTF-8 serialized rows, with explicit omission. No raw event corpus is cached.
Progress uses phase transitions/increasing useful units; resources are reported
container aggregates. Application Run/result remain the verdict authority.
Active polling is two seconds, pauses hidden, stops on errors. Terminal transition
waits the issued read then refreshes once and drains backlog at bounded intervals.
Retirement cancels/removes the exact query; generated client validates scope and
cursor and this owner verifies active attempt. SessionApp remounts on generation.
Focused checks: node ../../../node_modules/vitest/vitest.mjs run
web/src/features/runs/timeline --maxWorkers=1 (from assigned worktree).

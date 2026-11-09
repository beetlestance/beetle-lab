# Attempt observations

Public: mergeAttemptObservation({expected,previous,incoming}) in index.ts.
Pure bounded copied/validated snapshots; exact original identity/generation1,
nested result ownership and safe retained cursor. Output is deeply frozen.
Sequence owner validates canonical equal-sequence state/phase/result/exit and
forward immutable witnesses/phase with sticky stop/terminal states. Active states
are not numerically ranked. Greater sequence wins, independent facts merge separately.
Admission owner applies its partial order; cancellation OR, retained start max.
Unknown/missing cannot erase facts. Incomparable branches and contradictions throw
static invalid_value. No timestamp tie-breaker, I/O, ACK, charge release or outcome.
Projection returns dispatching/active/finalizing only; final admission facts request
finalization, not success. SQL atomics/finalization are separate future owners.
Contract: docs/design/lld/attempt-observation.md.
Checks: app/test/domain/run-observation*.test.ts, Node TS/lint/architecture.

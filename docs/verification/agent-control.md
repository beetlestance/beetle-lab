# Agent control intake evidence

Date: 2026-11-08. Integrated reader source: `8aea128`.
Journal/checkpoint source: `a3a0ab8`, corrected by `f57673c`.
Environment: Node26.7.0/macOS arm64, real temporary files and SQLite.

## Implemented boundary

The agent reads `control.ndjson` incrementally, with at most eight read calls and
256KiB of actual reads per pass. It retains one partial frame/read window and one
immutable pending batch, bounded to 100 events/256KiB. SQLite commits the event
batch, projection, charges and exact file checkpoint together. Identical ambiguous
replay returns the durable checkpoint after restart or event pruning.

Checkpoints preserve bigint device/inode identities, byte offset, wrapper sequence
and prefix SHA256. Their storage remains charged after event pruning. Live intake
is provisional; restart verifies the durable prefix and stopped collection rehashes
the accepted prefix under stable metadata. These checks confer no release authority.

## Independent review

The initial reader had two reproduced defects: callback reentry before ownership
reservation could leave descriptors unowned, and an ancestor symlink could bypass
the canonical-directory requirement. Both were corrected before acceptance.

Two independent reviewers verified the frozen corrected source and repeated real
filesystem probes. Budget accessors reject without invocation; descriptor/clock
reentry preserves ownership; cancelled late opens remain owned; original close
failures stay cached while independent descriptors still close. Ancestor aliases
reject, canonical input batches 100/100/5 within read budgets, stopped verification
succeeds, and a restart checkpoint with an incorrect LF count rejects.

The corrected reader passed 55 tests/seven files, scoped lint, Node TypeScript,
architecture and documentation checks before integration. Public-journal integration
exercises commit, ambiguous replay, acknowledgement, reopen and prefix verification.

At integrated source `8aea128`, `npm run verify:v2` exited 0: 2,116 tests/177 files,
all three TypeScript projects, lint, generation37/23/6, architecture599 and docs87.
The frontend build passed with the existing 611.56kB/178.59kB gzip chunk warning.
Documentation-only evidence updates were then checked separately: docs88 and
`git diff --check` passed; runtime source was unchanged.

## Remaining qualification

This is component and reader-to-journal evidence. Production controller wiring,
sealed output custody, application finalization, reservation release, private agent
HTTP and full agent/container restart qualification remain. No new Docker image
was built or published, and Linux/Node24/amd64 reader qualification is not claimed.

Subsequent prepared-attempt wiring and generic output verification are recorded
in [controller evidence](agent-controller.md), with their separate runtime limits.

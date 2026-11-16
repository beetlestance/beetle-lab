# Recorded metric source ranges

Status: locally verified functional slice; browser/release qualification pending.

The recorded-metric UI accepts a UTC interval, displays applied source bounds and
retains them through Latest/Older reads. Draft edits do not fetch; missing,
reversed/equal or pre-epoch bounds are rejected. Reset and series changes remove
the filter. Whole-run totals and coverage keep their existing meaning.

The range test uses the real generated API client for canonical cursor positions,
range echoes, source-window overlap and selected-series identity. A held exposed
API original verifies replacement abort, no concurrent replacement and suppression
of a late retired error. Existing chart limits and source gaps remain covered.

Verification: focused recorded-metric tests, changed-file ESLint and web typecheck.
The scoped check runner preserves commands, exit statuses, durations and bounded
logs in task-owned evidence directories. Initial worker fixtures violated the
client contract and failed; coordinator corrections retain those failure records.
An older null-only lifecycle expectation was aligned with the already implemented
explicit unmeasured-state behavior, rather than restoring a misleading blank SVG.

No backend schema, query contract, engine, Docker image or running service changed.
This evidence does not establish native browser interaction, live metrics,
historical retention, performance overhead or a release-qualified application.

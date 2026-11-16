# Observed k6 load guidance

DroppedLoad consumes only current verified live/recorded rows; no extra query,
cache, cumulative counter or raw warning log. Scope/unit/tag/ambiguity failures
remain unknown. Live coverage is unknown, current window only.

RecordedLoadAdvice uses actual complete-source iteration median (never HTTP
latency) plus user rate/headroom for a labelled heuristic. Inputs at most 16 characters,
rate<=1m/headroom<=500%, safe integer output; zero/partial/missing yields no estimate.
It never edits configuration/budget or infers which executor caused a drop.
Parent run/attempt/page/freshness owners retire data. F10 log classification remains.
Contract: docs/design/lld/load-advice.md; scoped load-advice/live/metrics tests.

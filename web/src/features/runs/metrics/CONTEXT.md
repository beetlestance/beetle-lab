# Recorded metric chart

Public entry: RunMetrics({run,terminal}). Generated client reads only published
metric history under registered runMetrics query key. Retains one catalogue page
and one replacement sample view <=1,000 points/1MiB. Each action reads at most ten
pages sequentially, stops on failure, and checks original selection/abort before
and after every call. No cursor-keyed history cache or accumulating run corpus.
Catalogue/series changes logically retire immutable action tokens and wait for
the exposed API original before starting the latest selection. StrictMode cannot
reactivate old actions. Scope/attempt/session changes retire callbacks. Pending catalogue
polls every2s only while visible; errors and other availability stop polling.
Terminal transition rechecks pending publication. Catalogue/sample manual actions share one admission owner. The generated client
exposes API completion, not an ignored underlying fetch settlement guarantee.
Real source gaps split chart paths; rate no-sample ratio stays null. Trends show
estimated p95 plus source bounds/scale; totals are whole-run, never selected range.
Chart y domains include zero and measured values; positive-only zero sits at the
bottom, negative-only zero at the top, and an empty or zero-only domain stays finite.
Existing design tokens, keyboard select, responsive SVG/table and no animation.
Focused checks: chart.test.tsx and scale.test.tsx in this directory.

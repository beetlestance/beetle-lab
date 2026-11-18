# Shared metric chart grid

MetricWindows renders four metric-window charts for live and recorded result views.
MetricChartPoint owns only actual chart values/time/gap state; publisher identity
belongs to live history, and sealed source identity belongs to the result read.
The finite, gap-aware LiveChart primitive and existing tokens/styles remain shared.
Hover and explicit ticks come from the caller. A p95 boundary is optional and
never changes a verdict. No reads, interpolation, timers or accumulation here.

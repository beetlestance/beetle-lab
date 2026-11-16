# Browser live metrics
Public RunLiveMetrics is selected only for the requested active Run; finalizing/
terminal detail uses sealed historical metrics. Scope/run/attempt/session changes
retire display leases immediately. Document visibility pauses reads and values.

LiveMetricReads owns <=2 actual fetch/body/hash originals, <=64KiB/4096 fragments,
fatal UTF8, subset and canonical-frame WebCrypto hashes, fixed same-origin UUID
route, five-second deadline and <=6s capture/publication/window-end freshness.
Abort retains ignored originals and late-body cancellation through actual cleanup.
The shared responseBody owns stream cancellation/closed/lock cleanup; retained
artifact reads keep exact-length verification through their thin adapter.

Poll only after the prior original settles, then wait2s. Waiting visibility resumes
have a five-second display watchdog and one replaceable wake callback, not a queue.
Scalar position checks ordering and altered repeats; unchanged frames cannot renew
monotonic expiry if wall time freezes. Only the latest20-series window is displayed;
missing values, exclusions, coalescing and upstream coverage remain explicit.

Tests: live-metrics read/position/lifecycle/detail and target-observation read cases.
Real browser qualification and packaged native activation are separate evidence.

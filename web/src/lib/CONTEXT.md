# Bounded browser primitives
responseBody owns a finite decoded response stream (<=1MiB, <=4096 fragments),
optional exact length, and actual cancellation/closed/lock cleanup before return.
Live metrics cap64KiB; target artifacts retain their exact descriptor length.
series-buffer owns the separate bounded rendering buffer for historical samples.
verified-artifact owns finite same-origin UUID artifact reads, exact metadata/body/
SHA256 checks and a5s whole fetch/body/hash/decode lifetime. One module-level owner
admits two originals across target and performance report readers; ignored abort,
body cancellation/closed, lock release and digest work retain credits until settled.
Policy is fixed by composition, never a response or engine filename. No retries.
use-artifact-report owns session/selection display leases and an independent5s
watchdog; timeout clears display/aborts without refunding reader credits. Manual
retry only. It fences same-render owner changes and late completions, with no cache.
Neither body nor series-buffer fetches, retries or owns sessions.

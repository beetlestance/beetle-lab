# Bounded browser primitives
responseBody owns a finite decoded response stream (<=1MiB, <=4096 fragments),
optional exact length, and actual cancellation/closed/lock cleanup before return.
Live metrics cap64KiB; target artifacts retain their exact descriptor length.
series-buffer owns the separate bounded rendering buffer for historical samples.
Neither primitive fetches, polls, authenticates, writes, retries or owns sessions.

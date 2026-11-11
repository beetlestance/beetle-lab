# Browser live metric consumption

Status: scoped browser-code evidence; actual-browser and packaged activation pending.

Active run detail shows the latest measured source window, with explicit missing
samples, omitted series, coalescing and upstream coverage. Leaving active state
retires that panel and uses published sealed history. No UI redesign is included.

The fixed same-origin read owns <=2 fetch/body/hash originals, <=64KiB/4096 fragments,
UTF8/shape/semantic/subset-digest validation and canonical-frame WebCrypto hashing.
Scope/attempt/generation and <=6s source/publication/capture age validate before
return. The5s budget includes parsing and both hashes. Ignored abort never releases
credit before original fetch, stream cancellation/closed/lock or hash settlement.
The target-artifact reader reuses the same finite body owner with exact length.

Only visible selected active attempts poll,2s after the previous original settles.
Scope/session/attempt/visibility changes retire values immediately. Scalar position
checks detect regressions/altered repeats and retain monotonic expiry for unchanged
frames. Source expiry removes values even during a held poll. Timed-out reads show
unavailable while retaining custody; resumed visibility uses one replaceable wake
callback and a5s waiting watchdog without issuing replacement I/O early.

Scoped tests cover actual WebCrypto, hostile/oversized/fragmented bodies, ignored
fetch/body/hash cancellation, clock/freshness/order failures, cadence, StrictMode,
selection/session/visibility retirement, held originals, expiry and detail switch
to history. Affected detail/result/target-reader regressions accompany this change.
Independent review identified the resumed-wait watchdog; a repeated hide/show test
covers that correction. Real browser tooling is unavailable in this session; these
checks do not claim browser layout, image delivery, native end-to-end or overhead
qualification. No user services or running images were changed.

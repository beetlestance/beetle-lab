# Target observation view
Public RunTargetObservations receives one scoped published target-runtime descriptor.
RunResultRead reuses resultView identity checks and rejects multiple target reports;
there is no second metadata request/poll or engine-path selector.
TargetReportReads owns shared two-original admission, no queue/retry/corpus, a5s
fetch/body/hash/decode lifetime, fixed same-origin UUID routes and strict metadata.
Exact actual bytes and SHA256 precede the shared1MiB/256sample report codec.
Browser fetch, body read/cancel/closed, lock release and digest originals settle
before admission returns. Abort is a hint; uncooperative originals retain credit.
useTargetReport fences by API session/scope/run/attempt/artifact and effect lease;
old values retire during render, old completions cannot publish, retries are manual.
StrictMode cleanup retires an abandoned effect before it issues a service call.
Summary keeps actual zero, explicit missing values, observed during peak and LAST
after reading. Missing final data never falls back to an earlier known sample.
Contradictory time/phase chronology suppresses comparison and growth hints.
Positive memory-only point growth is a labelled follow-up signal, not a leak verdict.
Raw source names/units/table remain visible. The chart owns finite coordinates and
gaps; neither view relabels target readings as engine resource measurements.
There is no live target feed here; source is the verified published artifact.
Checks: focused target-observations tests, affected result tests, web types/lint.

# Target observation view
Public RunTargetObservations receives one scoped published target-runtime descriptor.
RunResultRead reuses resultView identity checks and rejects multiple target reports;
there is no second metadata request/poll or engine-path selector.
TargetReportReads shares two whole-operation credits across report kinds, one
fetch/body wire, and a 5 s budget including waiting; no retries or corpus.
Fixed same-origin UUID routes and strict metadata precede body/hash/decode.
Exact actual bytes and SHA256 precede the shared 1 MiB/256sample report codec.
Browser fetch, body read/cancel/closed, lock release and digest originals settle
before admission returns. Abort is a hint; uncooperative originals retain credit.
useTargetReport fences by API session/scope/run/attempt/artifact and effect lease;
old values retire during render, old completions cannot publish, retries are manual.
A separate 5 s display watchdog retires hung originals without refunding credits.
StrictMode cleanup retires an abandoned effect before it issues a service call.
Summary keeps actual zero, explicit missing values, observed during peak and LAST
after reading. Missing final data never falls back to an earlier known sample.
Contradictory time/phase chronology suppresses comparison and growth hints.
Positive memory-only point growth is a labelled follow-up signal, not a leak verdict.
Raw source names/declared unit labels/table remain visible; undeclared units are explicit.
The chart owns finite coordinates and
gaps; neither view relabels target readings as engine resource measurements.
TargetReportDetails is a pure view; result cards reuse it without another read.
There is no live target feed here; source is the verified published artifact.
Checks: focused target-observations tests, affected result tests, web types/lint.

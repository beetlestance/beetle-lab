# Scoped execution binding
Public RunExecutions plus shared readExecutionBinding and bounded wire capture.
One existing worker transaction reads the scoped current Run, attempt and retained
execution owner. Live authority requires exact retained run/scope/intent ownership,
acknowledged generation1 and valid physical journal authority; no Offer/config read.
Published-result binding retains its existing source consistency behavior.
No migrations, metadata mutation, network I/O or current-capability substitution.
Worker and parent independently capture <=16KiB DTO and expected scope/run/attempt.
Tests: app/test/run-live-metrics; published result regressions: app/test/run-results.

# Original HTTP lifetime ownership

Public entrypoint: index.ts exports RequestLifetimes and RequestContext.
A request owns original metadata/native/socket promises beyond caller cancellation.
Default input admission is64; artifact content configures1 without a waiting queue.
Context captures one30s timer, monotonic deadline and AbortSignal at request admission.
Response finish releases admission only when every original has settled.
Abort fences new work; close destroys responses and drains originals before returning.
Unknown original cleanup remains retained rather than claiming a completed drain.
Focused controls: app/test/http/inputs/lifetime.test.ts and app/test/run-artifacts/lifetime.test.ts.

# Advisory fixed mailbox sink

Public createMailboxSink implements the unchanged LiveMetricSink port. Caller owns
an already initialised fixed-size file descriptor in a private bounded tmpfs.
The shared mailbox envelope owns layout/validation; no renamed or deleted paths.
Each serialized original writes busy head/footer, body, committed footer/head;
partial writes are bounded. Headers and body are charged before IO. No retry queue.
Close fences synchronously and drains write/close originals; failed cleanup stays
explicit. Neither this component nor its header grants directory/admission authority.
Native mount/file creation, Docker archive transport and scoped reads remain pending.
Focused tests: engines/k6/wrapper/live-mailbox/sink.test.ts.

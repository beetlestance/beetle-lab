# Shared output-native custody

Status: C3b prerequisite; no cleanup filesystem execution or permission.
Parent [retirement](output-retirement.md), [producer barrier](producer-retirement.md)
and [runtime authority](runtime-retirement.md).

One process-wide registry strongly owns output-native lifetimes. Existing collection
and range caps remain two each; their previous aggregate maximum is four. Cleanup
may borrow free aggregate credits, capped at two itself. It adds no independent pool,
guaranteed cleanup headroom or fairness. Capacity refusal is explicit before input
capture, descriptor traps or native factories. Control readers and producer owners
remain separately drained by the genuine C2 barrier.

Reserve a credit first, attach the actual lifetime, then capture options synchronously.
Bind its validated canonical absolute directory spelling before the first await/IO.
Readers may overlap readers. Cleanup requires exclusive overlap with every bound
reader/cleanup: equality, ancestor or descendant, with component boundaries. A task
root therefore excludes an output reader beneath it but not a sibling prefix.
Reserved unbound originals cannot be assumed disjoint; conflict checks apply in both
directions, including reentrant capture and late reader binding. A refused capture
issues no filesystem operation and returns its credit only through actual lifetime
completion. Binding is immutable; a released lease cannot reopen custody.

Scope spelling is a concurrency fence, not a native identity proof. Trusted composition
must use one canonical installed namespace spelling. Bind mounts/path aliases need
native validation or equivalent exclusion before destructive effects; lexical matching
cannot discover them. Future cleanup separately requires verified namespace/task
anchors, genuine producer/runtime capabilities, bounded native inventory and durable
plan before unlink. This registry grants none of those permissions.

OutputLifetime remains the sole owner of original IO and cached descriptor closes.
Registry release runs only on its successful actual-close path. Public result expiry,
abort, quiesced settlement or a rejected close cannot release a failed original's
strong owner, bound scope, lane credit or aggregate credit. No replacement registry
may bypass retained state. Cleanup must reuse this process-wide instance and supply
its own bounded descriptor/memory/operation limits; four owner slots are not such
limits. The registry does not close handles or duplicate lifetime logic.

Acceptance covers aggregate/lane bounds, bidirectional ancestor exclusion, unbound
capture reentrancy, sibling prefixes, actual collection/range refusal before open,
held ignored cancellation/close and sticky failed-close scope/credit retention.

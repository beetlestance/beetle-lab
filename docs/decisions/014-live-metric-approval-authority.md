# Decision014: live metric approval authority

Status: authority constraint accepted; startup handoff design/implementation pending.

A mailbox frame binds its subset with a digest. That digest proves consistency,
not permission to choose the subset or producer epoch. An approved image and a
matched container do not replace the compiler-owned catalogue approval.

The generic reader requires a detached trusted approval: exact attempt scope,
producer UUID and selected descriptors. The compiler/catalogue owner must create
it once and supply the same UUID/subset to the producer through trusted launch
configuration. The agent validates/consumes approval; it does not reimplement an
engine compiler. Do not learn approval from the first received live frame.

Currently the k6 catalogue becomes available after in-container compilation, and
the producer chooses its UUID there. A prelaunch caller cannot yet supply that
approval. A bounded independently trusted startup handoff or earlier catalogue
preparation must connect these owners before activation. This record does not
choose a new channel, authentication scheme, sidecar or per-window helper.

The reusable reader can be qualified independently with explicit synthetic
approval. Keep live profiles off until provenance, producer configuration,
authenticated routing and native end-to-end qualification are connected.

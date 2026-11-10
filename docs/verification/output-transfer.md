# Backend artifact transfer evidence

Status: locally implemented and reviewed; automatic startup and terminal settlement
remain pending. No connected real-k6 or release qualification is implied.
Owning contract: [transfer owner](../design/lld/output-transfer-owner.md).

## Source and behavior

Writer metadata: `d53464d`; transfer implementation: `fe57ffa`.
The application transfer owner connects adopted metadata, the installation's
source gateway and native output bytes. It admits two run jobs, one per exact
binding, and transfers at most128 artifacts serially with65536-byte chunks.
Publication waits for producer drain plus native result and settlement before
recording full identity and clearing the writer. Recovery reuses writer/token.
The service cannot execute engines, refund storage, delete sources or finalize Runs.

## Local evidence

The compiled metadata worker, actual native byte adapter and actual loopback
gateway served131089 binary bytes in65536/65536/17 ranges plus an empty artifact.
Published bytes and SHA-256 were compared with an independent expected value.
Cases cover zero-artifact sources, committed progress/publication reply loss,
native publication reply loss and metadata/file/service reopen with original pins.

There are38 distinct scoped cases across implementation snapshots. Final source
evidence comprises11 boundary cases, nine selected lifecycle/recovery controls and
one binary/empty composed control. Earlier22 controlled and five composed passes
are retained evidence; they were not all repeated after final boundary changes.
Changed lint, affected Node types and production import boundaries passed.
Independent source review checked14 changed paths, their hashes and18 raw logs.
Initial fixture, complexity and type failures remain recorded with corrections.

After integration with the shared result-reader changes, the composed binary/empty
control passed once more in4.23s. The combined Node check passed in9.56s. Architecture
initially found a result-reader type-import cycle; replacing its concrete lookup
dependency with a structural interface resolved it. The failed gate alone was
retried:1486 source files passed in2.90s. No full suite/build/Docker lane was run.

## Limits

Synthetic source HTTP proves this adapter connection, not a real agent/Journal/k6
run, startup polling, terminal projection, retention or resource behavior. Unknown
native cleanup remains charged and owned. Automatic scheduling, source-free error
closure, agent publication acknowledgement/deletion and staging-parent custody
remain first-release integration work.

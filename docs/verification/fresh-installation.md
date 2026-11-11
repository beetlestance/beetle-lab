# Explicit fresh installation

Status: coordinator-reviewed local component. Docker/Compose first boot and release
qualification remain subsequent work. Contract: [provisioning](../design/lld/fresh-installation.md).

## Source and behavior

Contract/boundary `da839b6`, named read-only transport prerequisite `b6c69ae`,
implementation `58cdbce`, local integration `d2c136a`. A trailing blank line was
removed in `13b7071`/candidate `741ed62`; no behavior/assertion changed.
The coordinator reviewed all17 owned paths plus the exact transport overlay.
The inherited worker reviewed root contracts; its exact model identity was not exposed.

The offline helper and strict CLI capture a bounded explicit request, inspect only
named daemon/images/network, create private exclusive files and configure the real
Journal/catalogue before completing its exact authority gate. Existing serving
startup is unchanged. Ready replay validates request/config receipts and current
read-only image/daemon facts, preserving credentials/settings/logical Journal data.
Unknown/partial/conflicting state fails without replacement or automatic reset.
One process provision owner and one CLI request reader bound admission; failed
cleanup permanently fences their respective owners and retains originals.

Review corrected cleanup classification/causes, unchanged replay after tag/daemon
changes and process-level failed-close bounds. Test-worker cache reuse now binds a
bounded source/dependency/config fingerprint and exact bundle SHA, with a private
canonical cache-root check. No production compiler/admission/authority logic was copied.

## Recorded checks

| Check | Actual outcome |
| --- | --- |
| Initial scoped installer suite | 44 cases passed,14.44s before review corrections |
| Review correction cases | 9 selected passed/41 intentionally unselected,8.25s runner/9.184s wall |
| Review Node types/lint | Passed,7.929s/1.607s |
| Test-cache correction types/lint | Passed,10.005s/2.555s |
| Coordinator composed initializer/loader plus cache check | 2 selected passed/45 intentionally unselected,3.13s |
| Coordinator cache-custody guard lint | Passed |
| Initial structure/docs gates | 1719 source files/278 documents passed; per-command elapsed times were not separately recorded |

The composed check uses actual private files, both generated configuration loaders,
Journal configuration/authority and serving gate, with synthetic bounded read-only
Docker replies. Other cases preserve a real persisted Offer across offline replay,
cover modes/links/changed facts/active gate, strict CLI, held originals, short/zero
writes and failed-close fencing. It does not open the serving backend or an engine.

The one small Journal worker bundle is843600bytes, SHA256
`07b7e811f5afcba8b42a38d76c0c394e6f44e48b6b5ea2adeb6cb4b0e06400e9`.
The coordinator source fingerprint covered435 files/1718570 source bytes. A removed
initial test bundle was replaced; the source-bound replacement was reused.
No full project/image build or full test suite was run for this component.

## Limits

Receipt rename/parent fsync/close are commit IO. A post-rename error may leave ready
bytes visible without a successful result; later offline invocation fully validates
and re-syncs before reporting unchanged. Packaging must require successful command
completion, not marker presence alone.
DockerTransport exposes request completion, not physical settlement of an injected
transport that ignores cancellation. Native file/Journal cleanup is retained at its
own boundary. Backend metadata-loader validation is covered; actual settings-table
mutation was not exercised here. Normal SQLite open/checkpoint IO is not a claim of
byte-identical database files.

No actual Docker inspection/container launch, Compose/image-pull installation,
real engine/browser, native architecture, resource-overhead or release qualification
follows from these checks. Initial fixture incompatibilities were corrected against
existing validators; no gates/assertions were weakened.

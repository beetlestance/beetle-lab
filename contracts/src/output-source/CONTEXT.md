# Public output manifest values

The public entrypoint owns shared manifest types, closed value capture, identity,
sealed result and exact raw/control/artifact counts, canonical preimages and errors.
prepare accepts PublicCore; verify accepts PublicManifest. Both return owned frozen
data and invoke digest providers only after complete captured value validation.

Inputs must already be bounded producer carriers or parsed from byte-bounded data.
Reflection is not a memory sandbox for arbitrary foreign JavaScript graphs.
No private root/path/runtime/checkpoint/release facts, Node filesystem modules,
native custody, physical release authority or result publication belongs here.

The internal subpath shares primitives with the trusted private agent wrapper;
it is not a separate SDK or an authority API. Golden vectors live in contracts/fixtures/output-source.
Runner JSON schemas own public binding/manifest/receipt/closure shapes. Shared
types alias generated structures; codecs retain owned readonly values, digest
preimages and independent manifest/result byte caps. Envelope verification matches
its complete receipt tuple but callers must still bind their retained original.
Chunk verification requires the manifest-declared byte length, validates canonical
base64 without decoding, and proves only provisional range values.
Contract: docs/design/lld/output-public-values.md and output-transfer.md.
Focused check: vitest run contracts/test/output-source.test.ts agent/test/output-source.

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
it is not a separate SDK or an authority API. Golden vectors remain agent-owned.
Contract: docs/design/lld/output-public-values.md and output-source-commit.md.
Focused check: vitest run contracts/test/output-source.test.ts agent/test/output-source.

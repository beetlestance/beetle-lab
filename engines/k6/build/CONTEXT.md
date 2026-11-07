# Native script builder

`buildRuntimeScript({suite,outputDirectory,attempt})` emits `suite.js` and returns its
path/byte count. Input is the accepted immutable compiled plan, never secret
values. A two-pass token serializer bounds plan data at 24MiB before any writes;
only <=640KiB chunks are written. This leaves conservative code/encoding headroom
under the hard 64MiB script cap. The pinned tsup bundler processes that bounded
source; flat owned runtime/plan source is admitted at <=2MiB before bundling.
Provenance rejects inputs outside those owners and staging data. UTF-8 emission
avoids ASCII-escape amplification; actual output is also checked against 64MiB.
Only the four used k6 API modules remain external. No compiler validators, Node
modules or duplicated runtime strings enter the output. Temporary build files
are removed on success/failure. Generated entrypoints match the compiled metadata.

Serializer depth104 derives from public JSON depth32: each object body level
adds at most3 IR edges (`entries`/index/`value`); the suite-to-body path adds4
and a template leaf adds4 (`template`/`tokens`/index/`value`). Public JSON depth,
serializer node and byte limits remain separate admission bounds.

The required private attempt has explicit managed/standalone mode (see runtime
context). Reusable standalone metadata has a timeout and no epoch deadline; setup
returns only its numeric deadline. Managed launches require an absolute deadline.
Setup respects that authority and the accepted readiness wall budget. Native summary
writes <=1MiB of numeric metric/threshold evidence to `beetle-evidence.json`.
The wrapper must provide the isolated working directory and hard container limits;
this builder does not implement protocol envelopes, artifact sealing or outcome.
Checks: runtime build tests and the manually invoked native no-network probe.

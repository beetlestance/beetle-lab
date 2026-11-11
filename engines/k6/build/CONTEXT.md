# Native script builder

`buildRuntimeScript({suite,outputDirectory,attempt})` emits `suite.js` and returns its
path/byte count. Input is the accepted immutable compiled plan, never secret
values. A two-pass token serializer bounds plan data at 24MiB before any writes;
only <=640KiB chunks are written. This leaves conservative code/encoding headroom
under the hard 64MiB script cap. The pinned esbuild bundler processes that bounded
source; flat owned runtime/plan source plus the exact Node-free k6-metrics policy entry
is admitted at <=2MiB before bundling. Provenance rejects all other sources;
shared policy resolution uses the installed package export, not job-supplied paths. UTF-8 emission
avoids ASCII-escape amplification; actual output is also checked against 64MiB.
Only the four used k6 API modules remain external. No compiler validators, Node
modules or duplicated runtime strings enter the output. Temporary build files
are removed on success/failure. Generated entrypoints match the compiled metadata.
Owned files use mode0600; an existing suite.js is rejected before build writes.
Optional `maximumBuildBytes` is a caller-reserved logical file-byte allowance:
plan + entry + bundle coexist during build, so all three count toward the peak.
Plan admission happens before opening its file. esbuild `write:false` returns one
in-memory bundle; provenance and bytes are checked before writing it. No bundler
postprocessor can enlarge the file after admission. Return `peakBytes` separately from
the retained script's `bytes`. Cleanup does not refund an unconfirmed removal.
The wrapper must reserve other concurrent journal/collection/artifact output;
this sub-budget is not an installation-wide counter or a physical disk quota.

Serializer depth104 derives from public JSON depth32: each object body level
adds at most3 IR edges (`entries`/index/`value`); the suite-to-body path adds4
and a template leaf adds4 (`template`/`tokens`/index/`value`). Public JSON depth,
serializer node and byte limits remain separate admission bounds.

The required private attempt has explicit managed/standalone mode (see runtime
context). Reusable standalone metadata has a timeout and no epoch deadline; setup
returns only its numeric deadline. Managed launches require an absolute deadline.
Setup respects that authority and the accepted readiness wall budget. Native summary
writes <=1MiB of numeric metric/threshold evidence to `beetle-evidence.json`.
The wrapper must provide an exclusively owned working directory and hard container limits;
this builder does not implement protocol envelopes, artifact sealing or outcome.
Checks: runtime build tests and the manually invoked native no-network probe.

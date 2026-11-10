# Scoped result read evidence

Status: locally implemented, independently reviewed and integrated. Connected
real-k6 finalization and reads are [locally verified](native-application-k6.md).
Browser and release qualification remain pending.
Contract: [result reads](../design/lld/run-result-read.md).

## Implemented path

Backend source: `85ed17b`, dependency correction: `56665d6`; UI source: `9e3e595`.
The authenticated result route resolves the current scoped Run/attempt in one
metadata transaction and reads the sole verified source manifest. Pending source
returns null; corrupt or contradictory retained evidence fails explicitly.
No duplicate result body or read-side terminal/accounting effects are introduced.
Requests are bounded4096 bytes, metadata replies73728 bytes and share the existing
two-large-original worker lane. General public HTTP retains its2MiB ceiling;
operation-specific response capture also applies the73728-byte bound.

RunDetail uses the generated client and keys results by organisation/workspace/
run/attempt. Retirement aborts and removes the old query; panel guards bind engine
and generation. Loading, errors, null and verified evidence remain distinct.
Only authoritative Run state removes the provisional label. Artifact declarations
do not grant download/publication authority.

## Evidence

Backend SQLite, compiled-worker and actual authenticated loopback HTTP cases cover
scope/attempt ownership, null/adopted results, seal/carrier corruption, large reply
queue limits, reopen, production wiring and missing-capability503. Initial16 cases
had13 passes and three HTTP fixture failures; those three passed their corrected
selection. Eight read controls and one corrected worker case also passed. Changed
lint and the corrected affected Node typecheck passed. Independent review checked
all16 changed paths, required-read hashes and actual evidence logs.

UI scoped tests cover late successes/errors across organisation/workspace/run/
attempt changes, abort/unmount, cache removal, pending polling, terminal recheck,
HTTP failure and mismatched response identities. All22 new cases passed initially.
The100-case run had96 passes and four existing synchronous-null assertions that
needed to await the new read; their focused retry passed. Changed lint and one web
typecheck passed. Coordinator review inspected the seven changed paths, actual
assertions/logs and27 final-source hashes. No passed UI suite was repeated.

The combined transfer/native/metadata control and architecture correction are
recorded in [transfer evidence](output-transfer.md). Browser screenshots and a real
engine result through this UI have not been qualified. Result visibility alone
does not prove artifact publication or terminal settlement.

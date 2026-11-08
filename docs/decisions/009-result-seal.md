# Engine result content seal

Status: selected protocol-v1 algorithm; persistence/finalization wiring pending.
Public owner: contracts `sealEngineResult`, `verifyEngineResultSeal` and
`engineResultSealPreimage`. This is not an authentication protocol or a test verdict.

The digest preimage is UTF-8 bytes of `beetle-lab.engine-result.v1` followed by LF,
then canonical JSON of the complete EngineResult with only `seal.sha256` omitted.
`seal.sealedAt` remains covered, as do scope, generation, observations, thresholds,
assertion counts and artifact identities/digests. Do not hash a digest into itself
or omit the whole seal object, which would leave its timestamp unbound.

Canonical objects order keys by UTF-16 code units; arrays retain their exact order.
Use ECMAScript JSON string/finite-number encoding, without whitespace or Unicode
normalization. Protocol-v1 result object keys are schema-defined ASCII. Equivalent
object insertion order has the same digest; reordered arrays or changed values do
not. Do not describe this narrow result codec as a general RFC8785 implementation.
The versioned prefix separates result content from unrelated SHA256 uses.

Validate and snapshot bounded JSON before canonicalizing: maximum 1 MiB JSON,
depth 64, 65,536 nodes and 4,096 entries per collection. SHA256 comes from a trusted
local provider and must return 64 lowercase hexadecimal characters. There is no
wire-supplied hash callback. Results are immutable private snapshots;
invalid inputs/provider errors return fixed codes without exception or payload text.
`sealEngineResult` takes an unsealed body and explicit timestamp. Existing seals
must be verified or intentionally removed by the caller before creating a new one.

Normative fixtures in `contracts/fixtures/seal-v1` include a complete result,
preimage and independently generated SHA256. Structural interoperability fixtures
elsewhere may contain placeholder hashes; structural acceptance does not verify them.

A matching seal proves content identity only. It does not authenticate a runtime,
prove artifact existence, conserve assertion counts, authorize reservation release
or establish that an outcome is correct. The wrapper/application must validate
execution evidence and scoped artifacts independently. Smaller control-frame,
persisted-output and finalization budgets still apply before publication.
Atomic file publication, recovery and terminal acknowledgement remain separate work.

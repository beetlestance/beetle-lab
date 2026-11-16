# Shared public source values

Status: implemented and independently reviewed shared value component. The
accepted [source commit](output-source-commit.md) owns all existing value grammars,
bounds and digest preimages. This extraction changes no identity or wire format.

Public entrypoint @beetle/contracts/output-source owns SourceScope, SourceBinding,
Owned, PublicCore, PublicManifest and SourceReceipt from types.ts. Agent private
types re-export these exact types instead of maintaining another definition.
Private root/checkpoint/launch/runtime/intent types and native validation stay agent-owned.

prepareOutputManifest(unknown, ResultDigest) accepts exactly PublicCore and returns
an owned recursively frozen PublicManifest. verifyOutputManifest(unknown,
ResultDigest) accepts exactly PublicManifest, rechecks its complete result seal
and public manifest digest, and returns an owned frozen PublicManifest. Both use
the existing lower-hex SHA256 domain prefix, canonical JSON, exact public/result/
node/depth/count limits and OutputSourceError codes. Capture before foreign digest
callbacks; preserve original UUID spelling and generation1. Neither proves files,
physical Journal custody, engine outcome or backend original/runtime-plan authority.

Private agent prepare/verify reuse these public functions and shared field/count/
binding validation. Preserve all existing private source/receipt/intent signatures,
preimages, fixed vectors, byte accounting and original-request ownership. Native
root/path, checkpoint and settled release checks remain in their existing owners.

The internal package subpath is compatibility support for the trusted agent codec:
extract existing bounded capture/canonical/closed-field/freeze/error primitives
and pure public scalar/identity/result/count checks there. One implementation per
rule; no app/engine consumer may treat that internal subpath as an SDK or source
custody API. Public module graph must have no agent/app/Node filesystem imports.
Already bounded producer carrier or byte-bounded parsed input remains an explicit
precondition: native own-key reflection is not a resource sandbox for arbitrary JS.

Root owns package exports and this frozen types.ts. The implementation task owns
its new modules and agent aliases/call sites, without root dependency edits. Verify
all existing independent vectors, new public-only ownership/negative/provider cases,
affected private source codecs and one compiled Journal source transaction seam.
The original extraction added no endpoint, migration or SDK publication.
Subsequent [transport values](output-transfer.md) move structural binding/core/
manifest/receipt/closure ownership to runner JSON schemas and generated aliases;
shared semantic codecs remain the same owner of counts, seals and digest preimages.
See [value evidence](../../verification/output-transfer-values.md). Actual native
transport and backend publication remain separate pending implementations.

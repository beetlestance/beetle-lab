# Retirement request/reply wire values

Status: C4a values implemented; no private route, backend ACK or settlement implied.
Parents: [retirement](output-retirement.md), [producer](producer-retirement.md),
[native receipt](native-receipt.md). Shared package: contracts/output-retirement.

The existing closed protocol1/performance request stays <=3072 UTF-8 bytes, with
canonical backend Run/deletion UUIDs, exact original/Journal authority spelling,
generation1/deletionVersion1 and source/absence closure. Its existing domain-prefixed
canonical SHA256 identity remains unchanged; do not invent another digest algorithm.

OutputRetirementReply is a closed <=4096 UTF-8-byte union. Both states echo exact
version/purpose, organisation/workspace/attempt/generation, intentDigest, physical
journalAuthority, Run/deletion IDs/version, retirementVersion1 and requestDigest.
The digest binds the COMPLETE expected request, including closure digests and final
sequence. Shape alone cannot express this relation: the codec captures the expected
request and compares every identity field and recomputed canonical digest. Preserve
exact original and physical-authority spelling; backend IDs remain canonical.

Pending contains state=pending and forbids all cleaned closure fields. Cleaned adds
exact64-lowercase-hex namespaceIdentity, preparationIdentity and cleanupReceiptDigest.
Here preparationIdentity means C1 taskNamespaceIdentity, NOT the backend's separate
file-removal preparation commitment. The receipt digest identifies the durable agent
NativeCleanupReceipt. No path/native facts/config/artifact list/refund or internal
stage errors cross this value boundary. Unknown fields refuse; never silently drop
a pending reply's closure claims.

Capture enforces the complete UTF-8 bound before parsing/cloning, validates the shipped
schema without mutation and freezes the all-scalar reply. The hasher is a trusted
injection; shared runtime code imports no Node crypto. Fixed vectors cover source and
absence requests and both response states. Reordering request fields does not change
the canonical digest; changing closure or original spelling does.

The codec checks metadata, not authentication, actual IO, native quiescence or refund
permission. Only trusted native finalization may produce cleaned, including replay;
a stored row or valid JSON is never a shortcut. Future C4 transport must use existing
credentials and expected-Journal-authority binding, match the exact committed backend
deletion request after backend file receipts, and consume trusted finalization.
No availability descriptor/route is registered by adding these schemas. Pending and
cleaned HTTP status/carrier orchestration belong to the subsequent route contract.

Acceptance: schema/byte/closed shape; four fixed fixtures; independent digest vectors;
all scope/authority/deletion mismatches; source/absence/final-sequence mutation;
case preservation; pending closure claims; accessors/oversize input; malformed hash
output and no accidental native/settlement authority.

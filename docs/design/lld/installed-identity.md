# Installed execution identity

Status: first-release contract amendment in implementation. This unreleased runner
protocol retains version1.0; before release its conformance corpus defines one
required bound Offer, with no unpinned new-admission path.

## One persisted binding

Offer.installedIdentity is required: manifestId, profileId, catalogVersion,
manifestDigest, profileDigest and schemaDigest. IDs are opaque case-sensitive
strings<=128; version is a positive safe integer; digests are lowercase SHA256.
The engine selector (engine ID/image digest/config version) remains separate.
The backend's browser-facing engine profile name is a local alias, never the
agent profileId. All six fields participate in the full immutable Offer intent.

Agent registration derives content digests from its actual captured immutable
manifest and complete approved runtime profile. It never trusts supplied digest
labels or resolves secrets to hash them. Capability entries advertise the exact
binding and configVersion; they expose hashes rather than private profile paths.
New enqueue and recovery compare all six fields exactly against that registration.
Changing semantics while retaining the engine selector or opaque IDs must reject.
A preceding capabilities GET is not authorization to select newer semantics on PUT.

## Shared canonical hashing

contracts owns encodeCanonicalJson: same JSON/UTF8/depth/node/collection bounds as
encodeJson, with each object's keys sorted by UTF16 lexical order. Arrays retain
order; numeric keys are lexical too. Reject getters, non-JSON/cycles and oversized
input before finalization. The shared encoder preserves existing mutation, journal
and engine-result seal preimages; this amendment does not redefine those digests.

Descriptor canonical JSON is<=65536 UTF8 bytes. SHA256 receives UTF8 of:

- `beetle-lab.installed-manifest.v1` followed by LF then the complete manifest JSON.
- `beetle-lab.installed-profile.v1` followed by LF then the complete profile JSON.

Manifest is structurally validated against EngineManifest. Runtime profile semantic
validation remains agent-owned; shared hashing requires a bounded JSON object.
The schema digest retains its existing installed-schema definition. Shared identity
creation accepts only the four opaque/schema labels plus manifest/profile objects;
it computes both content digests and freezes the result. It authenticates nothing.

## Intake, replay and recovery

After structural bounded Offer intake, an identical already accepted scoped attempt
may return its original snapshot before current-catalog validation. Conflicting
canonical contents still reject. A new attempt must match current installed binding
before any new durable acceptance, provider work or runtime effect. Recheck the
same binding for prepare/start/recovery through the existing catalogue owner.
Never change an outbox Offer to match a changed catalogue or allocate a replacement
attempt on transport failure. Terminal results still need independent exit/seal/
artifact finalization; content hashes do not certify execution or resource controls.

Pre-amendment WIP records are not legacy product data to migrate. Preserve their
bytes, identity, charges and diagnostics. Missing bindings reject new intake and
must not be synthesized, rewritten or dispatched. Read-only reconciliation remains
available where it does not require new preparation; unknown executions remain
charged. Explicit quarantine/startup and application outbox blocking behavior must
be implemented before normal dispatch is enabled; no compatibility write path.
Applied migrations are unchanged. Future storage changes reserve a new migration.

## Required proof

Golden canonical/digest vectors, reordered and numeric object keys, array order,
mixed UTF8, hostile getters/cycles/depth/collections and final byte overflow.
Every identity field and any manifest/profile semantic change rejects before new
journal/runtime effects. Same-selector GET/PUT drift, accepted exact replay after
catalogue change, missing-old-binding recovery and full-size Offer propagation
must preserve one attempt without silently upgrading or re-executing target work.

# Domain and storage contracts

Status: proposed. Ownership: application domain and metadata/artifact adapters.
Read [execution](execution-protocol.md) for the agent's independent journal.

## Domain identities

Use opaque UUIDs for organisation/workspace/folder/suite/run/attempt/artifact IDs.
The [organisation/settings contract](organization-settings.md) owns hierarchy rules. A suite
revision is immutable and has schema version, engine ID/version range, redacted
configuration, input manifest and content digest. Revisions never change in place.
Run creation pins the suite revision, engine image digest and declared run budget.

Digest only non-secret inputs. Identify secrets by opaque reference/version, not
plaintext hash or environment dump. A missing/unversioned secret marks input
reproducibility unknown; matching redacted digests are insufficient for equality.

## Lifecycle

| Object | States | Transition owner |
| --- | --- | --- |
| Run | queued, dispatching, active, finalizing, finished, cancelled, errored | Application use cases |
| Attempt | offered, admitted, preparing, running, stopping, collecting, exited, lost | Agent evidence; application mirrors |
| Outcome | pending, passed, failed, inconclusive | Result validator |
| Artifact | staging, uploaded, verified, failed, deleting, deleted | Artifact service |

Terminal run states cannot return to active. A retry adds an attempt and explicit
new execution intent; terminal prior attempts remain immutable. Queue cancellation
needs no engine. Active cancellation records intent before contacting the agent.

Outcome rules: ordinary k6 runs fail on configured threshold failure or failed
required assertions; invalid configuration/startup/OOM/timeout is an execution
error with inconclusive outcome. Discovery mode names its expected abort rule:
that rule firing can satisfy discovery, while unrelated assertion/SLO failures
still fail. Exhausting the search range without reaching the rule is inconclusive.
Cancellation is not a test failure or pass. Missing data remains unknown, not zero.

A stop/cancel intent winning the persisted transition before terminal closure
produces cancelled; a cancel after committed closure returns the existing result.
The supervisor seals the terminal observation so reconnects cannot reverse it.

## Application SQLite model

| Table | Essential fields and constraints |
| --- | --- |
| organizations | id, name, slug, created_at; unique installation slug |
| workspaces | id, organization_id, name, created_at; unique org/name |
| folders | id, organization_id, workspace_id, parent_id, name; unique workspace/parent/name |
| suites | id, organization_id, workspace_id, folder_id?, name, current_revision_id |
| settings | scope_type, scope_id, schema_version, value_json, version; unique scope/id |
| suite_revisions | id, suite_id, revision, schema_version, engine_id, config_json, input_manifest_json, digest; unique suite/revision |
| runs | id, organization_id, workspace_id, revision_id, settings_snapshot_json, state, outcome, version, requested_at, active_attempt_id, cancellation_at, terminal_reason |
| attempts | id, run_id, ordinal, agent_id, generation, image_digest, budget_json, state, exit_code, result_digest; unique run/ordinal |
| dispatch_outbox | attempt_id, intent_digest, next_offer_at, acknowledged_at; unique attempt_id |
| event_cursor | attempt_id, last_agent_seq; unique attempt_id |
| run_events | run_id, attempt_id, seq, type, observed_at, payload_json; unique attempt_id/seq |
| artifacts | id, attempt_id, kind, storage_key, bytes, sha256, state, created_at, expires_at |
| result_summaries | attempt_id, schema_version, engine_summary_json, completeness, counts_json; one per attempt |
| case_results | attempt_id, case_key, outcome, duration_ms, artifact_refs_json; unique attempt/case_key |
| secret_refs | workspace_id, name, provider, opaque_locator, opaque_version; no secret value |

Raw samples and logs are compressed/chunked artifacts, never one metadata row per
request/sample. Summary queries page stable indexes. Candidate indexes: runs by
workspace via suite/revision and request time; attempts by run/ordinal; events by
attempt/seq; artifacts by state/expiry. Schema task must verify query plans against
representative fixtures; this table is a design contract, not an applied migration.

One application storage worker owns the SQLite connection and executes bounded
commands. WAL, foreign keys, explicit transactions and bounded busy/query timeouts
are configured centrally. No adapter opens a connection behind a handler's back.
Keep write transactions short; no HTTP, object upload or engine call inside one.

## Atomic operations

- Enqueue: create run, attempt and dispatch outbox in one transaction. Request
  idempotency key plus canonical intent digest returns the same run; mismatched
  reuse returns conflict. Persist keys at least as long as retained run metadata.
- Offer acknowledgment: record admitted identity/generation and clear outbox
  delivery together. Retrying transport never creates a different attempt ID.
- Ingest events: insert only unseen sequences, update cursor/state in one
  transaction, then acknowledge. A sequence gap requests replay before later events.
- Finalize: require known exit, valid sealed engine result and verified required
  artifact refs, then update result summary and terminal run state atomically.
- Delete: mark deletion intent first, reject active-run deletion, remove artifacts
  idempotently, then tombstone metadata. Maintenance retries interrupted deletion.

Use optimistic row versions for user mutations and state transitions. A stale
version returns conflict rather than overwriting newer cancellation or completion.

## Artifact interface

`begin(attempt, kind, expectedSize?) -> uploadId`; `append(uploadId, offset, bytes)`;
`seal(uploadId, size, sha256) -> artifact`; `read(key, range)`; `delete(key)`.
Uploads support offset/status reconciliation and reject mismatched repeated data.
Unknown sizes are allowed only inside an enforced attempt/store quota.

Local adapter writes to an installation-owned staging directory, validates path
containment and symlink policy, flushes file data and atomically renames within the
same filesystem before publication. Engine outputs are untrusted paths, never
served directly. No absolute paths or parent traversal in plugin requests.

S3 adapter later maps this contract to object/multipart operations. Uploads and
SQLite/PostgreSQL commits are not atomic together. A bounded maintenance pass
verifies pending publications and removes expired unreferenced staging objects.
Read APIs expose publication/completeness; an uploaded-but-unverified artifact
cannot be downloaded as a verified report.

## Data layout and custody

```text
app-data/metadata.sqlite
app-data/artifacts/<organization>/<workspace>/<run>/<attempt>/<artifact-id>
app-data/staging/<upload-id>
agent-data/journal.sqlite
agent-data/spool/<attempt>/<generation>/
```

The agent never mounts the application database. Artifact transfer is local API
streaming in v2; future scoped S3 upload URLs preserve the same ownership. Engine
containers mount only their staged inputs, run output and private scratch space.
Secrets are resolved immediately before launch into restricted transient files,
not command-line arguments, persisted job JSON or global child environment.

Initial retention defaults to manual deletion, matching the existing product.
Users may enable age/count/storage retention through organisation/workspace UI
settings and select installation disk allocation/free-space reserve. Warn before
it fills; no fixed product storage requirement. Active outputs reserve bytes.
Insufficient space blocks new admission; it does not silently enable deletion.
Preview and explicitly apply changes affecting retained data. The bounded janitor
excludes active/pinned results; handlers never perform an unbounded purge.

## Upgrade and recovery

No v1 import or historical rollback window: the sole user confirmed legacy data
was deleted. Fresh v2 root only. Version future v2 schema migrations with
transactional upgrade and tested backup/restore. Refuse a future schema. Back up
SQLite through a supported consistent snapshot including WAL semantics, then copy
only sealed artifact references plus a manifest. Restore validates missing objects
before exposing results. Never treat a copied live database file as a proven backup.

Optional PostgreSQL keeps the repository operations, not SQLite SQL text or locking
assumptions. Multi-instance claims/transactions, tenant authorization and coordinated
retention require a separate qualification before shared mode is supported.

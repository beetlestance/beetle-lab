# Storage

Application metadata, the agent journal and installation files have separate
owners. The backend metadata worker (`app/src/adapters/outbound/sqlite/`) owns
application state; the agent journal owns execution evidence; neither opens the
other's database. The administrator browser session persists through the
metadata worker.

## Identities and pins

- Organisation, workspace, folder, suite, revision, run, attempt and artifact IDs
  are opaque UUIDs. Hierarchy rules belong to the settings and namespace domain
  (`app/src/domain/namespaces/`, `app/src/domain/settings/`).
- A suite revision is immutable: schema version, engine, redacted configuration,
  input manifest and content digest. Revisions never change in place; indexed
  revision pins serialize with deletion.
- A run pins its revision, engine image digest, settings snapshot and effective
  budget at creation.
- Secrets are identified by opaque reference and version, never by a plaintext
  hash; only non-secret inputs are digested.

## Lifecycle

States are the closed enums in `contracts/src/generated/common.ts`.

| Object | States | Transition owner |
| --- | --- | --- |
| Run | `queued`, `dispatching`, `active`, `finalizing`, `finished`, `cancelled`, `errored` | application use cases and metadata transactions |
| Attempt | `offered`, `admitted`, `preparing`, `running`, `stopping`, `collecting`, `exited`, `lost` | agent evidence; application mirrors |
| Outcome | `pending`, `passed`, `failed`, `inconclusive` | result validation and output finalization |

| Invariant | Enforced by |
| --- | --- |
| Attempt observations only move forward: `stopping` → `stopping`/`lost`/`exited`; `lost` → `lost`/`exited`; `exited` is final; phases never regress; result, export result and exit evidence never change once set | `app/src/domain/attempt-observation/sequence.ts` |
| `finished` carries `passed`, `failed` or `inconclusive`; `cancelled` and `errored` carry `inconclusive`; non-terminal runs carry `pending` | `contracts/src/api/overview.ts` |
| Terminal runs never return to active; no automatic second attempt or target-load retry exists | metadata run transitions, runner delivery |
| A cancel that wins the persisted transition before terminal closure produces `cancelled`; a later cancel returns the existing result | output finalization trigger |

Outcome rules: an ordinary k6 run fails on a failed threshold or required
assertion. Invalid configuration, startup failure, OOM or timeout is an execution
error with an inconclusive outcome. A discovery run may pass by reaching its
named expected-abort rule; unrelated failures still fail, and exhausting the
range without reaching it is inconclusive. Cancellation is neither pass nor fail.
Missing data stays unknown, never zero.

## Metadata worker

| Setting | Value |
| --- | --- |
| Connection | one worker, one exclusive WAL SQLite connection (`metadata.sqlite`) |
| Pragmas | `synchronous=FULL`, `foreign_keys=ON`, cache 2 MiB, busy timeout 100 ms, `locking_mode=EXCLUSIVE` |
| Queue | default 32, maximum 64 including in-flight work; close keeps one slot |
| Worker heap | ≤ 128 MiB |
| Startup / stall | 5 s to start, then 5 s without a completed reply |
| Schema | `user_version` 36; a newer database refuses with `schema_newer` |

- No adapter opens a connection outside the worker. Write transactions are short:
  no HTTP, file publication or engine call happens inside one.
- Migrations are transactional and ordered (`migration0NN.ts`); applied
  migrations never change. A storage change reserves a new migration number.
- Unknown outcomes never trigger an automatic mutation retry. Close drains
  admitted FIFO work and waits for worker termination.

## Atomic operations

| Operation | Rule |
| --- | --- |
| Public mutation | Receipt-first: scope + request ID + intent digest in `receipts`; same digest replays the stored reply, a different digest is `conflict` (`mutation-receipts.ts`) |
| Enqueue | `runs`, `attempts` and `dispatch_outbox` rows insert in one transaction (`runs.ts`) |
| State change | Optimistic row versions; a stale version is `conflict`, never an overwrite of a newer cancellation or completion |
| Event ingest | `run_events` keys on attempt, generation and sequence behind `event_cursors`; one immediate transaction appends only a contiguous suffix (batch ≤ 100 records, 262144 bytes); a gap past retained agent history records `cursor_expired` with partial coverage; no ACK is sent inside the transaction (`event-custody/`, migration 007) |
| Finalize | One immediate transaction requires settled release, published output slots, contiguous events and full acknowledgement, then inserts one immutable receipt that projects the terminal run (`output-finalization/`) |
| Namespace deletion | One `BEGIN IMMEDIATE` owns receipt replay, quiescence and transition; organisation and folder delete only when empty; permanent 2048-byte markers fence identity reuse (`namespace-deletion/`) |
| Run pin | One immediate transaction owns receipt replay, the terminal-state and admitted-removal checks and the 256-per-workspace `run_pins` count; triggers refuse a pin of a nonterminal or admitted run, a pin or unpin inside a retention frame or retired workspace, any pin update, and any removal intent for a pinned run; insert and delete advance the retention epoch (`run-pins/`, migration 033) |

Raw samples and logs are chunked artifacts, never one metadata row per sample.
List and history reads use fixed covering indexes and bounded cursors.

## Data layout and custody

```text
<root>/backend/metadata.sqlite
<root>/backend/inputs/{staging,published}/
<root>/backend/outputs/{namespace.sqlite,staging,published}
<root>/agent/journal/journal.sqlite
<root>/agent/staging/
```

- Roots are installation-owned fixed paths, never HTTP-supplied; each new child
  and parent is flushed before any file is acknowledged
  (`app/src/bootstrap/private-roots.ts`). Paths are ≤ 1024 bytes and ≤ 32
  components.
- The agent mounts published inputs read-only and never mounts the metadata
  database. Engine containers mount only staged inputs, run output and scratch;
  engine output paths are untrusted and never served directly.
- Secrets resolve immediately before launch into restricted transient files, never
  command-line arguments, persisted job JSON or global environment.

## Retention and space

- Default retention is `manual`. Age, count or storage retention is opt-in per
  organisation or workspace, previewed and applied explicitly.
- Active outputs reserve bytes. Insufficient storage blocks new admission; it never
  enables deletion. The bounded janitor excludes active and pinned results.
- Retention selection is owned by [settlement](outputs-settlement.md#retention-selection).
  Parent previews walk one workspace per turn with a captured horizon and never
  combine budgets. `driverState` is advisory: `running` is loop availability, not
  agent reach, progress or funding ([owner](../../../app/src/bootstrap/CONTEXT.md)).
- Run pins (≤ 256 per workspace, terminal runs only) exclude a run from selection
  and from manual delete. A run already admitted for removal cannot be pinned
  (`cleanup_in_progress`). Pins stay with retained rows through workspace
  retirement; restored history shows them read-only. Pin rows are not charged to
  workspace storage.
- Backups and restore follow
  [decision 016](../../decisions/016-historical-restore.md); a copied live
  database file is never treated as a backup.

## Administrator session

`app/src/adapters/inbound/http/session/` owns one administrator session; the
metadata worker persists it (`local-session/`, migration 014). Shapes are in
`contracts/src/api/`.

| Rule | Value |
| --- | --- |
| Cookie | `beetle_session`, HttpOnly, SameSite=Strict, Path=`/api/v2/`, Max-Age 28800, Secure on HTTPS |
| Secrets | independent 32-byte values, 43-character base64url, constant-time comparison |
| Lifetimes | bootstrap 15 min single use; session 8 h absolute, monotonic-bounded |
| Pair admission | 5 attempts per 60 s globally, then `429 rate_limited` |
| Persisted record | ≤ 1 KiB; requests and replies ≤ 2 KiB; one pending write, no queue |
| Historical view | `readOnly: true` plus `restoredBackup` from the sealed manifest ([recovery](recovery.md)); serving sessions refuse both |

- Request guard order: exact loopback Host, then Origin, then session, before
  body parsing. Forwarded headers are ignored; duplicates reject;
  `Sec-Fetch-Site: cross-site` is `403 forbidden`. Mutations need exact Origin and
  `X-Beetle-CSRF`. No CORS.
- Automatic profile (`POST /api/v2/auth/local`, `{}` with `X-Beetle-Local: 1`)
  refuses pairing (`403 forbidden`) and prints no token; paired profile refuses
  the automatic exchange (`401 unpaired`). Invalid, consumed or expired pairing
  tokens are `401 unpaired`. A closed or fenced automatic authority returns
  `503 storage_unavailable`; an exchange during another auth write is
  `429 rate_limited`. The browser gate tells 401 (token form) from 503 (reconnect).
- A paired session is held in memory only: restart ends it and prints a fresh
  startup token, and no endpoint recovers a lost token. Normal reads do no
  session database IO; close denies late grant publication.
- Persistence uses CAS with exact one-step replay. While a write outcome is
  unknown, protected authorization is fenced with `503 storage_unavailable`.
  Grants and logout reply only after confirmed persistence; logout clears the
  stored session before the cookie. Reopen restores only remaining lifetime.

## Related

- [Overview](../overview.md)
- [Installation](installation.md), [Resources](resources.md)
- [Decision 015: automatic local access](../../decisions/015-automatic-local-access.md)
- [Backup and restore guide](../../../site/src/content/docs/guides/backup-and-restore.md)

## Anchors

| Code | Reviewed |
| --- | --- |
| `app/src/adapters/outbound/sqlite/schema.ts` | `b692f7b7d09a` |
| `app/src/adapters/outbound/sqlite/runs.ts` | `220f7fbfb541` |
| `app/src/adapters/outbound/sqlite/run-pins/` | `5b6f4e05f29b` |
| `app/src/adapters/outbound/sqlite/migration033.ts` | `fc87dbbd4a35` |
| `app/src/adapters/outbound/sqlite/mutation-receipts.ts` | `afeddcda3d25` |
| `app/src/domain/attempt-observation/sequence.ts` | `a8b4b42df321` |
| `app/src/bootstrap/private-roots.ts` | `f20ea87eecc9` |
| `app/src/adapters/inbound/http/session/` | `328af44f81f3` |

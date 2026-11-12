# Indexed history search

Status: H3 implementation in progress; migration019 reserved by the coordinator.
Owner: public RunListQuery/SQLite Run reader and scoped history controls.
Parent: [history](run-history-query.md). No engine or native byte owner changes.

## Query and identity

RunListQuery accepts mutually exclusive optional name or runIdPrefix, alongside
H1 scope, state/outcome, order, limit and cursor. Search applies across the scoped
history, not just a visible page. Empty search is omitted, never an empty-string
query. Schema inputs are bounded before normalization; semantic errors reject.

name is trimmed, NFKC-normalized, locale-independent lowercased and NFKC-normalized again. The folded
literal must contain at least3 Unicode scalars and at most64 UTF-8 bytes. Controls
U+0000..001F/U+007F and unpaired surrogates reject. The final normalization makes repeated search folding idempotent. Namespace
sibling identity retains its existing separate spelling. It is a literal substring within a current workspace,
suite or ancestor folder NAME. It does not concatenate path components. Slashes
inside a name remain literal. Renaming/moving changes current membership without
rewriting immutable Run/suite/revision identities. Replies retain immutable IDs;
current-name membership is not a historical-name snapshot.

runIdPrefix accepts8..36 characters in canonical UUID layout, lowercased by the
query owner. It matches from the beginning of a Run UUID. It does not match an
arbitrary UUID substring. Name and prefix modes are explicit UI choices. These
minimum lengths, current-name semantics and separate prefix mode deliberately
replace legacy unbounded substring matching over concatenated paths and IDs.

No-search cursors retain exact H1 v1 spelling. Search uses v2 with the same nine
fields followed by normalized nameOrNull and prefixOrNull. Encode JSON through
strict UTF-8 to canonical base64url, <=512 characters; reject invalid UTF-8,
noncanonical aliases and mismatched query/scope/limit before repository work.
State, outcome and current-name membership may change between pages. Refresh
starts from the first page; no immutable all-history snapshot is promised.

## Name index and bounded reads

migration019 adds workspace-scoped trigram postings keyed by organization,
workspace, term, kind and entity UUID; an owner index bounds removal. Index each
current suite/folder folded name once. Match a workspace name directly in its
single metadata row; this uses ordinary H1 history indexes and needs no backfill.

A query has at most62 distinct Unicode-scalar trigrams. For each term, read at
most257 scoped postings in covering index order. Use the first complete posting
with at most256 entries and verify the entire literal against current names.
If every term overflows, return422 search_too_broad. This may reject a query whose
intersection would be small; no incomplete result is returned. Do not use counts,
unbounded posting intersections, LIKE scans or a global FTS/time sort.

Resolve matching folders through indexed child reads, each <=257 rows, with a
shared256-folder budget. Resolve contained suites through their folder index;
matching and expanded suites share a256-suite budget. Any overflow returns the
same explicit too-broad error, even if state filters would hide the extra rows.
Duplicate descendants and suites consume one identity slot. Scope never expands.

Each matching suite reads at most limit+1 scalar Run keys through one of four
covering indexes (suite, optionally state/outcome, requestedAt and UUID). Merge
each batch into top(limit+1), holding at most202 keys transiently. At most256*101
Run keys are read, independent of the number of historical runs per suite. No
Run/config/metric/native-body reads occur until the final <=100 IDs are selected.
A suite may have unlimited historical matches and still page through them.
Selection, Run projection and H2 summary/allocation joins share one read snapshot.

Prefix mode reads at most257 scoped scalar Run rows from runs_page using a bound
ID range and ID order. More than256 candidates returns search_too_broad BEFORE
state/outcome/cursor filtering. Then apply filters/keyset and sort that bounded
set by H1 time/UUID. Random UUIDs do not establish a cardinality guarantee; shared
prefixes receive the same bound. This cap never applies to name-mode Run totals.

## Update, backfill and recovery

A deterministic SQLite function calls the shared search fold/tokenizer; it is
registered before migration and used by triggers and backfill. Its <=4094 unique
three-scalar terms serialize below128KiB. SQLite triggers maintain source-name postings atomically with
the namespace mutation. Moves change ancestry/folder membership at query time;
no Run-row cascade or source config read. Folded index documents have a hard4096-
scalar bound; an oversized write fails atomically rather than silently truncating.
The existing raw name bound is128 scalars. Postings are deduplicated per document.

Migration creates empty postings and progress tables without walking the corpus.
Name searches advance at most16 existing documents in their own transaction,
using scoped ID-keyset folder/suite scans and durable per-workspace cursors.
Unfinished preparation returns503 search_indexing with retryable=true. Explicit
retry advances the next batch. No partial name search, automatic busy loop or
startup corpus walk. Ordinary unsearched history remains available.

New inserts are indexed immediately, including IDs behind a backfill cursor;
renames update immediately and deletes remove owner postings. An interrupted
batch rolls back both postings and checkpoint. Reopen resumes the checkpoint;
fully prepared workspaces do not backfill again. A failed document leaves its
checkpoint unchanged and reports failure, never readiness. Indexing does not
claim physical storage reclamation or alter run reservations/terminal credits.

## Controls and acceptance

The form applies explicitly and validates before changing its applied query.
Reset clears both search modes. Query keys contain normalized search fields;
late replies cannot populate a changed query/scope. Selection clears on Apply;
four-run comparison, first-page Refresh and honest error/empty states remain.
Indexing and broad-query errors have fixed public messages and no submitted text.

Required proof: Unicode/cursor/canonical limits; worker pagination, ties, filters,
foreign scope, mutable names/moves; bounded/restarted backfill; overflow before
filtering; many histories for one suite; exact query plans without all-run sorts;
HTTP/client and DOM no-keystroke/fanout/stale-result controls. Local evidence is
not native browser, packaged Compose, amd64 or release qualification.

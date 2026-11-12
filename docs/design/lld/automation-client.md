# Container automation client

Status: implementation contract. Owner: app/client/cli. This optional client uses
only the generated public HTTP API; it has no database/agent/engine capability.
Docker Compose remains the installation entrypoint. No host CLI installation.
The backend image includes automation.js; use an explicit Node entrypoint override.

## Commands and input

Common flags: --endpoint canonical HTTP(S) root URL, --origin canonical configured
loopback external origin, --session-file absolute private file, optional --json.
Connect uses the normal automatic local profile; pair uses --token-file for the
explicit paired profile. Both create a fresh exclusive session-file.
All options are closed, unique, bounded strings; no positional ambiguity, URL
credentials, paths/query/fragments on endpoint, redirects or environment expansion.
Host/Origin bind the configured external origin, including private Compose access.
Node fetch does not preserve an overridden Host. A closed Node HTTP(S) adapter
therefore preserves that authority, refuses redirects/upgrades, caps headers16KiB
and bodies4KiB, and uses a64KiB byte-sized response queue under existing bounded
wire validation. Abort destroys the request/body. Endpoint and origin are captured in credentials and must match subsequent commands.

| Command | Additional input | Behavior |
| --- | --- | --- |
| connect | none | One automatic same-origin local exchange; require automatic mode and persist its private session |
| pair | --token-file | One existing startup-token exchange on a fresh CI backend; persist returned session privately |
| run | --request-file, optional --wait-ms | Validate CreateRunRequest, enqueue once; optional bounded wait |
| status | --organization, --workspace, --run, optional --wait-ms | Read authoritative Run; optionally wait |
| result | --organization, --workspace, --run | Read authoritative result snapshot; missing stays null |
| cancel | --organization, --workspace, --run, --request-file | Validate CancelRunRequest, issue exactly once |
| compare | --request-file | Validate RunComparisonRequest, issue one read with at most four ordered runs |

Request files contain the existing closed wire schema, including caller-owned
requestId/scope/budget. No defaults, settings reimplementation, config compiler,
secret resolution or automatic mutation retries. Scope/route mismatch fails before
HTTP. A transport/response failure after a mutation may have committed: output a
fixed unknown-outcome diagnostic and retain the supplied requestId for explicit
replay of the same request file. Never create a replacement UUID or repeat load.
No validate/export command is claimed until their admitted API exists. Standalone
engine generation remains outside the backend and this client's responsibility.

## Credentials and IO

Pairing uses the existing single-use15-minute startup token; it does not create a
new authentication path or permit bypass of Host/Origin/CSRF. CI uses a fresh backend
without frontend. Existing browser sessions cannot be paired again by this client;
automatic installations instead use connect, without a startup token. Do not pass secrets on argv/stdout.
Connect and pair share one Set-Cookie capture under its owned fetch adapter; validate the exact
session cookie and existing BrowserSession before writing. No cookie jar/library.
The credential file holds version, endpoint, origin, session cookie and BrowserSession.
It is <=4KiB, closed/strictly validated, regular, current-UID-owned, single-link and
0600; use O_NOFOLLOW and check stable opened-file identity/size. Token <=64 bytes.
Request files <=4KiB; read at most limit+1 with stable identity checks. Credential
creation is exclusive0600 with fsync, in a current-UID private directory, never
overwrites an existing file. Failed grant or unknown file outcome must not print
secrets or automatically retry the exchange. An explicit connect retry with no
file created recovers the server's same retained grant; no resource write is replayed. No global stores, credential copying or real data
in tests. Fixed public diagnostics never contain paths, URLs, config or exceptions.

Successful records use bounded encoded JSON (<=1MiB) on stdout. Pair prints only
{paired:true}; connect prints only {connected:true}; credentials never appear there. Error JSON is bounded/fixed on stderr.
Write output once with a separate1s output budget; handle backpressure/failure
explicitly and retain stream error ownership through failed-write callback/error
ordering. Native file IO originals drain before returning, even beyond cancellation. Capture signals
and remove listeners on completion; abort only HTTP/wait, never implicitly cancel
an already-admitted run. No daemon/background tasks or persistent caches.

## Waiting and exit status

--wait-ms is1..3,600,000, uses a monotonic HTTP/wait deadline and one sequential
status read every2s, at most1,801 reads. All issued requests share the remaining
signal/deadline; no concurrent polling, event corpus or unbounded output. Poll only
while nonterminal; final Run state/outcome remains authoritative. Timeout/unavailable
is not cancellation or test failure. Waiting does not extend an execution budget.
Run without waiting exits0 for an acknowledged submission, explicitly labelled
submitted; it does not claim test success. Connect/pair/cancel/result/compare exit0 for a
successful command/read. Status and run-with-wait map the authoritative terminal
Run: passed0, failed1, inconclusive3, cancelled4. Pending or unavailable deadline
is5. Invalid input2; transport/invalid reply or unknown mutation outcome3;
unpaired/forbidden/unavailable prerequisites5. No metric or engine result recomputes
application outcome; discovery semantics remain in the backend.

## Acceptance and limits

Use synthetic restricted files and actual authenticated loopback API. Cover pair
cookie/CSRF, wrong origin/session/endpoint, replay and lost mutation reply without
retry, malformed/oversized/symlink/private-mode files and exclusive preservation,
scope mismatch, four-run comparison, failure/unknown/cancelled/pending states,
wait deadline/signal/call/output bounds and retired replies. Exact generated client
records must be used. Bundle once after packaging changes; no Docker rebuild for
pure test/prose corrections. Container build/pull and native execution are separate
qualification claims. CLI does not make missing export/retention/auth work complete.

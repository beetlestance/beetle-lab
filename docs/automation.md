# Rewrite automation client

The optional client uses the same authenticated API as the UI. Compose remains the
installation entrypoint. The backend build recipe packages automation.js; this is
locally verified source, not a claim that the published image contains the rewrite.

Use connect with the normal automatic local profile. Mount a private directory
owned by the client UID with0700 permissions; the command creates one fresh0600
session file. No startup token is needed. The client sends the same exact local
Origin/Host and custom-header exchange as the browser; it never reads Docker logs.

The executable is /beetle/backend/automation.js inside a source-built backend image.
Override the image's normal backend entrypoint; connect to the private control
network. For example, with backend-image and control-network set to your own
source-built image and installation network:

```sh
docker run --rm --network "$CONTROL_NETWORK" \
  --user "$(id -u):$(id -g)" --entrypoint node \
  --mount "type=bind,src=$PWD/ci-auth,dst=/auth" \
  "$BACKEND_IMAGE" /beetle/backend/automation.js connect \
  --endpoint http://backend:4311 --origin http://127.0.0.1:8080 \
  --session-file /auth/session.json
```

Use the installation's actual configured external origin/port. Endpoint can name
the private backend; Host/Origin still match that configured external origin.
The command prints only {"connected":true}. session.json is exclusive0600, binds
that exact endpoint/origin, and preserves the server session's remaining8h lifetime
across backend restarts. Logout revokes it. Mount it read-only for subsequent
commands; mount request files separately. No host package install.

Connect refuses an existing destination. It makes one HTTP call, with no automatic
retry. After a lost grant reply with no file created, explicitly repeat connect to
the same fresh file; the server reuses/reconciles its retained grant. An unknown
file-write outcome requires inspection; no existing file is overwritten. Normal
run/cancel commands never reconnect or replay user mutations implicitly.

For BEETLE_LOCAL_ACCESS=paired, use pair with --token-file /auth/startup-token
instead. Supply that fresh installation's one-time token through a private0600
mounted file. Pair prints {"paired":true}; it cannot pair an already consumed token,
and that profile invalidates its session on restart.

| Command | Required additional flags | Output |
| --- | --- | --- |
| connect | none | Connected receipt; fresh private session file |
| pair | --token-file | Paired receipt for the explicit token profile |
| run | --request-file; optional --wait-ms | Acknowledged submission, or final/pending run |
| status | --organization, --workspace, --run; optional --wait-ms | Authoritative run and waiting flag |
| result | --organization, --workspace, --run | Result snapshot; absent result stays null |
| cancel | Same scope/run flags and --request-file | Cancellation receipt; not proof of physical stop |
| compare | --request-file | Two through four terminal runs, baseline first |

All commands require endpoint, origin and session-file. Request JSON uses the
[generated API schemas](../contracts/api/v2/http-operations.json); run/cancel include
an explicit stable requestId. Request files are at most4KiB. Suite/revision creation
and large input upload remain existing API/UI operations. This client does not yet
claim a validate or script-export command. Engine preflight still occurs under
execution admission; a submitted queue entry is not a validated or passed test.

Use run --wait-ms for CI test outcome. Waiting is bounded to one hour and checks
status every2s. It never cancels the underlying run on timeout or client interruption.
Use explicit cancel when desired. All records are JSON; --json is accepted too.

Exit0 means successful command/read; run without waiting labels only submitted.
For status/run-with-wait, declared terminal outcomes map to passed0, failed1,
inconclusive3 and cancelled4. Pending/deadline/unavailable is5; invalid input2;
transport/invalid reply/unknown mutation outcome3. No metric recomputes outcome.

An outcome_unknown diagnostic includes the original requestId. Retain and explicitly
replay the exact same request file to learn its receipt; do not create a new UUID.
The client performs no automatic mutation retries. Diagnostics omit raw server,
filesystem and transport exceptions and never print credentials.

Local scoped evidence: [automation checks](verification/automation-client.md).
Container build/pull, CI orchestration and native engine qualification remain
separate release checks. Standalone export and retention have their own owners.

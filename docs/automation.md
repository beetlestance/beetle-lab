# Rewrite automation client

The optional client uses the same authenticated API as the UI. Compose remains the
installation entrypoint. The backend build recipe packages automation.js; this is
locally verified source, not a claim that the published image contains the rewrite.

Use a fresh CI backend/agent installation without frontend pairing. The startup
token can be exchanged only once. Mount a private directory owned by the client
UID with0700 permissions and a0600 token file supplied by that installation's
trusted startup step. The client never reads Docker logs or discovers credentials.
An already paired browser installation needs its existing session; a second pair
will not work. Automatic local access remains a separate pending change.

The executable is /beetle/backend/automation.js inside a source-built backend image.
Override the image's normal backend entrypoint; connect to the private control
network. For example, with backend-image and control-network set to your own
source-built image and installation network:

```sh
docker run --rm --network "$CONTROL_NETWORK" \
  --user "$(id -u):$(id -g)" --entrypoint node \
  --mount "type=bind,src=$PWD/ci-auth,dst=/auth" \
  "$BACKEND_IMAGE" /beetle/backend/automation.js pair \
  --endpoint http://backend:4311 --origin http://127.0.0.1:8080 \
  --session-file /auth/session.json --token-file /auth/startup-token
```

Use the installation's actual configured external origin/port. Endpoint can name
the private backend; Host/Origin still match that configured external origin.
The command prints only {"paired":true}. session.json is exclusive0600 and expires
with the existing session, on logout or backend restart. Mount it read-only for
subsequent commands; mount request files separately. No host package install.

| Command | Required additional flags | Output |
| --- | --- | --- |
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

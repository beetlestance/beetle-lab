---
title: Automate from CI
description: Use the automation client to start runs, wait for outcomes, read results and compare runs from a pipeline.
sidebar:
  order: 2
---

The automation client is a small command-line program that uses the same
authenticated HTTP API as the UI. It ships inside the backend image, so you run it
with `docker run` and install nothing on the host.

:::caution
The client is built from source today. The published image does not yet contain
the rewrite, so build the backend image yourself before following this guide.
:::

## Connect once

`connect` signs the client in and writes a session file. Mount a private
directory owned by the user that runs the client, with mode `0700`; the command
creates one new `session.json` with mode `0600`.

```sh
docker run --rm --network "$CONTROL_NETWORK" \
  --user "$(id -u):$(id -g)" --entrypoint node \
  --mount "type=bind,src=$PWD/ci-auth,dst=/auth" \
  "$BACKEND_IMAGE" /beetle/backend/automation.js connect \
  --endpoint http://backend:4311 --origin http://127.0.0.1:8080 \
  --session-file /auth/session.json
```

- `--endpoint` can name the private backend on the installation's control network.
- `--origin` must be the installation's configured external origin and port; the
  client sends the same Origin, Host and CSRF exchange as a browser.
- The command prints only `{"connected":true}`.

The session file is bound to that endpoint and origin. It keeps the server
session's remaining lifetime of up to 8 hours across backend restarts, and logout
revokes it. Mount it read-only for later commands, and mount request files
separately.

`connect` refuses to overwrite an existing file and makes one HTTP call with no
retry. If the reply was lost and no file was created, run the same command again
to the same new path; the server reuses the grant it kept.

### Paired installations

If the installation uses `BEETLE_LOCAL_ACCESS=paired`, use `pair` with
`--token-file /auth/startup-token` instead. Supply the installation's one-time
token in a private `0600` file. `pair` prints `{"paired":true}`. A token works
once, and in this profile the session ends when the backend restarts.

## Commands

Every command needs `--endpoint`, `--origin` and `--session-file`. The
[automation client reference](/reference/cli/) lists every flag and request field.

| Command | Additional flags | Prints |
| --- | --- | --- |
| `connect` | none | Connected receipt; creates the session file |
| `pair` | `--token-file` | Paired receipt |
| `run` | `--request-file`, optional `--wait-ms` | The accepted submission, or the final or pending run |
| `status` | `--organization`, `--workspace`, `--run`, optional `--wait-ms` | The run and whether it is still waiting |
| `result` | `--organization`, `--workspace`, `--run` | The result snapshot, or `null` if there is none |
| `cancel` | the same scope flags and `--request-file` | The cancellation receipt |
| `compare` | `--request-file` | Two to four finished runs, baseline first |

Request files are JSON, at most 4 KiB, shaped by the
[generated API schemas](https://github.com/beetlestance/beetle-lab/blob/main/contracts/api/v2/http-operations.json).
`run` and `cancel` requests carry a stable `requestId` that you choose. Creating
suites and uploading large inputs stay in the UI and API.

A cancellation receipt records your request; it does not prove the engine has
stopped. Use `status` to see the run turn `cancelled`.

## Wait for an outcome

Use `run --wait-ms` to make a CI step pass or fail on the test. The client checks
status every 2 s for up to one hour. If it times out or is interrupted, the run
keeps going; cancel it explicitly if that is what you want.

A queued run is not a validated or passed test: the engine validates the
configuration when the run is admitted.

## Exit codes

| Code | Meaning |
| --- | --- |
| 0 | Passed, or the command succeeded (`run` without waiting only means submitted) |
| 1 | Failed |
| 2 | Invalid input |
| 3 | Inconclusive, a transport error, an invalid reply or an unknown mutation outcome |
| 4 | Cancelled |
| 5 | Still pending, deadline reached or service unavailable |

Exit codes come from the run's declared outcome; the client never recomputes it
from metrics. All output is JSON (`--json` is accepted too).

## When the outcome is unknown

The client never retries a change on its own. If a `run` or `cancel` reply is lost,
it reports `outcome_unknown` with the original `requestId`. Run the **same**
request file again to learn what happened; do not generate a new ID, or you may
start a second run. Diagnostics never print credentials or raw server, file or
network errors.

---
title: Automation client
description: Every command, flag, request file, output and exit code of the automation client.
sidebar:
  order: 4
---

The automation client ships in the backend image as
`/beetle/backend/automation.js`. Run it with `docker run --entrypoint node`, as
shown in [Automate from CI](/guides/automation/), which covers the tasks step by
step. This page lists everything the client accepts.

```sh
node /beetle/backend/automation.js COMMAND --endpoint URL --origin URL \
  --session-file PATH [flags]
```

## Commands

| Command | Does | Extra flags |
| --- | --- | --- |
| `connect` | Signs in to an automatic-access installation and creates the session file | none |
| `pair` | Signs in to a paired installation with its one-time token and creates the session file | `--token-file` |
| `run` | Starts a run, and optionally waits for it to end | `--request-file`, optional `--wait-ms` |
| `status` | Reads a run, and optionally waits for it to end | `--organization`, `--workspace`, `--run`, optional `--wait-ms` |
| `result` | Reads a run's result | `--organization`, `--workspace`, `--run` |
| `cancel` | Asks for a run to be cancelled | `--organization`, `--workspace`, `--run`, `--request-file` |
| `compare` | Compares two to four runs | `--request-file` |
| `export` | Asks for a standalone k6 script of a saved suite revision, and optionally waits | `--request-file`, optional `--wait-ms` |
| `export-status` | Reads an export, and optionally waits for it to finish | `--organization`, `--workspace`, `--export`, optional `--wait-ms` |
| `export-download` | Writes a ready export's script to a new file and checks its size and SHA-256 | `--organization`, `--workspace`, `--export`, `--out` |

A `validate` command does not exist yet. Creating suites and uploading
inputs are done in the UI or the HTTP API.

## Flags

| Flag | Value |
| --- | --- |
| `--endpoint` | Origin of the API to call, such as `http://backend:4311`: scheme, host and optional port, with no path or trailing `/` |
| `--origin` | The installation's external origin, such as `http://127.0.0.1:8080`; must be `localhost`, `[::1]` or a `127.x.x.x` address |
| `--session-file` | Absolute path of the session file |
| `--token-file` | Absolute path of a file holding the one-time startup token |
| `--request-file` | Absolute path of a JSON request file |
| `--organization`, `--workspace`, `--run` | UUIDs of the run's organisation, workspace and run |
| `--wait-ms` | Whole milliseconds to wait, 1 to 3,600,000 |
| `--json` | Accepted and ignored; output is always JSON |

Every command needs `--endpoint`, `--origin` and `--session-file`. Each flag may
appear once; unknown flags, flags for another command and relative paths are
refused. The whole command line is limited to 24 arguments.

## Session file

`connect` and `pair` create the session file; every other command reads it.

- Its directory must be owned by you with mode `0700`. The file is created new
  with mode `0600` and must stay a single, owner-only regular file of at most
  4 KiB.
- An existing file is never overwritten. Choose a new path to sign in again.
- It is bound to the `--endpoint` and `--origin` it was created with; use the same
  values with it.
- It lasts as long as the server session, up to 8 hours. An expired session gives
  exit code 5.
- `pair` reads a token file you own with mode `0600`, holding exactly one token,
  optionally followed by a newline. Each token works once.

## Request files

Request files are JSON, at most 4 KiB, and must match the
[API schemas](https://github.com/beetlestance/beetle-lab/blob/main/contracts/api/v2/http-operations.json)
exactly. `scope` is always
`{"kind": "workspace", "organizationId": UUID, "workspaceId": UUID}`.

| Command | Fields |
| --- | --- |
| `run` | `scope`, `requestId`, `revisionId`, `engineProfile`, `budget`, `executionPolicy` |
| `cancel` | `scope`, `requestId` |
| `compare` | `scope`, `runIds` (2 to 4 different runs), `metric` (a metric key or `null`) |

`budget` has `cpuMillis`, `memoryBytes`, `pids`, `timeoutMs` and `outputBytes`, and
must fit your settings. `engineProfile` is one of the profiles your settings
allow; a new installation has `k6-local`. `executionPolicy` has `mode`
(`parallel` or `isolated`) and `preferIdle` (`true` or `false`).

A `run` request:

```json
{"scope":{"kind":"workspace","organizationId":"0b9f3c1e-6c1a-4d5e-9f00-2a7d3c4b5e61","workspaceId":"5d2e8f40-1b3c-4a6d-8e9f-0c1d2e3f4a5b"},
 "requestId":"7c4e2a10-3b5d-4f6e-8a9b-1c2d3e4f5a6b","revisionId":"9e8d7c6b-5a49-4382-9716-0a1b2c3d4e5f",
 "engineProfile":"k6-local",
 "budget":{"cpuMillis":1000,"memoryBytes":536870912,"pids":128,"timeoutMs":300000,"outputBytes":67108864},
 "executionPolicy":{"mode":"parallel","preferIdle":false}}
```

A `cancel` request. Its `scope` must match `--organization` and `--workspace`:

```json
{"scope":{"kind":"workspace","organizationId":"0b9f3c1e-6c1a-4d5e-9f00-2a7d3c4b5e61","workspaceId":"5d2e8f40-1b3c-4a6d-8e9f-0c1d2e3f4a5b"},
 "requestId":"2f1e0d9c-8b7a-4695-a483-72615f4e3d2c"}
```

Choose a new `requestId` for each new run or cancellation, and keep it with the
file. Sending the same file again replays the original request instead of making
a new one.

## Output

Each command prints one JSON line on standard output when it succeeds.

| Command | Prints |
| --- | --- |
| `connect` | `{"connected":true}` |
| `pair` | `{"paired":true}` |
| `run` without `--wait-ms` | `{"submitted":true,"run":RUN}` |
| `run` with `--wait-ms`, `status` | `{"run":RUN,"waiting":BOOLEAN}`; `waiting` is `true` if the run has not ended |
| `result` | The result snapshot, or `null` if the run has none |
| `cancel` | The cancellation receipt |
| `compare` | The comparison, baseline first |

A run has ended when its state is `finished`, `cancelled` or `errored`. A
cancellation receipt records your request; use `status` to see the run end.

On failure the client prints one line on standard error instead:
`{"error":CODE}`, plus `"requestId"` when the outcome of a `run` or `cancel` is
unknown. Codes are `invalid_input`, `io`, `unavailable`, `request_failed`,
`outcome_unknown` and `interrupted`. Diagnostics never contain credentials or raw
server, file or network errors.

## Waiting and time limits

With `--wait-ms`, the client reads the run every 2 s until it ends or the time is
up. Without it, each command has 30 s in total. Running out of time, or `Ctrl-C`,
stops the client only: the run carries on and keeps its budget.

The client makes each change once and never retries. If it cannot tell whether a
`run` or `cancel` reached the server, it reports `outcome_unknown` with the
`requestId`. Run the **same** request file again to find out.

## Exit codes

| Code | Meaning |
| --- | --- |
| 0 | The run passed, or the command succeeded; `run` without waiting only means submitted |
| 1 | The run failed |
| 2 | Invalid input: flags, request file, session file, or a 400, 413 or 422 reply |
| 3 | The run ended without a pass or fail; a network error or invalid reply; an unknown `run` or `cancel` outcome; or the session file could not be written |
| 4 | The run was cancelled |
| 5 | The run has not ended yet, time ran out, or the server is unavailable or refused the session |

Exit codes for runs come from the run's state and declared outcome; the client
never works out an outcome from metrics.

For exports: 0 means the script is ready (or was downloaded and verified), 3 means
the export failed or its state is unknown, 4 means it was cancelled and 5 means it
is still being prepared. `export-download` never overwrites an existing file and
deletes a partial file if its size or SHA-256 does not match; that is also exit 3.

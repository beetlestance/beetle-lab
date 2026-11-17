---
title: How it works
description: The four containers, what happens between clicking Run and seeing a result, and the security model.
sidebar:
  order: 1
---

Beetle Lab splits a load test into parts that each own one job, so that a
crashed engine, a full disk or a restart never turns into a wrong result.

## The parts

```text
Browser ──► Frontend ──► Backend ──► Agent ──► k6 engine ──► Your service
  (UI)      (static +    (API,       (admits,   (one per run,
            proxy)        metadata,   starts,     disposable)
                          results)    stops)
```

| Part | Owns | Never does |
| --- | --- | --- |
| Frontend | The UI, served as static files, and forwarding of `/api/` | Business logic or storage |
| Backend | Organisations, suites, inputs, runs, results and reports in SQLite | Start containers or interpret raw metrics |
| Agent | Machine capacity, admission, engine containers and a durable journal | Accept requests from the browser |
| k6 engine | Compiling the suite, running k6, collecting and sealing results | Talk to the backend or keep anything after the run |

The backend and the agent keep separate stores and never share a transaction.
Each step between them is recorded before it is acknowledged, so after a restart
both sides can tell exactly what happened and resume without repeating work.

## From Run to result

1. **Queue.** The backend records the run and its request ID first. Sending the
   same request again returns the same run instead of starting another.
2. **Offer.** The backend offers the run to the agent with the exact revision,
   engine and budget. Nothing in the offer comes from the browser unchecked.
3. **Admit.** The agent checks the budget against free capacity and the run's
   execution policy. If it cannot run now, it says why and the run waits.
4. **Validate and prepare.** In the engine container, the configuration is
   validated against the installed schema and compiled into a k6 script.
5. **Execute.** k6 runs against your target inside its CPU, memory, process, time
   and output limits.
6. **Collect and seal.** Results, metrics, warnings and diagnostics are written,
   then sealed with sizes and SHA-256 digests.
7. **Transfer and finalise.** The agent hands the sealed output to the backend,
   which verifies it and only then records the outcome.

Every phase has its own time, work and output budget, so a stuck phase ends the
run instead of hanging it.

## What gets measured

Beetle Lab keeps three kinds of numbers apart, and labels them so:

- **Target performance**: what k6 observed from your service, such as request
  durations and error rates.
- **Engine resources**: CPU time, peak memory and processes of the engine
  container, reported by the agent.
- **Target runtime readings**: optional figures your service reports about itself,
  such as memory and garbage collection, sampled during the run.

A number that was not collected is shown as unknown, never as zero.

## Trust and security

Beetle Lab is built for **one trusted administrator** on a machine they control.

- Only the frontend publishes a port, and only on loopback. The backend and agent
  are reachable only inside the Compose network.
- The browser session is an HttpOnly cookie with CSRF checks on every change.
- The agent talks to the Docker daemon through its socket. Even mounted read-only,
  that socket allows full control of the Docker host. A compromised agent, or a
  malicious test, could therefore control the host.
- Engine containers run without Linux capabilities, as a non-root user, with
  resource limits and either no network or access to test targets only.

Install it only where you trust the administrator and the test code. There is no
multi-user access control yet, and no constrained Docker broker.

## Limits that are on purpose

- One installation, one administrator, one machine.
- Docker is the only execution backend; k6 is the only engine.
- Images are never pulled during a run, so a measurement never includes a
  download.

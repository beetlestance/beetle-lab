---
title: How it works
description: The four containers, what happens between clicking Run and seeing a result, and the security model.
sidebar:
  order: 1
---

Beetle Lab splits a load test into parts that each own one job, so that a
crashed engine, a full disk or a restart never turns into a wrong result.

## The parts

<figure class="bl-flow">
<svg class="wide" viewBox="0 0 716 106" role="img" aria-labelledby="bl-flow-t"><title id="bl-flow-t">A request flows from the browser through the frontend, backend and agent to a k6 engine, which sends load to your service.</title><defs><marker id="bl-arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto"><path d="M0 0 L8 4 L0 8 z"/></marker></defs><g class="node edge" style="--step:0"><rect x="8" y="24" width="100" height="58" rx="8"/><text x="58.0" y="50.0" class="name">Browser</text><text x="58.0" y="66.0" class="sub">you</text></g><path class="link" d="M108 53 H126" marker-end="url(#bl-arrow)"/><g class="node" style="--step:1"><rect x="126" y="24" width="100" height="58" rx="8"/><text x="176.0" y="50.0" class="name">Frontend</text><text x="176.0" y="66.0" class="sub">UI + /api proxy</text></g><path class="link" d="M226 53 H244" marker-end="url(#bl-arrow)"/><g class="node" style="--step:2"><rect x="244" y="24" width="100" height="58" rx="8"/><text x="294.0" y="50.0" class="name">Backend</text><text x="294.0" y="66.0" class="sub">API + results</text></g><path class="link" d="M344 53 H362" marker-end="url(#bl-arrow)"/><g class="node" style="--step:3"><rect x="362" y="24" width="100" height="58" rx="8"/><text x="412.0" y="50.0" class="name">Agent</text><text x="412.0" y="66.0" class="sub">admission</text></g><path class="link" d="M462 53 H480" marker-end="url(#bl-arrow)"/><g class="node" style="--step:4"><rect x="480" y="24" width="100" height="58" rx="8"/><text x="530.0" y="50.0" class="name">k6 engine</text><text x="530.0" y="66.0" class="sub">one per run</text></g><path class="link" d="M580 53 H598" marker-end="url(#bl-arrow)"/><g class="node edge" style="--step:5"><rect x="598" y="24" width="100" height="58" rx="8"/><text x="648.0" y="50.0" class="name">Your service</text><text x="648.0" y="66.0" class="sub">under test</text></g></svg>
<svg class="tall" viewBox="0 0 300 432" aria-hidden="true"><defs><marker id="bl-arrow-t" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto"><path d="M0 0 L8 4 L0 8 z"/></marker></defs><g class="node edge" style="--step:0"><rect x="40" y="6" width="220" height="50" rx="8"/><text x="150.0" y="28.0" class="name">Browser</text><text x="150.0" y="44.0" class="sub">you</text></g><path class="link" d="M150 56 V80" marker-end="url(#bl-arrow-t)"/><g class="node" style="--step:1"><rect x="40" y="80" width="220" height="50" rx="8"/><text x="150.0" y="102.0" class="name">Frontend</text><text x="150.0" y="118.0" class="sub">UI + /api proxy</text></g><path class="link" d="M150 130 V154" marker-end="url(#bl-arrow-t)"/><g class="node" style="--step:2"><rect x="40" y="154" width="220" height="50" rx="8"/><text x="150.0" y="176.0" class="name">Backend</text><text x="150.0" y="192.0" class="sub">API + results</text></g><path class="link" d="M150 204 V228" marker-end="url(#bl-arrow-t)"/><g class="node" style="--step:3"><rect x="40" y="228" width="220" height="50" rx="8"/><text x="150.0" y="250.0" class="name">Agent</text><text x="150.0" y="266.0" class="sub">admission</text></g><path class="link" d="M150 278 V302" marker-end="url(#bl-arrow-t)"/><g class="node" style="--step:4"><rect x="40" y="302" width="220" height="50" rx="8"/><text x="150.0" y="324.0" class="name">k6 engine</text><text x="150.0" y="340.0" class="sub">one per run</text></g><path class="link" d="M150 352 V376" marker-end="url(#bl-arrow-t)"/><g class="node edge" style="--step:5"><rect x="40" y="376" width="220" height="50" rx="8"/><text x="150.0" y="398.0" class="name">Your service</text><text x="150.0" y="414.0" class="sub">under test</text></g></svg>
<figcaption>Only the frontend publishes a port. The engine is the only part that talks to your service.</figcaption>
</figure>

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

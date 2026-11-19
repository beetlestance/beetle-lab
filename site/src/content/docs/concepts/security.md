---
title: Trust and security
description: Who Beetle Lab trusts, how the browser session and containers are protected, what the Docker socket allows, and what is not provided.
sidebar:
  order: 7
---

Beetle Lab is built for **one trusted administrator** on a machine they control.
Its protections keep a mistake or a bad test from turning into a wrong result or a
silent leak. They do not make it safe to share with people you do not trust.

## The trust model

The administrator, the machine with its Docker daemon, and the test code in your
suites are all inside the trust boundary. Other people on the network and other
websites in the same browser are outside it.

Install Beetle Lab only where you trust both the administrator and the test code.
A dedicated host or virtual machine is best.

## Network exposure

- Only the frontend publishes a port, on loopback (`127.0.0.1`) unless you turn on
  network access. It forwards `/api/v2/` to the backend and nothing else.
- The backend and the agent listen only on private container networks. They are
  never published.
- Engine containers join a separate network for test targets, never the network
  the backend and agent use.

To use Beetle Lab from another machine, forward the port over SSH. If you are the
only user and reach the server over a VPN or another private network, you can
instead turn on network access and open it at an `https://` address through a
reverse proxy ([how](/guides/private-network/)).
Anyone who reaches that address is the administrator, so never publish it on a
public or shared address.

## Browser session

The browser signs in automatically through the frontend; no token is printed or
pasted.

- The session is an HttpOnly cookie, `SameSite=Strict`, with an 8 h absolute
  lifetime. Credentials never appear in URLs or browser storage.
- Every request must carry the installation's exact `Host` and `Origin`: a loopback
  address, or the one `https://` address chosen with network access. Cross-site
  requests are refused and there is no CORS. These checks stop other websites, not
  other machines that can reach the port.
- Every change also needs a CSRF header.
- Sign-in attempts are limited to 5 per minute. Signing out revokes the session
  before it replies.

A **paired** mode for CI clients uses a single-use startup token that expires
after 15 minutes instead of automatic sign-in.

## The Docker socket

The agent starts engine containers through the Docker socket. Access to that
socket is equivalent to root on the Docker host, even when it is mounted
read-only.

:::caution
A compromised agent, or a malicious test that reaches it, could control the host.
Beetle Lab reduces this risk but does not remove it.
:::

What reduces it:

- The agent starts with only the capabilities it needs to change user, then runs
  as a non-root user that can reach the socket. It checks that identity before it
  does any work.
- Engine containers never receive the socket, and the browser never reaches the
  agent.
- Where you can, use rootless Docker or user-namespace remapping, which limit the
  damage to the Docker user's own authority.

## Engine containers

Every run gets a new engine container with a fixed specification:

| Protection | Setting |
| --- | --- |
| User | Non-root |
| Linux capabilities | All dropped, none added; not privileged |
| Privilege escalation | Blocked (`no-new-privileges`) |
| Root filesystem | Read-only |
| Mounts | Only the run's staged inputs, its output and scratch space; no host paths |
| Limits | CPU, memory, processes and time from the run's budget; no swap beyond memory |
| Ports | None published |
| Network | Either none, or the test-targets network only |

The test-targets network is not filtered: a run can reach what the server can reach.
To keep runs away from the cloud metadata endpoint, the host or private ranges, see
[Limit what runs can reach](/guides/target-egress/).

The engine does not talk to the backend and keeps nothing after the run. All
Beetle Lab containers also run with a read-only root filesystem, all
capabilities dropped except those listed for them, and `no-new-privileges`.

A container limits what a run can do. It is not a promise that a run cannot affect
the host, especially when your service runs on the same machine.

## Secrets

Suites refer to secrets **by reference**. The value comes from the installation's
own configuration, never from a request or the browser.

- The value is resolved just before the engine starts, into a restricted
  temporary file. It never goes on a command line or into stored run data.
- Values never appear in suite configurations, run comparisons or exported
  scripts. A revision that needs a secret cannot be exported.
- Diagnostics are redacted and never include secret values or file paths.
- Backups leave out mounted secret files and the agent's credential.

## What is not provided

- **Multi-user access control.** There are no accounts, roles, invitations or
  single sign-on. Organisations and workspaces are for organising, not for
  restricting access. Anyone who can use the UI can do everything.
- **A constrained Docker broker.** Nothing sits between the agent and the Docker
  daemon to limit which containers it may create.
- **Shared or internet-facing hosting.** Neither is supported without the two
  items above.

See [How it works](/concepts/how-it-works/) for the parts these rules protect.

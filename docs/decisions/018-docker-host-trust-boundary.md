# Decision 018: the agent is trusted with Docker host control

Status: user-approved, 17 November 2026.

## Decision

Keep the trusted-agent model for single-host, single-administrator installations.
Setup and the agent mount the Docker socket and therefore hold authority
equivalent to root on the Docker host. Setup, agent code and installation
administrators sit inside that trust boundary.

Existing reductions stay required: setup starts as root only to prepare an empty
installation; the agent starts with only `SETUID` and `SETGID`, drops to
UID/GID 1000 plus the socket group and verifies that identity before work. Test
containers use a fixed specification with no binds, all capabilities dropped,
a read-only root filesystem and finite CPU, memory and PID limits. Backend and
agent listen only on private networks; the UI publishes on loopback.

The [compose installation contract](../design/lld/compose-installation.md) and
the root README state the boundary for operators.

## Why

Reaching the agent requires first compromising the authenticated backend, which
enforces exact Host, Origin and `Sec-Fetch-Site` checks, then crossing a private
network. For a local tool with one administrator, that path is narrow.

A broker that actually reduces authority must validate complete container
specifications, not only endpoint names, so it is custom code with its own
qualification and becomes a new security boundary. The agent uses about a dozen
Docker API operations, so a broker remains feasible when a trigger below applies.

## Alternatives

- Endpoint-filtering socket proxy: rejected. It allows `containers/create` without
  inspecting `Binds`, so a compromised agent can still mount the host filesystem.
- Constrained Docker broker validating full request bodies: deferred until a
  review trigger applies.
- Require rootless Docker: rejected as a requirement because Docker Desktop and
  common Linux installs do not provide it by default; recommended where possible.

## Consequences

A compromised agent can control the Docker host. Operators should:

- run Beetle Lab on a host or VM they treat as trusted, ideally dedicated;
- prefer rootless Docker or `userns-remap`, which limit the damage to the Docker
  user's authority;
- never publish the backend or UI on a public address without an authenticating
  proxy in front.

## Review triggers

Build the constrained broker before any of these ships:

- remote or shared agents;
- multi-user or hosted deployment (phase R7);
- officially supported internet-facing VPS installations.

# Decision 032: One administrator may reach an installation over a private network

Status: accepted. Recorded on 19 November 2026.

## Decision

A Compose installation may serve its UI to one trusted administrator over a private
network they control, such as a VPN, a tailnet or a home LAN, behind a TLS reverse
proxy. This is an explicit opt-in:

- `BEETLE_ACCESS=network` is required whenever the browser origin (`BEETLE_ORIGIN`) or
  the host bind address (`BEETLE_BIND`) is not loopback. Setup refuses otherwise with
  `network_access_required`, and the backend refuses to start.
- The origin must be one canonical `https://` origin. Plain HTTP is accepted only on
  loopback, as before.
- The bind address is an IPv4 literal. A non-loopback bind needs a non-loopback origin,
  because every request is checked against that origin's Host.
- Authentication does not change: automatic access (decision 015) gives anyone who
  reaches the UI full administrator rights. The private network is the access control.
- An existing installation keeps the origin it was set up with. Setup refuses a changed
  origin with `binding_changed external_origin` until a supported origin-change command
  exists. Only new installations can use network access.
- The local launcher and the history viewer stay loopback-only.

## Why

People run load tests from a home server or a shared lab machine and want to open the
UI from a laptop. Without this, the only option was an SSH tunnel.

Host, Origin and CSRF checks stop a browser on another site from driving the API. They
do not authenticate a client that can reach the port directly, so a non-loopback bind
or origin must be deliberate, not a side effect of one variable. HTTPS is required
because the UI uses `crypto.randomUUID()` and `crypto.subtle`, which browsers expose
only in a secure context. A VPN encrypts the link, but the browser still treats an
`http://` origin on another host as insecure.

Scripts still run only in sandboxed engine containers on the `targets` network, and
`control` stays internal, so network access does not move the Docker trust boundary
of decision 018. It does widen who can reach the administrator: everyone on the
private network.

## Alternatives

- Treat any VPN as enough and accept HTTP origins: rejected. Browsers withhold Web
  Crypto from them, and the UI would fail in hard-to-explain ways.
- Derive network access from the origin alone: rejected. A mistyped origin or bind
  would silently expose the port.
- Add password login first: deferred. It belongs with multi-user deployment (phase R7).
- Rewrite the origin of an existing installation in setup: deferred. The origin is part
  of the request digest, so changing it needs the same audited path as other bindings.

## Consequences

Operators who opt in are responsible for the private network and the TLS proxy. The
proxy must pass the Host header through unchanged, must not buffer event streams, must
accept 2 MiB request bodies and must keep connections open for at least 35 seconds.
One hostname serves one installation.

This is not hosted or multi-user deployment. Decision 018's review triggers still
apply: shared or internet-facing installations need identity and access management
and the constrained Docker broker first.

## Review triggers

Revisit for more than one administrator, a public internet address, an origin-change
command, or browser changes to secure-context rules.

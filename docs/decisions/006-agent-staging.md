# Agent staging paths and pre-write accounting

Status: selected implementation contract; installation/runtime qualification pending.

## Decision

Retain the closed bind-only Docker profile for the first release. Compose provides
one installation-owned absolute staging root at the same absolute path inside the
agent. A separate installation verifier must check daemon identity, the agent's
effective source/destination bind, propagation, access and canonical local path.
Reject symlinks, unexpected nested mounts and ambiguous mappings. Root provisioning
is explicit; a missing engine source directory must not be created by Docker.

Docker resolves bind sources on the daemon host; Desktop supplies host-directory
sharing through its VM. Identical path strings alone do not establish file
visibility or ownership. See [Docker bind mounts](https://docs.docker.com/engine/storage/bind-mounts/).
Keep forced recursive read-only input/secret binds. Reusing Docker's internal
named-volume directory is not a portable substitute. Named-volume engine mounts
would require a separately reviewed profile and inspection contract.

`agent/src/admission/staging.ts` owns versioned private policy and the deterministic
cost estimator shared by journal projection and the forthcoming stager. Reserve
exact prescribed offer JSON bytes, declared input bytes, secret allowance (64 KiB
each, aggregate 1 MiB), 64 KiB engine manifest and 64 KiB staging metadata. Pin the
breakdown/version with each reservation. Overflow rejects; no secret resolution is
needed to estimate. Per-run/pool/free-space checks include the complete charge.
The stager must require a matching charged reservation before directory/file I/O,
stream and hash inputs, and enforce every allowance before writing. Secret provider
limits are installation policy, not new guarantees made by the Offer wire schema.

The wrapper control file shares the attempt's output budget with samples/logs and
artifacts; terminal/in-flight margin must be retained. Agent SQLite event storage
is a separate installation allowance: copying the same events does not make that
second copy free. These are logical reservations, not portable filesystem quotas.

## Limits and acceptance

No staging allocator or installation mount verifier is qualified by this decision.
Pre-policy private pending records cannot authorize setup; existing reservations
retain their recorded charge and require matching policy before any new staging.
Migration of released user data is outside this unpublished rewrite boundary.
Actual Linux/claimed Desktop visibility, permissions, recursive read-only controls,
disk exhaustion, shared output guard and native architecture matrix remain required.
Unknown actions remain charged; this decision supplies no release authority.

# Decision 029: Durable staging identity, per-start physical checks

Status: accepted. Recorded on 19 November 2026. Refines the staging namespace
binding behind [decision 006](006-agent-staging.md).

## Decision

The installed staging namespace keeps its recorded identity (`namespaceIdentity`,
the intent, the root digest and the marker record) unchanged for the life of the
installation. What decides whether a later start is the same installation is
split in two:

- **Durable facts**, compared across starts: installation ID, daemon ID, the
  canonical source and target path, the root's owner, group and mode, and the
  marker's exact bytes. The bytes carry the namespace ID, journal authority and a
  random 32-byte nonce, so they cannot be reproduced without the original file.
- **Physical facts**, checked only within one start: the device and inode numbers
  of the root and the marker. Each start records the live values after binding
  and every later open, inventory and deletion is checked against them, exactly
  as before.

A start whose durable facts match binds to the recorded namespace without
rewriting it. Durable records that name the root (no-task receipts) carry the
root facts recorded with the namespace; physical checks use the live ones.

Task folders keep their recorded directory facts. A folder prepared before its
inodes changed no longer matches, so inventory and cleanup refuse it and leave
it in place. Re-establishing ownership of such folders is a separate offline
reconciliation: it must prove the attempts that wrote them have stopped and
check each folder against its recorded ownership. The namespace marker and the
deterministic folder name are not enough on their own, and old cleanup receipts
never gain authority over files observed later.

## Why

Docker Desktop's file sharing (VirtioFS) renumbers the inodes it presents inside
its VM across restarts while the host directory is unchanged. The previous
binding compared the full recorded root, inode included, so an ordinary restart
of Docker Desktop left the agent in `recovery_required` with no way forward short
of a fresh installation, which would discard live history. Inode numbers were
never part of what makes an installation the same; they are what keeps one
start's file operations on the files it inspected.

## Alternatives

- Re-hash the identity with the new inode: rejected. `namespaceIdentity` is
  referenced by every task, retirement, cleanup plan and receipt; changing it
  would orphan all of them.
- Back up, reinstall and restore: rejected. Restore is read-only archival
  ([decision 016](016-historical-restore.md)), not a migration.
- Move staging to a named volume: deferred. A volume may keep inode numbers
  stable for new installations, but it needs a reviewed profile and does nothing
  for existing recorded identities.
- Accept any directory at the path: rejected. A directory without the original
  marker bytes, or with changed ownership, mode or daemon, still refuses.

## Consequences

A deliberate copy of the whole staging folder, marker included, to the same path
now binds where it previously refused. The installation verifier's mount, path
and ownership checks still apply, and task folders inside such a copy are
refused until reconciliation, so the copy gains no cleanup authority.

## Review triggers

Revisit if staging moves to a named volume or another profile with stable
inodes, or if Docker changes what the agent's bind presents across restarts.

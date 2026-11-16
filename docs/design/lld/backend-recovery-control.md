# Backend startup and offline exclusion

Status: implemented prerequisite for [cold recovery](cold-recovery.md). [Delivery authority](delivery-authority.md) owns whole-installation
consistency, native quiescence and authority rotation. This control grants none
of those proofs.

## Ownership

Fresh offline provisioning explicitly initializes recovery-control.sqlite in the
private backend directory. The production configuration loader requires that path
and its installation identity. Startup never creates, repairs or adopts a missing,
corrupt, foreign or non-ready control. Direct injected application fixtures may
omit the control; that fixture seam is not the packaged startup path.

Serving opens the control before metadata workers, input maintenance, capacity,
delivery or history indexing. A retained EXCLUSIVE SQLite lease excludes the cold
coordinator and concurrent serving owners. It survives until HTTP/input readers,
publishers, agent/runtime owners and metadata all actually drain. Abort alone does
not release it. Cleanup failure keeps the retained control handle and exclusion.
The backend lease complements, rather than replaces, the agent installation-state
lease. No per-request, job, function or sample writes use either control.

## Storage and operations

One private no-follow file with canonical private parent, checked native identity,
one hardlink and fixed installation ID; at most16pages of4096bytes,64KiB cache,
no mmap, DELETE journaling and EXTRA synchronization. Native settings are checked.
Successful initialization syncs the parent; an exclusive creation conflict preserves
existing data. Process ownership retains native handles even on failed cleanup.
This is fixed installation overhead, not an additional engine output grant.

Serving exposes close only and accepts ready state. The offline facade reads the
bounded state, begins restoring with an exact operation ID and manifest digest,
and completes only the matching record. Closing does not clear restoring state.
These methods are privileged primitives, not a safe restore command or a proof
that copying data or completing the other service gate succeeded.

Source gates are excluded from the archive. Historical destinations use a fresh
control with an immutable history purpose, archive digest and separate native
attestation digest. Ordinary completion refuses historical purpose even before
sealing. Once historical, the control cannot become ready. Authentication uses
its separate fixed-size session table; archived metadata remains read-only.
[ADR016](../../decisions/016-historical-restore.md) supersedes in-place replacement
and authority rotation. Source receipts and original installation paths remain
untouched. Historical custody never grants execution or deletion authority.

## Acceptance

Use native SQLite lock contention, exact operation/digest replay, reopen after
incomplete restoration, identity/permissions/path substitution, failed cleanup and
startup-before-worker cases. Cold snapshot/restore stages and native recovery
qualification remain separate, required work. No user data, services or installed
configuration is changed by synthetic tests.

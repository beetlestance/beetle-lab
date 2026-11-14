# First-release restoration is historical and isolated

Status: accepted. The user chose read-only restored history for the first release.
This supersedes the in-place restore proposal in
[delivery authority](../design/lld/delivery-authority.md).

A cold backup still requires both real offline leases, current logical/native
quiescence and a bounded consistent snapshot of metadata, journal, inputs and
artifacts. An intact active-delivery restart preserves its original authority.

Restore accepts only a newly created, private destination, or an exact interrupted
operation at that same destination. It never overwrites an existing installation.
The source archive stays unchanged. The restored journal/configuration are archival
data; they are never installed as a serving agent or execution identity.

A fresh historical identity and durable completion attestation authorize a separate
read-only viewer. SQLite metadata opens read-only; authentication uses fresh separate
state. No agents, capacity publication, delivery, deletion, retention, index-writing
or other background mutation run. Ordinary startup, installer replay and recovery
completion cannot turn historical state into a writable installation.

Historical byte custody is independently established from the completed snapshot
manifest, exact destination and actual copied native files. It never grants
execution, ACK, deletion, settlement, refund or replay authority. An interrupted
copy or uncertain close cannot publish a ready attestation.

This avoids erasing post-backup deletion/mutation receipts and avoids treating copied
inode or journal-authority anchors as current native custody. A future writable
installation uses a fresh identity and root; mutable/in-place restoration needs a
separate reviewed design. See [cold recovery](../design/lld/cold-recovery.md) for implementation boundaries
and the [runbook](../recovery.md) for candidate commands. Release qualification
remains separate from this decision.

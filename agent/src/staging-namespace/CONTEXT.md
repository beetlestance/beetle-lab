# Staging namespace values
Public index.ts owns bounded private installed-root/marker/task values and port.
No native IO, SQLite or cleanup ACK/refund lives here. Codec validity is not IO proof.
Installed identity is durable: installation, daemon, path, owner/group/mode and exact
marker bytes (nonce). Root and marker dev/ino are per-start physical facts (Docker
Desktop renumbers them): sameInstalledRoot excludes them and the binding checks them
live; recorded values stay in the anchor unchanged (decision 029). Ancestor inode
checks are per-start native responsibility. No mtime/ctime authority or marker
adoption without durable intent.
Task anchors bind exact original/purpose/namespace/spec and four native directory
facts. Captured facts precede provider writes and never rebind an old original.
reconciliation.ts: stale facts after a renumbered root are recorded beside the anchor,
never in it; same owner/group/mode, bound to anchor identity and retirement (decision 030).
Caps: root 8 KiB, intent 12 KiB, anchor 16 KiB, singleton 32 KiB, marker 1 KiB, task 8 KiB
including512logical row allowance. Native inode/device values remain decimal strings.
Owner docs/system/contracts/outputs-collection.md; native owner staging; SQL owner journal.
Reconciliation may equal anchor facts (A→B→A); candidate pages are keys only, 32 per page.

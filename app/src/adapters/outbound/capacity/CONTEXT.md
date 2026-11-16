# Backend capacity source

Public entrypoint: openCapacitySource(options), using ports/runtime.ts ABI.
Pins the existing canonical private backend root by handle and device/inode/UID/mode.
Disk total is clipped by configured allocation; available space only refuses reads
at/below reserve. Agent staging disk never supplies backend storage capacity.
Requires configured installed pins and actual controls/resource provenance.
One original sample at a time; saturation returns null without issuing I/O.
Close aborts and drains the original sample and handle close, retaining unknown
close custody. The gateway remains owned by bootstrap.
One original capability fingerprint/result plus scalar time/revocation fences.
Cached agent replay cannot renew the aggregate <=1000ms lease; invalid sources
require a source strictly newer than the revocation fence. Optional sensors do
not establish or block displayed capacity.
Focused checks: npx vitest run app/test/capacity --maxWorkers=1

The required journalAuthority comes from the same validated frame as the lease;
equal-source replay cannot substitute another physical journal.

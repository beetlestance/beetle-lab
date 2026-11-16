# Cold accounting after four repeated runs

Read-only follow-up to [bounded repeated workloads](bounded-repeated-load.md).
Source images b48936d8, native ARM64 fixture, qualifier based on450644d6,
Node24.22.3. The separate cold check passed1491ms without another workload,
service start, installer, migration, cleanup effect or refund.
Private evidence: `.agent-work/cold-accounting/{plan2.json,checks2,report2.json}`.

The owner descriptor, installation identity and successful source outcome bind
four distinct finished Runs/attempts. All Compose and installation containers are
absent before database access. SQLite opens read-only/query-only transactions;
foreign-key checks pass and both main database hashes match before/after.
These observations apply to the stopped synthetic fixture, never a user install.

## Logical current debt

| Backend component | Bytes |
| --- | ---: |
| Original output allocation amounts | 33,816,576 |
| Authoritative finalization credits | −33,064,679 |
| Retained cleanup-control reservation | 262,144 |
| Retention reservation | 0 |
| Recomputed and stored current charge | 1,014,041 |

Input, export, namespace deletion, retention snapshot, output deletion, absence
and settled-replay owners are explicitly absent. Each finalization's retained
payload is independently matched to event bytes, canonical manifest length and
artifact extents. Original allocation rows are historical; they are not current
debt and must not be summed without the authoritative credits.

The agent retains four disk holds with33,554,432 output bytes and531,516 staging
bytes. Those rows independently reproduce all held/retained aggregate counters;
all four execution reservations are released. Replay and rejected-cleanup debt
are zero. Nine recorded metadata charge fields sum to944,098 bytes and stay
within each original quota. This is a sum of stored charge fields, not an
independent reconstruction of every metadata body or physical SQLite usage.

## File custody observations

All32 published artifact files match adopted source extent/SHA facts, totaling
419,845 bytes. The same artifacts match their native output copies. Backend
staging has no files. Agent task directories match exactly the four original
runtime identities; the installation marker matches its stored intent content.
No unknown task directory, symlink or multiply-linked file is accepted.
Each task's output/other file lengths stay within its current disk hold.

The scan inspects125 entries and1,424,009 file bytes. It bounds total entries to1024,
depth to8, individual files to8MiB, total file bytes to96MiB and time to60s.
Directory iteration is incremental, file opens do not follow symlinks, reads are
chunked and file identity/size/timestamps are checked after hashing. This supplies
no purge permit or fresh Docker-VM descriptor/namespace custody proof.

Both source databases remain byte-identical: backend1,118,208 bytes and agent
667,648 bytes. Logical debt, file length, SQLite allocation and host freed blocks
are distinct quantities. This does not prove active-write, retention/delete or
general-workload accounting, a leak-free memory plateau or telemetry overhead.

Two focused tests cover original/current debt confusion, negative credit, empty
files, entry exhaustion and symlink rejection. Node types/scoped lint pass; the
initial result-union annotation and complexity failures were corrected without
weakening checks. Independent review accepted this stopped-fixture scope.

The tooling boundary names only these reviewed read-only custody entrypoints for
this accounting owner. Five boundary tests retain sibling/deeper-private/reverse
import rejection. The original broad import attempt failed architecture; the
narrow amendment and public agent exports pass it. No service API was added.

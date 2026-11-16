# Backend native output prerequisites

Status: locally verified shared physical custody/promotion, namespace lease and
byte adapter. Metadata-worker survival/transfer integration and complete backend
artifact/result lifecycle remain pending.

| Component | Accepted source | Focused evidence |
| --- | --- | --- |
| Shared physical custody | `d697aa6` | 72 affected input/mapping cases, 6.553s; lint1.212s; NodeTS8.367s |
| Permanent parent-held lease | `a8a028d` | 20 native/process cases, 2.181s; lint1.285s; NodeTS8.134s |
| Native byte adapter | `f576ed2`, `592c258`, `8c6f0de` | 35 native/lifetime cases plus6 ownership and2 identifier/ordinal cases; targeted retries only |
| Shared physical promotion | `f4df01e` | 16 publication/recovery +4 absence cases, 1.983s; one new error mapping,0.462s; lint0.972s; NodeTS7.036s |

Commands used Vitest with one worker, changed-file ESLint and the affected Node
TypeScript project. Coordinator independent source review reused that evidence;
none of those suites was repeated merely to obtain another passing report.
Earlier failed/corrected attempts remain in local task reports. Architecture checks
on the integrated custody/lease/adoption-port baseline covered1394 files in3.73s;
this precedes the later promotion and byte-port additions.

The custody extraction preserves native operations, root identity and the checked
file verifier. Exact body comparisons confirmed the native port was unchanged,
root identity changed only its error import, and the file verifier changed only
class/type/constant/error ownership. Input public errors and lifecycle policy stay
with the input adapter. Full expected SHA256 and descriptor/named checks have one
physical owner.

The standalone namespace lease uses one fixed private SQLite sidecar and retained
DELETE/exclusive connection in the parent process. Real child processes prove
exclusion, confirmed SIGKILL release and recovery with the same inode. Same-process
duplicates refuse before native probes. Two issued checks retain ownership through
close; an uncertain SQLite close retains the real lock and cached registry fence.
Replacement, missing, symlink, extra-link, wrong-mode and corrupt paths refuse.
Failed-open native-close injection was not separately exercised.

Physical promotion reuses the no-overwrite hardlink, exact two-alias proof and
staging unlink sequence, with full hash and both parent flushes. It never creates
an absent file, including an empty artifact. Input state eligibility and its explicit
empty-file reconstruction remain outside that helper. Positive promotion still
requires its caller to close original handles successfully before a receipt.

The native byte adapter tests exercise real binary append/replay/partial tails,
zero/missing files, exact whole-file hash, lost link/unlink replies, signature
mutation, original sinks and closes, cancellation/deadlines and bounded credits.
Child processes prove held or failed file/directory closes retain namespace
exclusion until successful drain or confirmed process exit. The35 original cases
ran in separate focused groups (4.200s,7.055s,2.631s,2.159s); NodeTS passed8.111s.
Independent review found nested proxy capture could borrow another token's FileJob.
Six regression cases reproduced it, then passed1.331s after direct original-job
binding; one native control passed1.201s, lint0.777s and NodeTS6.898s. Two later
contract cases passed0.814s: ordinal128 refuses before IO, while declared uppercase
artifact IDs retain their exact spelling through real append/publication/read.
Original suites were not repeated for these corrections.

The [native output contract](../design/lld/output-files.md) specifies the remaining
complete adapter and process evidence. Standalone lease tests do not prove that an
application transfer loop fences on metadata-worker failure or drains file jobs.
No source adoption, terminal result, quota refund/deletion, Docker image, benchmark
or amd64/arm64 release qualification follows from these component checks.

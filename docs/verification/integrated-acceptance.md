# Local integrated acceptance

Baseline: ff0725e; this change adds reviewed fixture corrections and a dispatcher
boundary fix. Runtime: macOS arm64, Node26.7.0. This is local source acceptance,
not packaged browser, native Linux-platform or release qualification.

## Coverage and evidence reuse

All 987 configured test files were covered through bounded root groups. Passing
unaffected cases were retained; failed or affected cases received focused checks.
This is a combined evidence set, not a single all-green test command. Relevant
source, tests, dependencies, configuration and environment hashes are retained
with original logs, JSON results and check-runner command/exit/duration records.
Final TypeScript, lint, architecture and documentation checks passed. Generated
contract/API/compiler and frontend-build checks passed at the baseline; their
relevant production inputs were unchanged by these corrections.

| Root | Files | Current cases | Evidence scope |
| --- | --- | --- | --- |
| Application | 356 | 2619 | Storage group and two application shards; focused fixture/dispatcher corrections |
| Agent | 308 | 2462 | Original group plus affected historical/current guard, publication and lifecycle corrections |
| Contracts | 77 | 954 | Original group plus organisation-overview vector, client binding and inference/route checks |
| Browser components | 90 | 614 | Original group plus scoped overview/session-fixture corrections |
| k6 | 105 | 1185 | Original group plus publication identity, template bounds and history-page corrections |
| Tools | 51 | 273 | Original group plus public-index architecture and compiled-worker fixture corrections |

The earlier agent substring filter also selected seven application and four tools
files; those overlaps are excluded from these root totals. The new overview vector
adds one case. No skipped case is counted as a passing correction.

## Corrections and preserved oracles

The dispatcher read an accessor-backed operation discriminator before rejecting
it. It now requires an own string data descriptor before dispatch; message-limit
selection also uses descriptor-safe lookup. The existing regression verifies zero
getter calls. Missing/inherited/accessor/nonstring kinds fail closed.

Historical seeds remain restricted to their actual schema versions. Raw current
connections use real production guard registrations, never fake predicates or
permits. Missing-ACK registration tests register unrelated real owners while
leaving the target callback absent. Existing original-row, rollback, scope,
receipt, accounting and no-replay assertions remain intact.

Run fixtures explicitly fund both installation and runtime pools for retained
cleanup originals. Fairness tests retain exact-fit and one-byte-short oracles;
default product settings are unchanged. Child publication helpers build their
real workers once before the bounded five-second child exchange. The retirement
race uses a deterministic deferred ownership boundary rather than a stack name.

Publication tests now inject faults at the actual `.engine-result.json.pending-`
path, preserving adjacent high-bit device/inode rejection and no-overwrite checks.
Template tests distinguish literal body support from bounded expansion. Run-page
fixtures include the current summary envelope. UI tests account for the overview
request and keep wrong-scope rejection and late-session fencing assertions.

## Failures retained and limitations

The initial compiler exceeded a 1 GiB heap; compilation passed with 2 GiB, without
raising test heaps. The initial aggregate test command exceeded its 900-second
bound; root groups replaced that scheduling plan. One application shard omitted
local-listener permission and failed with EPERM; only affected files were rerun
with permission. These failed logs remain available and are not reported as passes.
A focused limit assertion initially used the wrong fallback size; it now checks
its actual 65536-byte request allowance. Independent review covered the risky
guard, migration, quota and dispatcher changes without repeating the test lane.

The [inventory ledger](inventory-audit.md) maps all 36 product IDs, A01–A09 and
V01–V24 to evidence and explicit gaps. Original/live stderr remains unsupported;
only sanitized final diagnostic history is implemented. Component tests do not
close real-browser acceptance. Matching images, native amd64/arm64, resource/crash/
secret/backup qualification and hosted delivery evidence remain B09–B11 work.
No user service, published image, CI policy or legacy default changed here.

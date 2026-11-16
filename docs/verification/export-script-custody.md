# Native export-script custody evidence

Status: locally verified shared native component; admitted export job pending.
Source: feature commit containing this report, based ona7281b1.
Contract: [script custody](../design/lld/export-script-custody.md).

Shared native artifact custody now has a separate wrapper feature. Attempt
orchestration and metric archive consume its public entry; unchanged failure
values have one shared owner, with previous type/value reexports retained.
No engine/compiler logic or native uploader was duplicated.

One64KiB streamed SHA reader replaces whole-file artifact hash buffers and is
shared with metric archive. Each pass bounds positional progress and probes EOF;
archive allowance remains<=256MiB, portable-script allowance<=64MiB. Native custody
retains strict UID/mode/link/size/inode/stat, two hash passes, fsync, named file/root
checks and original close failure. Mandatory cleanup is separate from publication
eligibility. No whole-process or global memory measurement is implied by scratch.

The script job captures the existing builder's path/bytes/peak and allowance before
async work; it never creates/deletes/replaces a file. Exact jobRoot/standalone/suite.js
is required. The checksum comes from verified native bytes, with a descriptor only
after original file/parent closes and final outer-root identity reconciliation.
Result/settled retain issued native work; actual cleanup failure stays explicit.
Parent must still recheck its job fence before publishing a later result manifest.

Initial forty-three focused hash/script/legacy-artifact/archive cases passed in
6,416ms. These include the actual shared compiler/builder with embedded inputs,
>3MiB native script, fixed scratch/call counts, malformed/stalled/EOF reads and
path/budget/UID/mode/link/symlink/size/cancellation refusals. Six new native lifecycle
cases passed in1,328ms: file/parent close holds, both close failures, root replacement
and post-hash byte mutation. No live load target or k6 executable was invoked.

Review found two additional defects. Replacement during final realpath could pass
using a cached earlier root stat. Also, stopped publication checks inside cleanup
could report failed cleanup despite successful native closes. Two regressions
reproduced these before correction. Final named identity now follows canonical-path
IO; required native close/sync/root cleanup drains without the stopped publication
fence. Cancellation remains the result when cleanup is confirmed. Actual cleanup
errors still reject settlement without retry.

Sixteen corrected lifecycle/affected legacy-artifact cases passed in1,994ms.
Changed lint passed in1,453ms, Node types8,964ms, architecture14,113ms and the
engine wrapper bundle1,040ms. Original
failures and scoped command/exit/timing logs are preserved. Independent review
accepted both corrections without duplicating checks. Doc/link gates precede
integration; no verification threshold or assertion was lowered.

This proves a native script-custody component, not an admitted standalone export
workflow. Build lifetime/compilation binding, dedicated agent purpose, durable
queue/reconciliation, verified result publication, HTTP/download/UI/client and
container/release qualification remain. No existing user files/services, installed
profile, Docker image or public capability were changed by the synthetic fixtures.

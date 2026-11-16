# Current candidate qualification

Candidate `cf44e96ad658462047fdba51cc8858cf614571bd` passed
[CI43872965435](https://github.com/beetlestance/beetle-lab/actions/runs/43872965435):
all six test shards, source/legacy checks, both native image jobs and both
aggregates. Immutable archives include scans, SBOM/license and round-trip checks.
Publication was skipped. Published rewrite candidate72243a87 remains unchanged.

Harness `feb0369e` has identical app/web/agent/contracts/engine sources, lockfile
and container inputs to this candidate; intervening changes affect qualification
only. Earlier schema29 fixture failures remain recorded in
[candidate corrections](candidate-schema29-fixtures.md). Passing the corrected
candidate does not retrospectively turn those failures into passes.

## Native ARM cold recovery

The unchanged cold helper completed in70.853s on the candidate images under
Node24.22.3. The packaged UID1000 CLI produced a bounded backup, restored it as
read-only history, persisted its browser session across viewer restart, refused
mutations and downloaded all eight hash-matching artifacts. Exact completed restore-operation
resume preserved metadata. Source main files stayed unchanged; all2,169 frozen
harness inputs matched after execution. Normal and independent cleanup passed.
This is current-schema ARM proof; earlier native AMD cold evidence retains its
recorded image/schema identity.

The retained schema29 archive was also opened by immutable old72243a87 reader
whose maximum metadata schema is27. This separate5.989s check ended non-OOM with
exit1 and fixed CLI code `unavailable`. All13 archived files,1,521,399bytes,
retained the same bounded full-tree hash before/after. The viewer used its normal
writable history mount, UID1000 and no network; refusal was not manufactured by a
read-only filesystem. This proves refusal for this reader/archive pair, not a
precise causal CLI diagnosis or general rollback compatibility. Both cleanup
checks passed. Supported restoration remains read-only history.

## Used workspace in actual Chromium

The first15.367s probe used the candidate UI to delete a workspace containing a
real completed run: DELETE200, back/forward navigation returned scoped404 and no
active workspace controls remained. That probe then failed because its success-
only response helper was incorrectly used for the expected old-run404. Its whole
result remains failed; the saved deletion/cache observations remain usable facts.

A first continuation failed before UI actions because SQLite could not open its
auxiliary files on a filesystem-read-only mount. The corrected observer retained
DatabaseSync readOnly and query_only, used the ordinary writable mount for SQLite
auxiliary files, and verified the main metadata hash around every observation.
No source permissions or product code were changed.

The15.501s continuation passed: old workspace/run routes404, the same visible
workspace name created a new UUID and navigation selected the new workspace.
Cold comparisons preserved the original Run core fields, allocation, sealed
payload hash, eight artifacts and folder/suite/settings counts; foreign-key
checks were empty. No new engine or target ran. This is composed deletion/cache
and resumed name/data evidence, not one uninterrupted passing browser trial or a
byte comparison of every retained row. Browser close and both cleanup checks
passed for each probe.

## Final acceptance

[AMD telemetry](telemetry-comparison.md), [current repeated memory](repeated-memory-analysis.md)
and [current AMD long stream](long-stream.md) now have accepted scoped passes.
The long profile measured successful live p95193.16ms against unchanged250ms;
all three readers spanned over30min, with explicit unavailable reads. Independent
[69-ID review](final-acceptance.md) found no additional required behavior missing
from the accepted composition. [Closeout](qualification-closeout.md) records the
finite goal disposition; publication/default changes remain separate.

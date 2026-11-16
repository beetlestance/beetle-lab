# Historical migration fixture triage

Candidate based on0514b74. Test fixtures and acceptance documentation only;
production migrations, SQL guards, quota rules and admission code are unchanged.
This reconciles the old25-failure note in [cleanup control](backend-cleanup-control.md),
not a whole-suite green or release qualification claim.

## Findings and corrections

The original untouched baseline recorded27 failures across9 files; two were fixed
in that earlier slice, which then reported25. The current source selection of those
nine files ran36 cases:24 failed and12 passed. Those numbers describe that selection.

Schemas5–7 fixtures were calling current run admission, which expects newer
export/cleanup/order tables. A test-only historical row seed now uses the original
7739937 insertion shape, real legacy schema/SQL guards and shared pure wire builders.
Only schemas5–7 select that path; current enqueue still uses production admission.
It supplies structural data, not historical admission/capacity qualification.
Historical output reservation likewise rejects current schemas and nontransactions.

Current claim/scan/observe assertions run on a genuinely migrated private copy;
the original schema6 connection still proves immutable authority and charge guards.
Every original field/receipt/charge remains compared across migration, with later
history-summary columns checked separately for their intended defaults. Rollback
cases still compare original schema, rows and version. Latest-version assertions
use METADATA_SCHEMA_VERSION; future-schema rejection creates version+1 and verifies
it remains unchanged.

The shared-fixture consumer lane found six more stale expectations. Cleanup control
is paid on enqueue, so a failed claim must retain that exact charge. A65th enqueue
pays its control, then a failed output claim must change no further bytes. Large
terminal-history fixtures explicitly fund their retained controls. Input/output
contenders share the remaining payload+metadata allowance, without charging cleanup
twice. Raw contender connections now register the actual production SQL guard owners;
the lock test distinguishes SQLITE_BUSY before commit from quota rejection after.

## Scoped evidence and limits

The affected27-file lane ran214 cases:208 passed and six exposed the additional
fixture issues above. The15 cases in those three corrected files then passed.
The final lock-oracle assertion has its own focused rerun. Earlier passes are
reused only for unchanged test/fixture/production inputs; failures remain recorded.
Types, lint and structural checks accompany the fixture slice.

All nine historical files passed in the affected consumer lane; this retires the
old failure note as implementation backlog. It does not assert today's full-suite
failure count. Full integrated acceptance, packaged browser/platform, delivery CI
and R0–R4 release evidence remain open. No user installation/data/service was touched.

# Controller source lifecycle

Status: reviewed and locally integrated agent component. Installation/controller
source recovery is connected; backend artifact transfer and result publication
remain required. No complete backend-to-k6 execution or release qualification.

## Implementation and review

Source `f6648a45f579d360b605806be300c59114bf31cc`, corrected by
`8c52c1d4702804a7f8cdc5f297002e9c82d69e01`; controller integration `b8899adc`.
Installation source-first recovery: `cf931a7`, integrated in `fd50875`.
Combined code and schema fixtures: `8a02b674`.

One SourceSession owns stable intent, collection/source and release requests.
Stopped control root/checkpoint observations require successful cached reader
close and original plan/launch agreement before intent creation. The existing
collector supplies complete raw-byte/root facts after its original IO and closes
quiesce. Finished release uses the exact durable source receipt. Successful
collection followed by source quota/commit failure retains its captured request
and charge; it never becomes a failed collector or another target execution.

Existing intents enter recovered semantics even with the same live Journal.
Pinned native root/prefix verification and a fresh bounded operation budget allow
artifact-only recovery after execution timeout. Failed recovery retains pending
custody. A stored source wins before current catalogue, staging or actor access.
All newly issued physical release paths require an exact positive reply; unstarted
abort uses its distinct scoped never-started proof, including during close.

Independent source review took3m41s and found unchecked replies in ordinary
no-intent failed release and unstarted abort. The correction reuses release proof
validation and checks the abort tuple; finding closure took18s without rerunning
checks. Both findings are closed. Installation ordering and schema-fixture changes
were separately inspected by the coordinator, independent of their authors.

## Scoped evidence

Initial controller regression checks passed44 cases with one equal-clock failure.
The corrected oracle requires deferral, zero collections and no intent at equal
time, followed by progress after a genuine later observation. New lifecycle/recovery
checks passed19 cases with one deadline-oracle failure; its correction compares
against the actual supplied deadline. Only those two failed cases reran, real2.42s.
Five changed/new native cases passed, real2.78s. Final changed lint passed, real0.72s;
affected Node types passed, real5.91s. These are composed scoped results, not a
single final all-controller run.

The reply-proof correction passed18 selected cases including two existing valid
controls, real6.89s; changed-file lint passed, real0.96s. Actual empty
native control and compiled Journal demonstrate unchanged charge/no source on
bad replies, identical failed-proof replay, abort contradictions and failed-close
ownership retention. Earlier passing cases were reused.

On combined `8a02b674`, three selected installation/controller seam tests passed,
real3.75s: real Stager/Supervisor/controller handoff, source-first committed release
and actual lost-release-reply/reopen. The separately reviewed schema-fixture update
passed12 selected migration cases, real10.26s; lint passed, real0.62s. Historical
standalone migration/rollback expectations remain unchanged; current schema12 and
future-version13 tests retain exact data preservation. This is protocol fixture
maintenance, not legacy application config/history migration.

The combined affected Node typecheck passed, real7.16s. No other behavior tests
were repeated for integration. Structural checks passed1278 source files,
real2.63s; documentation checks passed206 files, real0.37s, before this timing note.

## Limits

Native tests use real staging/control/output file owners and compiled SQLite
workers, including pending recovery after reopen/expiry, directory replacement
with preserved file inode, and rejected original descriptor closes. Docker
observations and engine results are synthetic. Other tests use explicitly synthetic
collector metadata; no JSON object proves native custody by itself.

No full-suite, native k6/Docker/platform matrix, power-loss, browser, soak,
publication/transfer/deletion or application outcome qualification is claimed.
Source retention, final event-stream closure and backend output allowance remain
separate owners; physical release does not authorize storage refunds or deletion.

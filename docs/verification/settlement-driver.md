# Automatic settlement reconciliation evidence

[Contract](../design/lld/output-settlement.md). Normal backend Root composes the private
settlement gateway, bounded discovery and a third turn in the existing serial cleanup
runtime. No new scheduler, user intent, public DELETE or retry execution is introduced.
Isolated predecessor tests may explicitly omit settlement; file-only plus settlement
is refused. The installation-owned gateway retains actual DNS/request/response/socket
originals and shares source admission before reading caller traps.

Discovery reads at most32+1 physical sequence candidates within a captured horizon,
then filters readiness/ACKs. Semantic cursors bind installation, page size and canonical
encoding. Empty eligible pages still advance. Released absence includes never-started
admitted reservations; rejected no-admission absence stays protected in both discovery
lanes. Positive unsent cancellation needs no agent reply or call.

Source/absence derive the actual retained request and immutable ACK, send the exact
release instruction and validate its reply before invoking backend settlement. Unknown
transport outcomes preserve all backend debt and use bounded backoff. Cancellation and
shutdown join issued HTTP and metadata originals; a late agent reply does not grant a
backend refund after the turn is cancelled. Already committed backend credit is not
rolled back or repeated by caller cancellation.

Review found a derivative history race: a scanned job may outlive Run deletion.
Private scoped metadata now distinguishes a current deletion from a validated permanent
retired identity. Pending deletion defers30s before new metric reads, advancing the due
index. Held projection errors recheck positive retirement. Exact retired commit/defer
returns a skipped marker rather than pretending to publish a summary. Other missing,
wrong-scope, wrong-attempt and source-conflicting records remain errors. Actual workers
capture these outcomes at both boundaries and reject a substituted retirement identity.

Real task-owned TCP tests cover authentication/body/path, exact reply binding, bounded
request/response bytes, shared full source capacity, held DNS, caller mutation, abort,
deadline/shutdown, all native closes and non-success status. Driver tests use actual
backend transactions with synthetic agent replies; they cover credit once, no credit
on uncertainty, fair file turns, empty pages/capacity refusal, held commit and late
reply shutdown. Real rejected absence dispatches neither gateway and retains charges;
real unsent cancellation settles automatically without agent calls. History tests
hold projection through actual settlement, then index another Run; pending deletion
also leaves later indexing live. Compiled worker tests verify discovery and retirement.

Preliminary type checks found copied identifiers/readonly fixture mutation, corrected
before execution. The first behavior lane passed62 of63cases; the remaining assertion
expected a file remove before its second three-lane turn. Correct timing was125ms.
The correction/protection/worker lane passed9cases. Lint then required responsibility
splits in validators, discovery, turn binding and Root composition. History fixture
ownership typing was corrected before execution. The affected history/scan/driver/Root
lane passed31cases, then lint required one wire-validator split and typed mock cleanup.
Final types17.20s,18cases10.91s, lint7.44s, architecture6.71s, docs.68s and API build.94s
passed. Counts overlap; no full-suite or native chain claim is made. Independent review
accepted the corrected scoped implementation conditional on these final gates.
Two final port/function comments were clarified with identical emitted executable JS;
private hashes record that comparison. Remaining non-document inputs stayed frozen.

Whole-chain Linux-agent/native cleanup, both workers and lost settlement replies still
require their separate qualification. Never-admitted funding and public retention are
not completed by this slice. No user service, registry or remote repository changed.

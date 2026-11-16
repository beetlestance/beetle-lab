# Run artifact downloads

Status: locally verified backend behavior at `1fd4ed8`. Contract:
[artifact reads and streaming](../design/lld/run-artifact-downloads.md).

## Implemented behavior

Scoped metadata resolves the requested owned attempt, including historical
attempts, through existing immutable source/finalization and published slot facts.
Source-free finalization returns absent; incomplete publication stays pending.
Pages contain at most100 descriptors/73,728 bytes with canonical bound cursors.
GET reads do not claim writers, change quota, ACK events or finalize output.

Authenticated content shares the installation's existing native byte owner.
One HTTP download, a fixed30s lifetime and existing native two-job credits bound
work. Shared input helpers retain their range, socket drain and cancellation
semantics. Nonempty responses use chunked framing; successful EOF requires native
result/settlement, selected length and, for full reads, the declared SHA256.
Empty files also require native verification. Midstream failure destroys the
response. Known native busy refuses before IO and preserves publication retry's
logical writer; other failures retain their original classification.

## Evidence and review

Coordinator independently checked all40 submitted source hashes, implementation,
fixtures and failure oracles; the implementer reviewed the coordinator's contract.
Actual native prepare/append/publish/finalize, compiled metadata worker and paired
synthetic TCP establish full/range/empty reads, scoped refusal, unchanged storage
charges/event reads and reopen. Controlled wrappers establish withheld EOF,
late settlement, altered streamed SHA, settlement failure and disconnect/shutdown
ownership. Historical-head changes are controlled SQL fixtures, not a production
retry qualification. Native credit refusal/writer reuse uses actual held reads.

Worker scoped checks passed: metadata/absence5, final HTTP/lifetime and affected
transfer38, client9, plus earlier native and affected input controls. These overlap;
they are not a unique-test total. Expanded-lane failures exposed a nested absence
transaction and incorrect fixtures; corrected focused checks passed. Raw failures,
commands, timing and final source manifest are retained in local task evidence.
Changed lint and Node types passed. No assertions or gates were lowered.

Coordinator's one integrated HTTP/worker/native check passed in2.44s; architecture
checked1641 source files and docs checked261 pages before this report was added.
The standalone page byte-cap helper test uses schema-invalid padding solely to
isolate serialization bounds; it does not prove a valid maximum-size wire page.

## Limits

Browser controls are a subsequent consumer. No independent browser digest/save,
real engine run, Docker image build, complete installed-agent download composition,
CI run or release qualification is claimed here. Installation read-view wiring
is source/type checked; the composed TCP fixture wires the real byte store directly.
EOF withholding prevents a successful HTTP completion after failed custody checks;
it cannot retract bytes already streamed to a client.

# Backend output payload carrier

Status: coordinator contract for implementation. Migration008 is reserved for
this boundary; source adoption and terminal settlement are separate work.
This refines [output adoption](output-adoption.md), without changing public wire
schemas or the pure attempt-observation merge.

## One stored body

Use one execution_output_payloads row per retained execution. Its kind is result
or manifest; canonical_json contains exactly that body. A result is bounded to
65536 UTF-8 bytes; a manifest to 73728. An atomic UPDATE replaces a provisional
result with its containing canonical manifest. There is no intermediate persisted
second body or dangling reference. A manifest is immutable once adopted; equal
replay is permitted. A different result or manifest conflicts.

The execution snapshot becomes a closed result-free header, at most2048 UTF-8
bytes. Keep a monotonic result_observed flag separately. Carrier existence alone
does not imply that an agent snapshot observed a result: adoption may arrive first.
Before mergeAttemptObservation, reconstruct the old complete snapshot iff the
flag is true, selecting the result body or manifest.result from this one carrier.
Use the existing merge owner; do not implement a second chronology algorithm.
Store the merged header and flag in the same immediate observation transaction.
Later observed results must equal the carrier's result; never create another copy.

## Accounting and guards

Let C be retained event charge, S the result-carrier bytes, M the manifest bytes,
A the sum of its declared artifact sizes, and D other explicit payload copies.
Before adoption require C+S+D<=P; afterward require C+M+A+D<=P. These are charges
inside the original payload reservation, not additional installation reservations.
Header-only admission/release updates use the bounded metadata allocation and
must work when P is too small for a result. Insufficient payload space refuses the
body transaction without silently dropping a result, expanding P or claiming ACK.
Event ingress subtracts the current carrier/artifact charge in both application
preflight and native SQL; neither operation can independently spend the same P.

The carrier FK binds to the existing execution. Native insert/update guards bind
its result identity to that execution, enforce integer-safe bytes and declared
artifact sum, combined charge and immutable body transitions. A manifest insert
requires acknowledged generation1. A provisional result insert may precede the
first ACK inside its owned observation transaction; the existing original record,
allocation and physical Journal binding must already exist. Retain rows until a
separate accepted deletion protocol authorizes removal.

Native header guards prohibit an embedded result, cap bytes and require a matching
carrier whenever result_observed=1. Existing admission, first-ACK, release and
immutable ownership guards remain active against the result-free header. Never
weaken these guards to make migration pass. Bound native SELECT text with CASE
before returning bodies, and validate reconstructed snapshots through existing
contracts before merge or response serialization.

## Migration008

Apply the conversion atomically. Preflight every old header/body and combined
charge before changing authoritative state. Fail the migration intact on invalid
or over-budget retained data; never erase it or enlarge an allocation.
Capture each existing canonical result into the new carrier and remove only the
result key from snapshot_json, setting result_observed accordingly. Preserve all
other snapshot fields, original bindings, ACK/release states, counters and event
rows. Install final carrier/header/event guards after conversion within the same
transaction; the migration owns temporary trigger ordering explicitly. Readers
must not observe a partially converted schema. Keep startup's future-schema fence.

## Focused evidence

Actual metadata SQLite: split/reopen/reconstruction, same-sequence replay and
out-of-order snapshots with the original merge owner; result-free snapshot with
adopted manifest; equal/conflicting result after adoption; exact and one-byte-short
combined event/body/artifact allowances; event/result races; tiny-P header release;
raw SQL embedded result, absent carrier, wrong identity, mutation/delete and unsafe
integer refusals; atomic migration failure preserving old rows/version.
No complete source adoption or result route is claimed by this prerequisite.

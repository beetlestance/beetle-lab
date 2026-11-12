# Inline report and format downloads

Status: reviewed local browser components and authenticated backend/worker HTTP.
Actual browser display/save qualification remains unavailable.
Contract: [performance reports](../design/lld/performance-reports.md) and
[artifact downloads](../design/lld/run-artifact-downloads.md).

Run result selects exactly one performance-report artifact under its existing
scope/run/attempt/engine checks. Ambiguous candidates are refused. Shared browser
artifact reading verifies exact bytes/SHA256 and bounded fatal UTF-8 before plain
preformatted display. No report HTML or duplicated metric/outcome calculations.
A session/selection lease and independent5s display watchdog clear stale values;
late successes cannot repaint them. Retry is explicit. Physical fetch/body/hash
originals retain the shared two credits across target and performance readers.

Shared artifactDownload permits only fixed txt/CSV/JSON media types/extensions for
the corresponding known kinds; unknown kinds stay bin/octet-stream. All responses
remain fixed-UUID attachments with nosniff/no-store, exact streamed full-read SHA,
range custody and original-settlement EOF handling. Engine paths never become
headers or URLs. Clicking a link makes no save/completion claim.

The private getRunArtifact reply now carries {record,kind} under its existing4KiB
bound. Kind comes from the validated published manifest; strict parent/worker
capture retains scope/attempt/file identity. Native OutputFileRecord is unchanged.
Metric archive consumers unwrap the record and require the selected descriptor's
kind to match before opening bytes. No migration, dependency or public JSON-schema
change was needed.

100 focused cases passed, including native WebCrypto, malformed UTF-8, cross-kind
saturation/cancellation, held body/hash originals, scope/session retirement,
StrictMode, escaped report text, ambiguous results, inventory extensions and actual
authenticated full/range/empty transfers through the compiled worker.16 affected
metric-history cases passed. A separate two-case check covers exact metric reads
and refusal of a mismatched published kind before native file reads.
Node/browser types and changed lint/structural/docs gates were checked separately.

Initial type checks exposed the absent kind in the private read reply and its
remaining consumers; those boundaries were explicitly amended. Complexity gates
required separating descriptor matching and report selection from their query
owners. No gate or assertion was lowered; only affected scopes were rerun.
No Docker/native-engine rebuild or user-service restart was required. The in-app
browser execution tool remains unavailable, so jsdom is not a saved-file, visual,
keyboard or native browser qualification claim.

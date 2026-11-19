# Published artifact preview

The result artifact inventory offers Verify and open for declared native UTF-8
kinds: standalone script, report, numeric final, warnings, diagnostics, metrics CSV,
metric windows/index and target runtime. Relative paths remain escaped text.
Publication metadata, never run state, grants the scoped UUID content path.
Other kinds and files above 32 MiB remain download-only, with the limit explained.
Attachment filenames/media policy are unchanged; unknown formats stay binary.

## Verification and resources

The shared VerifiedArtifactReads admits an explicit artifact-preview profile up
to 32 MiB. Every other reader keeps its 1 MiB default. The same two-original
admission spans kinds/profiles; fetch/body wires serialize without cache or retries.
The 5 s lifetime includes waiting, fetch, exact size, full-file SHA-256 and decode.
Ignored aborts, body cleanup and hashing retain admission until actual settlement.
Response streams keep their 4096-fragment limit and exact advertised length checks.
Same-origin credentials, redirect refusal and immutable captured descriptors apply.

Both size and SHA-256 must match before any content appears. A mismatch beyond
the excerpt also refuses the preview. Only the first 64 KiB is UTF-8 decoded;
a partial trailing codepoint is held back for truncated files. Malformed prefix
UTF-8 refuses display; no assertion is made about encoding outside the excerpt.
The dialog labels truncation and says the hash covers the entire file.

DOM text stays at most 65,536 UTF-16 code units. JSON indentation is attempted only
for complete files <= 8 KiB, after the shared encoder bounds depth, nodes and
collection sizes; expanded output above the display bound falls back to raw text.
No interpretation of HTML, script, NDJSON records or arbitrary objects occurs.

## Presentation lifetime

The existing display lease retires by session, scope, run, attempt and artifact
metadata. Closing the dialog aborts display and ignores late replies without
claiming that an issued physical read stopped. Retry is explicit.
Download remains an ordinary native browser attachment transfer; preview integrity
does not claim that a later download or OS save has been verified.

## Anchors

| Code | Reviewed |
| --- | --- |
| `web/src/lib/verified-artifact.ts` | `f67c4aa25dbe` |
| `web/src/lib/response-body.ts` | `253992da68f6` |
| `web/src/features/runs/artifacts/ArtifactViewer.tsx` | `a523d5fbe171` |
| `web/src/features/runs/artifacts/preview.ts` | `ed499f014a55` |
| `web/src/features/runs/artifacts/index.tsx` | `4402d673af2d` |

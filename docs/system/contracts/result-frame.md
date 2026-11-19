# Result frame and traffic headline

The result title/status still use authoritative Run state. Traffic wording uses
one ready metric overview when available, including null values; it never fills
missing overview fields with values from the history index. Without a ready
overview the existing indexed summary remains the fallback. Native SLO verdicts
and saved limits retain their own bindings. No new read is introduced.

Whole-run RPS is labelled as an average over the measured duration, not a steady
rate maintained throughout every phase. Percentile estimates retain approximate
wording. Missing duration, rate, percentile or failure ratio remains unknown.

The frame separates title/actions from a full-width sentence. Section navigation
keeps real hash anchors, follows external/native hash changes, marks its selected
location and calls the existing lower report-tab selector when required. It adds
no reading or mutation ownership.

Desktop notes live below the title; phone notes join the lower disclosures.
A missing writable note offers Add a note; restored history offers no writes.
The run-note classes are distinct from the engine-result panel's diagnostic note
styles. Note edit stamps and explicit conflict choices follow
[authoring](authoring.md#run-notes), with frozen drafts and receipt-only replay.
Legacy timestamps remain unrecorded; restored views have no note controls.

Source browser checks do not prove packaged/native delivery or whole-family
visual acceptance. Phone disclosures now cover What happened, Target runtime,
Artifacts, Notes and Diagnostics, plus retained Report/charts/script access. They
mount readers on first open and retain visited children; the single Notes owner
survives collapse and resize, including unresolved identical-replay saves. Hashes
open the addressed section. Phase comparison keeps its target and Back control
visible. Header, summary, chart and endpoint phone board matching remains open.

## Anchors

| Code | Reviewed |
| --- | --- |
| `web/src/features/runs/result/headline.ts` | `ef62bb206bed` |
| `web/src/features/runs/result/SectionNav.tsx` | `2781bcc519ff` |
| `web/src/features/runs/result/ResultHeader.tsx` | `23f6b9adf58a` |
| `web/src/features/runs/result/RunNote.tsx` | `0f0c005de309` |
| `web/src/features/runs/result/PhoneDisclosure.tsx` | `587774070696` |
| `web/src/features/runs/result/phone.css` | `ba4a5771ad8d` |
| `web/src/features/runs/result/ReportTabs.tsx` | `8ca6f4c10bae` |
| `web/src/features/runs/result/index.tsx` | `0072e7ccce8c` |

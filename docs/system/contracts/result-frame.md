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

Run notes live below the title group, outside the pooled summary/chart flow.
A missing writable note offers Add a note; restored history offers no writes.
The run-note classes are distinct from the engine-result panel's diagnostic note
styles. Mutation versions, unknown-outcome replay and retirement remain unchanged.
The designed note edit timestamp and explicit conflict-resolution controls are
not qualified by this frame change; they remain separate implementation gaps.

Source browser checks do not prove packaged/native delivery or whole-family
visual acceptance. Full result/phone disclosure matching remains in the goal.

## Anchors

| Code | Reviewed |
| --- | --- |
| `web/src/features/runs/result/headline.ts` | `ef62bb206bed` |
| `web/src/features/runs/result/SectionNav.tsx` | `2781bcc519ff` |
| `web/src/features/runs/result/ResultHeader.tsx` | `23f6b9adf58a` |
| `web/src/features/runs/result/RunNote.tsx` | `498d9df6a95a` |
| `web/src/features/runs/result/index.tsx` | `143a0fd991a7` |

# Retain verified observations after a stopped run

Status: Implementation in progress. The Result views can display accepted
partial evidence. After native retirement, the agent commits verified samples
with the absence receipt. Backend transfer, storage and presentation remain open.

## Current behaviour

The k6 wrapper seals normal outputs after collection. A cancel signal aborts the
wrapper fence, and an OOM or immediate stop can end the producer before it writes
an engine result. The existing cancellation qualification explicitly expects
source-free finalisation in this case. See
[cancel evidence](../../../tools/qualification/native-application/cancel-evidence.ts).

The live history read verifies approved archive prefixes, but uses a running
attempt and a temporary mailbox. Terminal reads of that API are refused.
Artifact slots require a sealed engine manifest. A copy of browser history or
the presence of files in staging provides neither a source nor an absence proof.
See [active history](../../system/contracts/active-history.md) and
[output settlement](../../system/contracts/outputs-settlement.md).

Metadata migration 040 preserves a verified Docker OOM reason through
source-free finalisation. It uses the bound exit observation and leaves existing
receipts unchanged. Metric recovery remains a separate step.

## Proposed contract

- Retain one versioned checkpoint for the latest complete metric prefix and
  its optional target prefix. Use fixed, bounded slots in the attempt's output
  directory, charged to the existing Offer. Write only after complete data
  and index appends. Serialize checkpoint updates, preserve the previous valid
  slot across interrupted writes, and reuse the producer's existing publication
  cadence. Set a minimum interval and cap the worst-case work in qualification.
- A checkpoint binds the expected scope, generation, approved producer epoch
  and metric subset, extent, sequence, file IDs and both digests. Its optional
  target entry additionally binds the approved sampler interval. Agent approval
  comes from the admitted Offer, installed profile and prepared spec. The
  checkpoint cannot choose a path, metric subset, identity or budget.
- Recover once per attempt after verified producer stop, before staging may
  be removed. Normal sealed output takes precedence. Reuse bounded native
  prefix scanning, hashes, namespace checks and actual-close ownership.
  No tail outside a checkpoint contributes a reading. Gaps and unavailable
  observations remain visible. Rejected evidence falls back to the ordinary
  stop result.
- Publish a separate sampled observation record with a digest and its exact
  scope, checkpoint and stop binding. Its size and lifetime are bounded by the
  existing history reply and remaining Offer budgets. Transfer only that
  verified representation. It supplies chart windows and optional target
  samples, without acting as an engine result, threshold verdict or release
  witness. An engine summary, pooled latency and report must have their own
  valid evidence. Sampled windows cannot reconstruct whole-run figures.
- Completion and physical slot release keep their existing authority.
  The backend's receipt covers the evidence bytes exactly once, with a
  mutually exclusive decision for accepted evidence or absence. Cleanup and
  refund wait for this decision, subject to a bound. Unknown outcomes reread
  the same receipt. A missing or expired checkpoint must leave ordinary
  finalisation available. Normal release, absence and deletion cannot race
  a reader that still owns native file handles.

## Implementation order

1. Done. Preserve source-free OOM classification from the bound exit observation.
   Test a racing user cancellation, missing exit evidence and rejection before
   launch. Compare precedence with sealed finalisation.
2. Done. The k6 wrapper uses a bounded, rotating codec with a reserved 8 KiB
   peak extent and a 5 s cadence. It syncs complete archive prefixes on one
   advisory work slot, fences shutdown, and leaves the previous slot readable
   after an interrupted write. The wire and normal result formats stay unchanged.
3. Done. Agent schema 28 records optional observations in the absence transaction
   after the existing native retirement barrier. The single recovery owner drains
   actual reads, checks the prepared namespace and charges the record to the Offer
   and journal quota. An exact scoped read pairs the record and absence after restart.
4. Add backend adoption, verified reads and deletion accounting. Bind the record
   to the terminal attempt and enforce namespace and read-only restore rules.
   Extend the Results UI to show the available charts and their provenance.
5. Run the exact packaged fault cases on a synthetic installation. Cancel, OOM
   and output-limit stops must keep the authoritative outcome. Test early stop
   before first checkpoint, corrupt or missing tails, mismatched scope, stop
   concurrent with a checkpoint write, restart before receipt and deletion
   during a read. Measure per-run disk and CPU costs. Exercise both skins and
   compare the actual stopped-screen evidence against Penpot.

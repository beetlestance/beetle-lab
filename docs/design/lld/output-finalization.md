# Source-backed output finalization

Status: frozen private contract; implementation and connected qualification pending.
Owner: metadata adapter. Port: `app/src/ports/output-finalization.ts`.
Dependencies: [writer](output-artifact-writer.md),
[transfer](output-transfer-owner.md), [events](event-custody.md).
Migration011 is reserved for this implementation; no schema change is implied yet.

## Transaction and bounded interface

`finalize` captures a closed 4096-byte request containing the exact EventBinding,
source/manifest digests and positive expected Run version. Its reply is at most
4096 bytes. It does no network/file IO, engine execution, deletion or retention.
Expose `Metadata.finalizations` through one bounded ordinary worker operation.
The transaction owns all eligibility reads, receipt insertion, accounting and Run
projection. It uses the existing immediate transaction helper, without nesting.

First resolve the scoped original and point-read an immutable receipt. A matching
receipt returns its original projection even when expectedRunVersion is stale;
a conflicting binding or digest fails. Otherwise require the current active
attempt and expected version. A missing prerequisite returns typed pending;
corrupt/contradictory evidence fails explicitly rather than becoming pending.
No result, manifest, source or native receipt supplied by the caller is trusted.

## Required evidence

1. Resolve the original Offer and acknowledged generation1 physical binding from
   retained execution records. Verify the sole adopted source using the existing
   shared envelope/seal verifier and original engine/installed identity pins.
2. Require execution_charged=0 and a bounded result-free snapshot header with
   admission.state=released and disposition=settled. An exit or CPU release alone
   does not establish this fact. Missing source/execution evidence stays pending.
3. Require exactly the manifest's artifact count, at most128 slots, every slot
   published at declared bytes with full native identity and writer=NULL.
   The transfer owner must have drained the producer/native original before its
   publication metadata write. SQL cannot independently infer native quiescence.
   Zero artifacts are valid only with a verified adopted source.
4. Require contiguous unblocked event custody through exactly finalAgentSeq,
   event_count=durable_through=finalAgentSeq, and no row above that end. Require
   ack_confirmed_through=finalAgentSeq before closing event discovery. This keeps
   lost ACK replies discoverable after restart without a second ACK-debt scanner.
   For finalAgentSeq=0, create a zero cursor inside this transaction if absent.
5. Derive retained C+M+A: C is immutable event charged bytes, M is the sole stored
   canonical manifest's UTF-8 bytes, A is the sum of declared published artifact
   sizes. Source closure/slots/receipt use the existing65536 metadata allowance.
   Require safe integer arithmetic and retained<=original maximum payload P.
6. Read persisted cancellation in this same transaction. No finalization command
   carries cancellation or an outcome override.

## Terminal projection

Wrapper exit evidence describes the engine wrapper; sealed result.execution
describes child k6. Never equate those exit codes or timestamps. In particular,
a failed/discovery child may have a nonzero exit while its successful wrapper
exits0. Preserve the verified sealed outcome rather than treating exit0 as pass.

After all custody/release/event gates, apply this precedence:

- Persisted Run cancellation wins: cancelled/inconclusive/reason cancelled.
- Confirmed wrapper OOM yields errored/inconclusive/reason memory_limit.
- Otherwise missing/null wrapper exitCode or oomKilled stays pending exit_evidence,
  including when the sealed child reports error/lost. A sealed child cannot supply
  missing wrapper evidence. Unavailable-exit recovery closure is separate work.
- A known nonzero wrapper exit yields errored/inconclusive, preserving an explicit
  non-cancellation failure reason, otherwise engine_crash.
- An explicit non-cancellation exit reason prevents ordinary success even at0.
- Wrapper exit0, oomKilled=false, no failure reason and a completed sealed child
  yields finished with the sealed passed/failed/inconclusive outcome and no reason.
- A sealed execution error or lost execution yields errored/inconclusive with its
  validated reason (execution_lost for lost execution).
- Missing/null exit evidence or contradictory cancellation without persisted
  intent stays pending exit_evidence; do not invent successful execution.

Successful insertion increments Run version once and records that exact terminal
projection in the compact receipt. Finished requires validationStatus=passed under
the existing Run invariant: completed engine execution establishes compilation,
independently of required assertion success. For error/cancel projection, completed
sealed execution still establishes passed validation; sealed invalid_config error
establishes failed validation; other incomplete execution leaves it pending.
Never infer validation from assertion totals or mutate the sealed result.
Later cancellation returns the committed terminal Run through existing semantics.

## Native guards and discovery

Add an immutable, replace-protected execution_output_finalizations row per attempt,
bound by scoped foreign keys to the original source/allocation. Store only compact
digests, final sequence, derived retained/refund bytes and terminal projection.
No duplicate result carrier or mutable original allocation is needed.
Guard insertion against mismatched evidence, unsafe credit, duplicate INSERT or
REPLACE and terminal Run conflicts. Its insertion atomically credits P-(C+M+A)
against the same installation_storage_usage counter used by admission, projects
the terminal Run and closes event_pending from1 to0. Retain the full metadata
allowance. Original allocation facts and output_pending=1 remain historical.
Accounting reconstruction must subtract immutable finalization credits.

Allow event_pending1->0 only with the matching committed receipt; never reopen.
Output discovery switches to execution_event_pending and event_pending=1 so
completed history is not rescanned. Retained source/result reads remain available.
After closure, native guards fence new events/cursors, source/slot changes, snapshot
changes and nonmatching terminal Run mutations. A late ACK confirmation may
point-read the finalized exact binding/cursor and return its existing full ACK;
it cannot create a cursor, reopen, change evidence or modify storage credit.
Do not rebuild cyclic foreign keys or backfill historical execution rows.

## Acceptance and remaining closure work

Prove exact scoped replay after commit/reply loss and metadata reopen, one credit,
atomic rollback, stale version versus matching replay, cancellation race, wrapper0
with child nonzero failure/discovery, OOM, unknown exit, zero artifacts/events,
unpublished/incomplete/extra artifact, event gap/end/ACK debt, corrupt source,
safe arithmetic and indexed pending discovery. Native bypass attempts must fail:
replace receipt, refund twice, reopen obligations, append events or revise evidence.
Use actual compiled MetadataWorker and native SQL assertions; source-free/fake
rows cannot substitute for verified source fixtures. No Docker build is required
for this metadata packet.

This contract covers adopted sources. Source-free/rejected/lost execution closure,
agent publication acknowledgement/deletion, physical staging-parent custody and
retention remain required first-release work under separate contracts. Missing
source or publication must never be turned into a fabricated passed terminal run.

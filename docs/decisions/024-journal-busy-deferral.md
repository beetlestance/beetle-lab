# Decision 024: A known journal refusal defers the original launch; it is not a retry

Status: accepted. Recorded on 17 November 2026 from the design the code
implements; the choice predates this record.

## Decision

When the bounded journal worker refuses a large Offer read before issuing it
(`JournalError(queue_full)`), the attempt controller returns
`{kind:'deferred', reason:'journal_busy'}` and keeps one Boolean marking the
caller's explicit launch as still pending. A later tick may complete that same
launch. The launch actor preserves its prior `launchAttempted` value for this one
refusal. Every other failure (unknown commit, binding failure, ambiguous
create/start, cancellation, deadline) keeps the existing permanent retirement.
After the first successful full Offer read, controller and actor cache only scope,
intent digest, engine identity and the five budget fields, so ordinary ticks do
not reread a 2 MiB Offer.

## Why

Raising the Offer bound to 2 MiB made two concurrent large journal reads the
normal ceiling. A third parallel attempt hitting that ceiling is contention, not a
failed test; failing it would abort legitimate parallel runs. The refusal is known
to have had no effect, so resuming the same request duplicates nothing.

## Alternatives

- Treat the refusal as a launch failure: rejected; parallel runs above two would
  fail for an internal capacity reason.
- A waiter queue or retry timer inside the controller: rejected; it adds hidden
  scheduling and unbounded retained callers, and the installation already ticks.
- Reduce active-engine concurrency to two: rejected; it trades a journal limit for
  a product capacity limit.
- Reset `launchAttempted` to false on any read failure: rejected; an earlier
  unknown launch must stay retired or side effects could repeat.
- Cache the full Offer after the first read: rejected; it retains config and secret
  references in owner state and duplicates journal authority.

## Consequences

Public runner schemas are unchanged. Restart never creates implicit launch intent
for recovered owners. Fresh reservations are still checked every step against the
compact authority. Enforced in `agent/src/controller/launch-contention.ts`,
`agent/src/controller/attempt.ts` and `agent/src/installation/drive.ts`.

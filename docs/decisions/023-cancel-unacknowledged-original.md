# Decision 023: Cancelling an unacknowledged original by fresh refusal

Status: accepted. Recorded on 17 November 2026 from the design the code
implements; the choice predates this record.

## Decision

Backend cancellation is monotonic intent with no expected version. Work that is
provably unsent closes locally as cancelled. Once delivery may have happened, the
delivery runtime never re-PUTs a cancelled original: on a scoped
`attempt_not_found` for an unacknowledged original it sends `cancelOriginal` with
the exact Offer. The agent journal stores the Offer, the cancellation and, only
when it inserted the receipt, an immutable refusal marker projecting admission
`rejected`/`cancelled`. A later identical PUT returns that cancelled receipt.

## Why

After possible delivery the backend cannot know whether the agent received the
Offer. It must neither start the test nor release the charge on a guess, and the
agent must remember the refusal so a delayed PUT cannot revive the run.

## Alternatives

- Optimistic version on cancel: rejected. Frequent phase updates would race
  cancellation into repeated retries; intent only ever moves one way.
- PUT the original and then cancel it: rejected. It launches a test the user has
  already cancelled and spends staging and engine resources.
- Treat a missing receipt or generic 404 as absence and release: rejected. A lost
  reply or an older agent's unknown route does not prove nothing ran.
- Keep the charge until an operator intervenes: rejected. It strands capacity
  for every cancel that races delivery.

## Consequences

The marker lives as long as the original receipt. If PUT won first, execution may
exist and stays charged until matched release. Older agents that reject the route
leave the attempt uncertain and charged; there is no PUT fallback.

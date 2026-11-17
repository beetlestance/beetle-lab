# Decision 026: Live metric freshness is measured once and carried as a monotonic budget

Status: accepted. Recorded on 17 November 2026 from the design the code
implements; the choice predates this record.

## Decision

Only the agent compares a live frame's UTC timestamps with a wall clock. It
derives a remaining freshness budget (at most 6000 ms) from its own monotonic clock
and returns it as `X-Beetle-Live-Fresh-For-Ms`. The backend adapter subtracts the
whole request lifetime on its own monotonic clock and keeps a process-local expiry
that never crosses HTTP; the application rechecks it after the final authority read.
The public snapshot schema is unchanged.

## Why

The agent, backend and browser run on different hosts or VMs whose wall clocks can
drift. Comparing source timestamps on each hop would either reject fresh data or
let stale data live longer than six seconds. A monotonic budget passed forward can
only shrink.

## Alternatives

- Compare timestamps on every hop's wall clock: rejected. Clock offset between
  services can invalidate fresh frames or extend stale ones.
- Trust frame age without a monotonic expiry: rejected. Repeated reads of an
  unchanged revision under a frozen wall clock would renew a stale frame.

## Consequences

A missing, malformed or exhausted budget fails closed as unavailable. Each hop
must use one process monotonic clock for its subtraction.

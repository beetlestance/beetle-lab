---
title: Troubleshooting
description: What to do when a run waits, errors, ends inconclusive, or an automation call reports an unknown outcome.
sidebar:
  order: 2
---

## A run stays queued

The agent admits a run only when its whole budget fits. The run page shows the
current reason. Common ones:

- **Not enough capacity.** Another run, or an export job, holds the CPU, memory,
  processes or output space. Runs keep their reservation until their output is
  settled, so a finishing run can still block a new one for a moment.
- **Waiting for isolation.** An isolated run starts only when nothing else is
  running. Choose the parallel policy if isolation does not matter for this test.
- **The machine is too small for the budget you want.** Budgets must fit your
  settings and the installed pool; to allow larger runs,
  [change capacity](/guides/change-capacity/).

If starting a run is refused outright, the queue limit was reached. Wait for
queued work to finish.

## A run errored with `invalid_config`

Saving checks only the structure of a suite. The engine validates the full
configuration when it admits the run. Open the run's diagnostics for the reason,
fix the suite, which creates a new revision, and start a new run.

## A run ended inconclusive

The evidence could not decide pass or fail. Typical causes:

- A `ramp-until` scenario reached its maximum load without its stop rule firing.
  Raise the maximum or tighten the rule.
- Part of the result or metrics is missing. Check the warnings and diagnostics.

An inconclusive run is not a failure of your service; it is a test that needs
changing.

## Numbers look wrong

- Check the warnings first. Insufficient VUs or high metric cardinality can
  distort a measurement without failing any rule.
- If the run was parallel, other runs may have competed for the machine. Repeat
  it with the isolated policy.
- A value shown as unknown was not collected. It is never zero.

## Cancel did not stop the run at once

Cancel is recorded immediately, then the engine is asked to stop and given 5 s
before it is forced. The run turns `cancelled` only after the engine exits and its
output is safe. If the run was already finishing, it ends with its real outcome.

## The automation client says `outcome_unknown`

The reply to a `run` or `cancel` was lost, so the client cannot tell whether the
change happened. Run the same request file again, with the same `requestId`. The
server returns the original receipt instead of acting twice. A new ID could start
a second run. See [Automate from CI](/guides/automation/).

## The UI says read-only

You are looking at a restored history viewer. It can show runs and results but
cannot start runs or change anything. See
[Back up and restore history](/guides/backup-and-restore/).

import { validateApi } from '@beetle/contracts/api';
import type { Run } from '@beetle/contracts/api';
import type { CancelRunCommand } from '../../../ports/runs.js';
import { sameScope, sameUuid } from '../../../domain/namespaces/index.js';
import { boundedCopy } from './input-values.js';
import { StorageError } from './protocol.js';

/** Bind both receipt replay and worker replies to the captured scoped command. */
export function captureCancelRunReply(input: unknown, command: CancelRunCommand): Run {
  const checked = validateApi('Run', boundedCopy(input, 65536));
  if (!checked.ok) throw new StorageError('unavailable');
  const run = checked.value;
  const terminal = ['finished', 'cancelled', 'errored'].includes(run.state);
  if (!sameScope(run.scope, command.request.scope) || !sameUuid(run.id, command.id)
    || !consistent(run) || (!terminal && !run.cancellationRequested)) throw new StorageError('unavailable');
  return run;
}

function consistent(run: Run): boolean {
  switch (run.state) {
    case 'finished': return run.outcome !== 'pending' && run.validationStatus === 'passed' && run.reason === null;
    case 'cancelled': return run.outcome === 'inconclusive' && run.cancellationRequested && run.reason === 'cancelled';
    case 'errored': return run.outcome === 'inconclusive' && run.reason !== null;
    default: return run.outcome === 'pending';
  }
}

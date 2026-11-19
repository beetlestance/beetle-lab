import { encodeCanonicalJson } from '@beetle/contracts';
import type { Run } from '@beetle/contracts/api';
import type { OutputFinalizationRequest } from '../../ports/output-finalization.js';
import type { OutputRuntimeOptions } from '../../ports/output-runtime.js';
import { remoteValue } from './absence.js';
import { finalizationValue, requireValue } from './validation.js';

/** Read the optional companion only after the metadata owner confirms the exact final stream and output custody. */
export async function finalizeWithSourceHistory(
  options: OutputRuntimeOptions,
  original: OutputFinalizationRequest,
  run: Run,
  signal: AbortSignal,
): Promise<'refresh' | 'done'> {
  const { binding, sourceDigest, manifestDigest } = original;
  const { organizationId, workspaceId, attemptId, generation } = binding.key.attempt;
  const attempt = { organizationId, workspaceId, attemptId, generation };
  const client = options.gateway.output({ ...binding.key.attempt, journalAuthority: binding.journalAuthority });
  const read = client.stoppedDeliveryHistory;
  const request: OutputFinalizationRequest = read ? { ...original, stoppedHistory: 'fetch' } : original;
  const first = finalizationValue(await options.finalizations.finalize(request), request, run);
  if (first !== 'history') return first;
  if (signal.aborted) return 'done';
  requireValue(typeof read === 'function');
  const reply = await read.call(client, signal);
  if (signal.aborted) return 'done';
  const { delivery, observation } = remoteValue(reply);
  const { receipt } = delivery;
  requireValue(
    receipt.sourceDigest === sourceDigest &&
      receipt.manifestDigest === manifestDigest &&
      receipt.journalAuthority === binding.journalAuthority &&
      encodeCanonicalJson(receipt.key, 640) === encodeCanonicalJson(attempt, 640),
  );
  const captured = { ...original, stoppedHistory: { finalAgentSeq: delivery.finalAgentSeq, observation } };
  const result = finalizationValue(await options.finalizations.finalize(captured), captured, run);
  requireValue(result !== 'history');
  return result;
}

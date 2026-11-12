import { encodeCanonicalJson } from '@beetle/contracts';
import type { AttemptAdmission } from '@beetle/contracts';
import { requireRule } from '../namespaces/index.js';

/** The branch order is independent of event sequence and receipt time. */
export function mergeAdmission(previous: AttemptAdmission | undefined,
  incoming: AttemptAdmission | undefined): AttemptAdmission | undefined {
  if (previous === undefined) return incoming;
  if (incoming === undefined) return previous;
  if (encodeCanonicalJson(previous, 1024) === encodeCanonicalJson(incoming, 1024)) return previous;
  if (previous.state === 'rejected' || incoming.state === 'rejected') {
    requireRule(previous.state === 'queued' || incoming.state === 'queued');
    return previous.state === 'rejected' ? previous : incoming;
  }
  requireRule(previous.state !== incoming.state);
  const rank = { queued: 0, charged: 1, released: 2 } as const;
  return rank[previous.state] > rank[incoming.state] ? previous : incoming;
}

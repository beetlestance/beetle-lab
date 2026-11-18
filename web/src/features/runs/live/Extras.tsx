import type { Run } from '@beetle/contracts/api';
import { Banner } from '../../../components/Banner.js';
import { useSessionAccess } from '../../../app/session.js';
import { useAttribution } from './data.js';
import type { PlanRequest } from './plan.js';
import { dateTime, ms, span } from './format.js';

/** Read-only banner for a browser session opened on a restored backup. */
export function RestoredBanner() {
  const session = useSessionAccess();
  const createdAt = session.restoredBackup?.createdAt ?? null;
  if (!session.readOnly) return null;
  return (
    <Banner tone="history" live={false} title="Restored history">
      {createdAt ? (
        <>
          Read-only view of the restored backup from <time dateTime={createdAt}>{dateTime(createdAt)}</time>.
        </>
      ) : (
        'Read-only view of restored history.'
      )}{' '}
      Runs cannot be started or cancelled here.
    </Banner>
  );
}

export { ScriptPicker } from './ScriptPicker.js';

/**
 * "p95 rose for about 30 s, mostly GET /content" from getRunLatencyAttribution.
 * Read once the run is terminal; any reason (pending, no rise, too few windows…)
 * leaves the line out. `rN` maps to the revision's request in order.
 */
export function LatencyRise({ run, requests }: { run: Run; requests: readonly PlanRequest[] }) {
  const terminal = ['finished', 'cancelled', 'errored'].includes(run.state);
  const query = useAttribution(run, terminal);
  const rise = query.data?.reason === null ? query.data.rise : null;
  if (!rise) return null;
  const endpoint = rise.endpoint ? requests.find((request) => request.label === rise.endpoint!.request) : undefined;
  const length = span(rise.endTimeMs - rise.startTimeMs);
  return (
    <p className="live-rise">
      p95 rose for about {length}, from {ms(rise.baselineP95Ms)} to {ms(rise.peakP95Ms)}
      {endpoint ? `, mostly ${endpoint.method} ${endpoint.path}` : ''}.
    </p>
  );
}

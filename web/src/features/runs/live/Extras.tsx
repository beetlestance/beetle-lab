import type { Run } from '@beetle/contracts/api';
import { Button } from '../../../components/Button.js';
import { Banner } from '../../../components/Banner.js';
import { useSessionAccess } from '../../../app/session.js';
import { risePosition } from './rise-position.js';
import type { RiseOrigin } from './rise-position.js';
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
export function LatencyRise({
  run,
  requests,
  explain = false,
  origin,
}: {
  run: Run;
  requests: readonly PlanRequest[];
  explain?: boolean;
  origin?: RiseOrigin | undefined;
}) {
  const terminal = ['finished', 'cancelled', 'errored'].includes(run.state);
  const query = useAttribution(run, terminal);
  if (!terminal && explain)
    return <p className="result-muted">Latency-rise analysis is unavailable for an unfinished run.</p>;
  const rise = query.data?.reason === null ? query.data.rise : null;
  if (query.isError || !rise) return <RiseUnavailable query={query} explain={explain} />;
  return (
    <RiseLine
      rise={rise}
      requests={requests}
      position={explain ? risePosition(rise.startTimeMs, query.data!, origin) : null}
    />
  );
}
type AttributionQuery = ReturnType<typeof useAttribution>;
type Rise = NonNullable<NonNullable<AttributionQuery['data']>['rise']>;
function RiseUnavailable({ query, explain }: { query: AttributionQuery; explain: boolean }) {
  if (!explain) return null;
  if (query.isError)
    return (
      <p role="alert">
        Latency observations could not be loaded.{' '}
        <Button
          size="sm"
          variant="text"
          disabled={query.isFetching}
          onClick={() => void query.refetch({ cancelRefetch: false })}
        >
          Retry latency observations
        </Button>
      </p>
    );
  return (
    <p className="result-muted">
      {query.isPending
        ? 'Loading latency observations…'
        : query.data?.reason === 'no_rise'
          ? 'No sustained latency rise was detected in the retained windows.'
          : 'A latency-rise observation is unavailable for the retained source.'}
    </p>
  );
}
function RiseLine({
  rise,
  requests,
  position,
}: {
  rise: Rise;
  requests: readonly PlanRequest[];
  position: string | null;
}) {
  const endpoint = rise.endpoint ? requests.find((request) => request.label === rise.endpoint!.request) : undefined;
  const length = span(rise.endTimeMs - rise.startTimeMs);
  return (
    <p className="live-rise">
      {position && (
        <>
          <span className="number">{position}</span>:{' '}
        </>
      )}
      p95 rose for about {length}, from {ms(rise.baselineP95Ms)} to {ms(rise.peakP95Ms)}
      {endpoint ? `, mostly ${endpoint.method} ${endpoint.path}` : ''}.
    </p>
  );
}

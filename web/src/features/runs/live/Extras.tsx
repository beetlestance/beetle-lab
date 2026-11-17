import { Link } from 'react-router-dom';
import type { Run, Suite } from '@beetle/contracts/api';
import { routes } from '../../../app/routes.js';
import { Badge } from '../../../components/Badge.js';
import { Banner } from '../../../components/Banner.js';
import { Dialog } from '../../../components/Dialog.js';
import { useSessionAccess } from '../../../app/session.js';
import { useAttribution, useRevisions } from './data.js';
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

/** Saved revisions of the suite, with "This run" and "Latest"; each links to its script view. */
export function ScriptPicker({ run, suite, onClose }: { run: Run; suite: Suite | undefined; onClose: () => void }) {
  const query = useRevisions(run, true);
  const items = [...(query.data?.items ?? [])].sort((a, b) => b.ordinal - a.ordinal);
  const { organizationId, workspaceId } = run.scope;
  return (
    <Dialog title="Script versions" description="Open the k6 script for any saved revision." onClose={onClose}>
      {query.isPending && <p role="status">Loading revisions…</p>}
      {query.isError && <p role="alert">Revisions could not be loaded.</p>}
      {items.length > 0 && (
        <ul className="live-picker">
          {items.map((revision) => (
            <li key={revision.id}>
              <Link
                to={routes.suiteScript(organizationId, workspaceId, run.suiteId, revision.id)}
                onClick={onClose}
                aria-current={revision.id === run.revisionId ? 'true' : undefined}
              >
                <span className="live-picker-title">
                  Revision {revision.ordinal}
                  {revision.id === run.revisionId && <Badge tone="amber">This run</Badge>}
                  {revision.id === suite?.currentRevisionId && <Badge>Latest</Badge>}
                </span>
                <span className="live-muted">
                  {[
                    revision.savedAt ? dateTime(revision.savedAt) : null,
                    revision.message ?? null,
                    revision.runCount === undefined
                      ? null
                      : `${revision.runCount} ${revision.runCount === 1 ? 'run' : 'runs'}`,
                    revision.savedBy ? `by ${revision.savedBy}` : null,
                    `digest ${revision.digest.slice(0, 12)}`,
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
      {query.data?.nextCursor && <p className="live-note">Showing the 20 most recent revisions on this page.</p>}
    </Dialog>
  );
}

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

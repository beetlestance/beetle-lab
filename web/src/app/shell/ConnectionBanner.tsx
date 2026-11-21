import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { QueryClient } from '@tanstack/react-query';
import { Banner } from '../../components/Banner.js';
import { Button } from '../../components/Button.js';
import { isConnectionFailure } from '../errors.js';

const clock = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });

/** Time of the newest data on screen, or null when nothing has loaded yet. */
function newestData(client: QueryClient): number | null {
  const times = client
    .getQueryCache()
    .getAll()
    .map((query) => query.state.dataUpdatedAt)
    .filter((time) => time > 0);
  return times.length ? Math.max(...times) : null;
}

/**
 * Follows every read: the first one that cannot reach Beetle raises the banner, and the
 * next successful read clears it. Pages keep showing the data they already have.
 */
export function useConnection() {
  const client = useQueryClient();
  const [since, setSince] = useState<number | null | undefined>(undefined);
  useEffect(
    () =>
      client.getQueryCache().subscribe((event) => {
        if (event.type !== 'updated') return;
        if (event.action.type === 'error' && isConnectionFailure(event.action.error))
          setSince((current) => (current === undefined ? newestData(client) : current));
        if (event.action.type === 'success') setSince(undefined);
      }),
    [client],
  );
  const retry = () => client.refetchQueries({ type: 'active' });
  return { lost: since !== undefined, since: since ?? null, retry };
}

/** "State / Connection lost": names the address Beetle is served from and how old the page is. */
export function ConnectionBanner() {
  const { lost, since, retry } = useConnection();
  const [trying, setTrying] = useState(false);
  if (!lost) return null;
  const origin = window.location.origin;
  return (
    <Banner
      tone="warning"
      className="connection-banner"
      title={`Lost connection to Beetle at ${origin}`}
      actions={
        <Button
          size="sm"
          disabled={trying}
          onClick={() => {
            setTrying(true);
            void retry().finally(() => setTrying(false));
          }}
        >
          {trying ? 'Trying…' : 'Try now'}
        </Button>
      }
    >
      {since === null
        ? 'Nothing has loaded yet. Check that Beetle Lab is running.'
        : `What you see is from ${clock.format(new Date(since))}.`}
    </Banner>
  );
}

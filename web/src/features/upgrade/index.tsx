import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { UpgradeStatus } from '@beetle/contracts/api';
import { readResult, useApi } from '../../app/api.js';
import { queryKeys } from '../../app/queries.js';
import { Banner } from '../../components/Banner.js';
import { Button } from '../../components/Button.js';
import { Dialog } from '../../components/Dialog.js';
import { QueryState } from '../../components/QueryState.js';
import { LoadingState } from '../../components/States.js';
import { backupText, command, hostCommands, releaseText, unfinishedText } from './model.js';
import './upgrade.css';

/** One read per visit; leaving the screen cancels and forgets it. No polling. */
function useUpgradeStatus() {
  const api = useApi();
  const client = useQueryClient();
  const query = useQuery({
    queryKey: queryKeys.upgradeStatus,
    queryFn: ({ signal }) => readResult(api.getUpgradeStatus({ signal })),
  });
  useEffect(
    () => () => {
      void client.cancelQueries({ queryKey: queryKeys.upgradeStatus, exact: true });
      client.removeQueries({ queryKey: queryKeys.upgradeStatus, exact: true });
    },
    [client],
  );
  return query;
}

/** Settings › Installation › Upgrade: what runs now, the pause, unfinished work and the host steps. */
export function Upgrade() {
  const query = useUpgradeStatus();
  return (
    <QueryState query={query} loading={<LoadingState label="Reading upgrade status…" variant="cards" rows={3} />}>
      {(status) => <UpgradeView status={status} refresh={() => void query.refetch()} />}
    </QueryState>
  );
}

function UpgradeView({ status, refresh }: { status: UpgradeStatus; refresh: () => void }) {
  const [checking, setChecking] = useState(false);
  const unfinished = unfinishedText(status.unfinished);
  return (
    <div className="upgrade">
      <div className="upgrade-version">
        <p>
          <strong>{releaseText(status)}</strong> · metadata schema {status.release.metadataSchema}
        </p>
        <Button size="sm" onClick={() => setChecking(true)}>
          Check for upgrade…
        </Button>
      </div>
      {status.phase === 'fenced' ? (
        <Banner tone="warning" live={false} title="Paused for upgrade" actions={<Button size="sm" onClick={refresh}>Refresh</Button>}>
          The host has swapped in the next release. Reading and cancelling work; new work waits. Activate or roll back on
          the host to lift the pause.
        </Banner>
      ) : (
        <p className="upgrade-phase">No upgrade is in progress.</p>
      )}
      <dl className="upgrade-facts">
        <dt>Path</dt>
        <dd>One release at a time. Skipping a release is refused; upgrade through each one in turn.</dd>
        <dt>Unfinished work</dt>
        <dd>{unfinished ? `${unfinished}. Prepare waits for it to finish.` : 'None. The installation can drain now.'}</dd>
        <dt>Backup</dt>
        <dd>{backupText(status.backup)}</dd>
      </dl>
      <h2 className="settings-subhead">On the host</h2>
      <ul className="upgrade-steps" aria-label="Upgrade commands">
        {hostCommands.map(({ step, what }) => (
          <li key={step}>
            <code>{command(step)}</code>
            <span>{what}</span>
          </li>
        ))}
      </ul>
      {checking && <CheckDialog close={() => setChecking(false)} />}
    </div>
  );
}

/** Beetle never looks for releases online; the check explains how to get the next one. */
function CheckDialog({ close }: { close: () => void }) {
  return (
    <Dialog
      title="Check for upgrade"
      onClose={close}
      actions={
        <Button variant="primary" onClick={close}>
          Close
        </Button>
      }
    >
      <p>Beetle Lab does not contact the internet, so it cannot look for new releases itself.</p>
      <p>
        Get the next release's bundle from wherever you installed this one, then run <code>{command('prepare')}</code>{' '}
        on the host. Prepare refuses a bundle that is not the next release.
      </p>
    </Dialog>
  );
}

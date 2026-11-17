import { useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import type { InstallationSettings, InstallationStatus } from '@beetle/contracts/api';
import { readResult, useApi } from '../../app/api.js';
import { queryKeys } from '../../app/queries.js';
import { routes } from '../../app/routes.js';
import { Badge, Status } from '../../components/Badge.js';
import { Banner } from '../../components/Banner.js';
import { buttonClass } from '../../components/Button.js';
import { QueryState } from '../../components/QueryState.js';
import { LoadingState } from '../../components/States.js';
import { agentText, agentUnavailable, formatTime, useInstallationStatus } from './status.js';
import './engines.css';

/**
 * Engines (Penpot "Engines" and "Engines / Unavailable"). Installed engines are the
 * installation's supported profiles; image facts and agent state come from the
 * installation status read. Nothing is listed that the API does not report.
 */
export function Engines() {
  const settings = useInstallationSettings();
  const status = useInstallationStatus();
  return (
    <section className="content-section engines-page">
      <header className="engines-header">
        <h1>Engines</h1>
        <p>Engines run your suites. Each one is a container image the agent starts for every run.</p>
      </header>
      {status.data && <AgentBanner status={status.data} />}
      <QueryState query={settings} loading={<LoadingState label="Loading engines…" variant="cards" rows={2} />}>
        {(data) => <InstalledEngines settings={data} status={status.data} statusFailed={status.isError} />}
      </QueryState>
    </section>
  );
}

function useInstallationSettings() {
  const api = useApi();
  const client = useQueryClient();
  const key = queryKeys.installationSettings;
  const query = useQuery({
    queryKey: key,
    queryFn: ({ signal }) => readResult(api.getInstallationSettings({ signal })),
  });
  useEffect(
    () => () => {
      void client.cancelQueries({ queryKey: key, exact: true });
      client.removeQueries({ queryKey: key, exact: true });
    },
    [client, key],
  );
  return query;
}

function AgentBanner({ status }: { status: InstallationStatus }) {
  const { state, lastSeenAt } = status.agent;
  if (!agentUnavailable(state) && state !== 'disabled') return null;
  const seen = formatTime(lastSeenAt);
  return (
    <Banner
      tone={state === 'disabled' ? 'neutral' : 'warning'}
      title={`Engine agent: ${agentText[state].label.toLowerCase()}`}
      actions={
        <Link className={buttonClass('secondary', 'sm')} to={routes.settings}>
          Open installation status
        </Link>
      }
    >
      <p>
        {agentText[state].detail}
        {seen && ` Last seen ${seen}.`}
      </p>
    </Banner>
  );
}

function InstalledEngines({
  settings,
  status,
  statusFailed,
}: {
  settings: InstallationSettings;
  status: InstallationStatus | undefined;
  statusFailed: boolean;
}) {
  const profiles = settings.values.supportedProfiles;
  const defaultProfile = settings.values.runDefaults.engineProfile;
  const unavailable = status ? agentUnavailable(status.agent.state) : false;
  return (
    <section aria-labelledby="engines-installed">
      <h2 id="engines-installed">Installed · {profiles.length}</h2>
      {statusFailed && <p className="muted">Image and agent status could not be read. Profiles are still listed.</p>}
      <ul className="engine-cards">
        {profiles.map((profile) => {
          const image = status?.engines.find((engine) => engine.profileId === profile);
          return (
            <li key={profile} className="engine-card">
              <div className="engine-card-head">
                <h3>{profile}</h3>
                {profile === defaultProfile && <Badge tone="strong">Default for new runs</Badge>}
              </div>
              <Status tone={unavailable ? 'fail' : 'pass'}>{unavailable ? 'Unavailable' : 'Installed'}</Status>
              {image && (
                <dl className="engine-facts">
                  <dt>Image</dt>
                  <dd className="mono" title={image.imageDigest}>
                    {image.imageDigest.slice(0, 19)}…
                  </dd>
                  <dt>Checked</dt>
                  <dd>
                    {image.image === 'verified_at_agent_start' ? 'Verified when the agent started' : 'Not verified'}
                  </dd>
                </dl>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

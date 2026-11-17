import { useEffect } from 'react';
import type { ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import type { InstallationSettings, InstallationStatus } from '@beetle/contracts/api';
import { readResult, useApi } from '../../app/api.js';
import { queryKeys } from '../../app/queries.js';
import { routes } from '../../app/routes.js';
import { Badge, Status } from '../../components/Badge.js';
import { buttonClass } from '../../components/Button.js';
import { QueryState } from '../../components/QueryState.js';
import { LoadingState } from '../../components/States.js';
import { EngineFacts, PlannedEngines } from './planned.js';
import { agentUnavailable, unavailableText, useInstallationStatus } from './status.js';
import './engines.css';

/**
 * Engines (Penpot "Engines" and "Engines / Unavailable"). Installed engines are the
 * installation's supported profiles; image facts and agent state come from the
 * installation status read. Planned engines are labelled product copy.
 */
export function Engines() {
  const settings = useInstallationSettings();
  const status = useInstallationStatus();
  return (
    <section className="content-section engines-page">
      <header className="engines-header">
        <h1>Engines</h1>
        <p>
          An engine is what actually runs a suite. k6 is installed today. The others are planned, and they plug into the
          same suites, revisions, runs, comparison, retention and inputs, so a lint check and a load test sit in one
          history.
        </p>
      </header>
      <section aria-labelledby="engines-installed" className="engines-section">
        <h2 id="engines-installed">Installed</h2>
        <QueryState query={settings} loading={<LoadingState label="Loading engines…" variant="cards" rows={1} />}>
          {(data) => <InstalledEngines settings={data} status={status.data} statusFailed={status.isError} />}
        </QueryState>
      </section>
      <PlannedEngines />
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

const k6Facts = {
  runs: 'HTTP traffic against a running service, at the rate the suite plans.',
  passOrFail: 'Latency, failure-rate and check thresholds.',
  resultShows: 'Live metrics, a whole-run chart, endpoints, target samples.',
};

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
  const k6 = profiles.filter((profile) => /^k6([._-]|$)/.test(profile));
  const others = profiles.filter((profile) => !k6.includes(profile));
  const unavailable = status ? agentUnavailable(status.agent.state) : false;
  return (
    <>
      <ul className="engine-cards engine-cards-installed">
        {k6.length > 0 && (
          <EngineCard title="k6 load tests" unavailable={unavailable}>
            <EngineFacts {...k6Facts} />
            <Profiles profiles={k6} settings={settings} status={status} />
          </EngineCard>
        )}
        {others.map((profile) => (
          <EngineCard key={profile} title={profile} unavailable={unavailable}>
            <Profiles profiles={[profile]} settings={settings} status={status} />
          </EngineCard>
        ))}
      </ul>
      {status && (unavailable || status.agent.state === 'disabled') && <UnavailableNotice status={status} />}
      {statusFailed && <p className="engines-note">Agent and image status could not be read.</p>}
    </>
  );
}

function EngineCard({ title, unavailable, children }: { title: string; unavailable: boolean; children: ReactNode }) {
  return (
    <li className={unavailable ? 'engine-card engine-card-unavailable' : 'engine-card'}>
      <div className="engine-card-head">
        <h3>{title}</h3>
        <Status tone={unavailable ? 'running' : 'pass'}>{unavailable ? 'Unavailable' : 'Installed'}</Status>
      </div>
      {children}
    </li>
  );
}

/** Profile names with the image facts the agent reported at start; unreported images stay unlabelled. */
function Profiles({
  profiles,
  settings,
  status,
}: {
  profiles: readonly string[];
  settings: InstallationSettings;
  status: InstallationStatus | undefined;
}) {
  return (
    <ul className="engine-profiles" aria-label="Profiles">
      {profiles.map((profile) => {
        const image = status?.engines.find((engine) => engine.profileId === profile);
        return (
          <li key={profile}>
            <span className="mono">{profile}</span>
            {profile === settings.values.runDefaults.engineProfile && <Badge>Default</Badge>}
            {image && (
              <span className="engine-image" title={image.imageDigest}>
                {image.imageDigest.slice(7, 19)} ·{' '}
                {image.image === 'verified_at_agent_start'
                  ? 'image verified when the agent started'
                  : 'image not verified'}
              </span>
            )}
          </li>
        );
      })}
    </ul>
  );
}

function UnavailableNotice({ status }: { status: InstallationStatus }) {
  return (
    <div className="engine-unavailable" role="status">
      <p>{unavailableText(status)}</p>
      <Link className={buttonClass('secondary', 'sm')} to={routes.settings}>
        Installation status
      </Link>
    </div>
  );
}

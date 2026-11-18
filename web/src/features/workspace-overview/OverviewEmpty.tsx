import { Link } from 'react-router-dom';
import { routes } from '../../app/routes.js';
import { buttonClass } from '../../components/Button.js';
import readyArt from '../../assets/illustrations/ready.svg';
import { gibibytes } from './format.js';
import { useInstallationStatus } from './reads.js';

/** Capacity is the configured run pool minus reservations, never host-free memory. */
function AvailableCapacity() {
  const query = useInstallationStatus();
  if (query.isPending) return <p className="overview-empty-note">Checking agent capacity…</p>;
  if (query.isError || query.data.agent.state !== 'ready')
    return <p className="overview-empty-note">Agent capacity is unavailable. Check Engines before starting a run.</p>;
  const pool = query.data.pool;
  if (pool.poolCpuMillis === null || pool.poolMemoryBytes === null)
    return <p className="overview-empty-note">The agent is ready. Available run capacity is unknown.</p>;
  const cpus = Math.max(0, pool.poolCpuMillis - pool.reservedCpuMillis) / 1000;
  const memory = gibibytes(Math.max(0, pool.poolMemoryBytes - pool.reservedMemoryBytes));
  return (
    <p className="overview-empty-note">
      The agent is ready: {cpus} CPUs and {memory} GiB free for runs.
    </p>
  );
}

export function OverviewEmpty({
  organizationId,
  workspaceId,
  workspaceName,
}: {
  organizationId: string;
  workspaceId: string;
  workspaceName: string;
}) {
  return (
    <section className="overview-empty">
      <div className="overview-empty-text">
        <h1>No runs in {workspaceName} yet</h1>
        <p className="overview-empty-lede">
          Write a suite, then start a run. Its live numbers appear on the run screen, and every finished run lands in
          Runs so you can compare it with the next one.
        </p>
        <div className="overview-empty-actions">
          <Link className={buttonClass('primary')} to={routes.newSuite(organizationId, workspaceId, 'form')}>
            Write your first suite
          </Link>
        </div>
        <AvailableCapacity />
      </div>
      <img className="overview-empty-art" src={readyArt} width="560" height="392" alt="" />
    </section>
  );
}

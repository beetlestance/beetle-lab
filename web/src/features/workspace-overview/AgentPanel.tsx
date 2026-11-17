import { useId } from 'react';
import type { InstallationStatus, StatusQuantity } from '@beetle/contracts/api';
import { Button } from '../../components/Button.js';
import { gibibytes } from './format.js';
import { useInstallationStatus } from './reads.js';

type Agent = InstallationStatus['agent'];

function agentLine(agent: Agent): string {
  switch (agent.state) {
    case 'ready':
      return 'Ready.';
    case 'stale':
      return 'Last report is out of date; the agent may have stopped.';
    case 'unavailable':
      return 'The agent reports it cannot run engines.';
    case 'unreachable':
      return 'The agent is not responding.';
    case 'disabled':
      return 'The local agent is turned off for this installation.';
    case 'unknown':
      return 'Agent status is unknown.';
  }
}

function measured(value: StatusQuantity): number | null {
  return value.status === 'measured' ? value.value : null;
}

interface Gauge {
  label: string;
  text: string;
  share: number | null;
}

/** Used of total, or what is known. Unmeasured values say so; nothing is estimated. */
export function gauges(status: InstallationStatus): Gauge[] {
  const cores = measured(status.host.cpuCores);
  const usedMillis = measured(status.host.cpuUsedMillis);
  const memoryTotal = measured(status.host.memoryTotalBytes);
  const memoryFree = measured(status.host.memoryAvailableBytes);
  const diskTotal = measured(status.disk.backendTotalBytes);
  const diskFree = measured(status.disk.backendFreeBytes);
  const cpu: Gauge =
    cores === null
      ? { label: 'CPU', text: 'Not measured', share: null }
      : usedMillis === null
        ? { label: 'CPU', text: `${cores} CPUs, use not measured`, share: null }
        : {
            label: 'CPU',
            text: `${Math.round((usedMillis / (cores * 1000)) * 100)}% of ${cores} CPUs`,
            share: usedMillis / (cores * 1000),
          };
  return [cpu, usedOf('Memory', memoryTotal, memoryFree), usedOf('Disk for artifacts', diskTotal, diskFree)];
}

function usedOf(label: string, total: number | null, free: number | null): Gauge {
  if (total === null || total === 0) return { label, text: 'Not measured', share: null };
  if (free === null) return { label, text: `${gibibytes(total)} GiB, use not measured`, share: null };
  const used = Math.max(0, total - free);
  return { label, text: `${gibibytes(used)} of ${gibibytes(total)} GiB`, share: used / total };
}

/** "Local agent": reachability, engine images and host gauges from the installation status read. */
export function AgentPanel() {
  const heading = useId();
  const query = useInstallationStatus();
  return (
    <section className="overview-agent" aria-labelledby={heading}>
      <h2 id={heading}>Local agent</h2>
      {query.isPending && <p className="overview-muted">Checking the agent…</p>}
      {query.isError && (
        <div className="overview-agent-error">
          <p className="overview-muted">Agent status unavailable; host figures are unknown.</p>
          <Button size="sm" disabled={query.isFetching} onClick={() => void query.refetch({ cancelRefetch: false })}>
            Retry agent status
          </Button>
        </div>
      )}
      {query.data && !query.isError && <AgentFacts status={query.data} />}
    </section>
  );
}

function AgentFacts({ status }: { status: InstallationStatus }) {
  const images = status.engines.map(
    (engine) =>
      `${engine.profileId} engine image ${engine.image === 'verified_at_agent_start' ? 'verified at agent start' : 'not verified'}`,
  );
  return (
    <>
      <p className="overview-muted">
        {agentLine(status.agent)}
        {images.length > 0 && ` ${images.join('; ')}.`}
      </p>
      <dl className="overview-gauges">
        {gauges(status).map((gauge) => (
          <div key={gauge.label}>
            <dt>{gauge.label}</dt>
            <dd>
              {gauge.text}
              {gauge.share !== null && (
                <span className="overview-gauge" aria-hidden="true">
                  <span style={{ width: `${Math.min(100, Math.max(0, gauge.share * 100))}%` }} />
                </span>
              )}
            </dd>
          </div>
        ))}
      </dl>
    </>
  );
}

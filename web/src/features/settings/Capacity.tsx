import type { ComponentProps } from 'react';
import type { InstallationStatus } from '@beetle/contracts/api';
import { useInstallationStatus } from '../engines/status.js';
import type { RowFacts } from './model.js';
import { installationRows } from './model.js';
import type { Installation } from './patch.js';
import { SettingRow } from './Row.js';

/** Settings / Installation / Capacity: the shared pool, per-run ceilings and what the host reports. */
export function Capacity({
  data,
  rowProps,
}: {
  data: Installation;
  rowProps: (row: RowFacts) => ComponentProps<typeof SettingRow>;
}) {
  const rows = installationRows(data);
  const status = useInstallationStatus();
  return (
    <>
      <ul className="setting-rows" aria-label="Shared capacity">
        {rows.pool.map((row) => (
          <SettingRow key={row.id} {...rowProps(row)} />
        ))}
      </ul>
      <h2 className="settings-subhead">Per-run ceilings</h2>
      <ul className="setting-rows" aria-label="Per-run ceilings">
        {rows.ceilings.map((row) => (
          <SettingRow key={row.id} {...rowProps(row)} />
        ))}
      </ul>
      <p className="settings-host">
        {status.data
          ? hostText(status.data)
          : status.isError
            ? 'What the host reports could not be read.'
            : 'Reading what the host reports…'}
      </p>
    </>
  );
}

const gb = (bytes: number) => `${Math.round(bytes / 1_000_000_000).toLocaleString()} GB`;

/** "Host reports 10 CPUs, 32 GB memory and 412 GB free disk."; unmeasured facts are left out. */
export function hostText(status: InstallationStatus): string {
  const facts = [
    status.host.cpuCores.status === 'measured' ? `${status.host.cpuCores.value} CPUs` : '',
    status.host.memoryTotalBytes.status === 'measured' ? `${gb(status.host.memoryTotalBytes.value)} memory` : '',
    status.disk.backendFreeBytes.status === 'measured' ? `${gb(status.disk.backendFreeBytes.value)} free disk` : '',
  ].filter(Boolean);
  if (facts.length === 0) return 'The host has not reported its CPUs, memory or free disk.';
  const list = facts.length === 1 ? facts[0] : `${facts.slice(0, -1).join(', ')} and ${facts.at(-1)}`;
  return `Host reports ${list}.`;
}

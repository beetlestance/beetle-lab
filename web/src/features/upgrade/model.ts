import type { UpgradeStatus } from '@beetle/contracts/api';

export const hostCommands = [
  { step: 'prepare', what: 'Checks the next release, drains work, backs up and swaps images. Sets the pause.' },
  { step: 'status', what: 'Shows the host-side phase and each step.' },
  { step: 'activate', what: 'Lifts the pause on the new release.' },
  { step: 'rollback', what: 'Restores the backup and the previous release.' },
] as const;
export const command = (step: string) => `docker compose run --rm setup upgrade ${step}`;

/** "Beetle 2.1.0" or "Beetle (development build)" when the image carries no release name. */
export function releaseText(status: UpgradeStatus): string {
  return status.release.name ? `Beetle ${status.release.name}` : 'Beetle (development build)';
}

const plural = (count: number, one: string, many: string) => `${count.toLocaleString()} ${count === 1 ? one : many}`;
/** "1 run and 2 removals still finishing", or null when the installation has drained. */
export function unfinishedText(work: UpgradeStatus['unfinished']): string | null {
  const parts = [
    work.runs ? plural(work.runs, 'run', 'runs') : '',
    work.exports ? plural(work.exports, 'export', 'exports') : '',
    work.uploads ? plural(work.uploads, 'upload', 'uploads') : '',
    work.removals ? plural(work.removals, 'removal', 'removals') : '',
  ].filter(Boolean);
  if (parts.length === 0) return null;
  const list = parts.length === 1 ? parts[0] : `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}`;
  return `${list} still finishing`;
}

const GB = 1_000_000_000;
const size = (bytes: number) =>
  bytes >= GB ? `${(bytes / GB).toFixed(1)} GB` : `${Math.ceil(bytes / 1_000_000).toLocaleString()} MB`;
/** Backup size against the space the host reports free; never claims it fits when free space is unknown. */
export function backupText(backup: UpgradeStatus['backup']): string {
  const need = `The backup copies the data folder: at least ${size(backup.atLeastBytes)}`;
  if (backup.freeBytes.status !== 'measured') return `${need}. Free disk space has not been reported.`;
  const free = backup.freeBytes.value;
  if (free < backup.atLeastBytes) return `${need}, but only ${size(free)} is free. Free space before you prepare.`;
  return `${need}; ${size(free)} is free.`;
}

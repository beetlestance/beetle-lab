import type { InputRecord } from '@beetle/contracts/api';
import type { StatusTone } from '../../components/Badge.js';

const units = ['bytes', 'KB', 'MB', 'GB', 'TB'] as const;

/** Decimal byte size for display, as on the boards ("9.0 MB"); exact bytes stay in details. */
export function formatBytes(bytes: number): string {
  if (bytes < 1000) return `${bytes} ${bytes === 1 ? 'byte' : 'bytes'}`;
  let value = bytes;
  let unit = 0;
  while (value >= 1000 && unit < units.length - 1) {
    value /= 1000;
    unit++;
  }
  return `${value.toFixed(1)} ${units[unit]}`;
}

/** Short local date ("12 Nov 2026"); null stays absent so legacy rows show nothing. */
export function formatDate(value: string | null | undefined): string | undefined {
  if (!value) return undefined;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return undefined;
  return date.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

export function percent(record: Pick<InputRecord, 'offset' | 'bytes'>): number {
  if (record.bytes === 0) return 100;
  return Math.floor((record.offset / record.bytes) * 100);
}

/** Listed lifecycle state as a status label and tone; the label carries the meaning. */
export function inputStatus(record: InputRecord): { tone: StatusTone; label: string } {
  switch (record.state) {
    case 'published':
      return { tone: 'pass', label: 'Ready' };
    case 'staging':
      return { tone: 'neutral', label: `Stopped at ${percent(record)}%` };
    case 'publishing':
      return { tone: 'running', label: 'Publishing' };
    case 'deleting':
      return { tone: 'info', label: 'Deleting' };
    case 'deleted':
      return { tone: 'skipped', label: 'Deleted' };
    case 'failed':
      return { tone: 'fail', label: 'Failed' };
  }
}

/** File extension in upper case ("CSV"); the API has no content-kind field. */
export function extension(name: string): string | undefined {
  const match = /\.([A-Za-z0-9]{1,8})$/.exec(name);
  return match ? match[1]!.toUpperCase() : undefined;
}

/** "CSV · 1,200 rows · 4 columns"; unmeasured counts are omitted, never shown as zero. */
export function shapeText(record: InputRecord): string {
  const parts: string[] = [];
  const kind = extension(record.name);
  if (kind) parts.push(kind);
  if (typeof record.rowCount === 'number') parts.push(plural(record.rowCount, 'row'));
  if (typeof record.columnCount === 'number') parts.push(plural(record.columnCount, 'column'));
  return parts.join(' · ');
}

export function plural(count: number, noun: string): string {
  return `${count.toLocaleString('en-US')} ${noun}${count === 1 ? '' : 's'}`;
}

/** Added date: publication once ready, otherwise creation. */
export function addedDate(record: InputRecord): string | undefined {
  return formatDate(record.publishedAt ?? record.createdAt);
}

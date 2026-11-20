import type { Budget, RetentionPolicy, SettingsScope } from '@beetle/contracts/api';
import type { SettingsData } from './intents.js';
import type { NumericCopy, Unit } from './units.js';
import {
  budgetCopy,
  budgetOrder,
  ceilingCopy,
  displayUnit,
  fromUnit,
  poolCopy,
  poolOrder,
  rangeText,
  toUnit,
  units,
} from './units.js';

/** One unsaved change: a typed value, or "inherit instead" (scoped levels only). */
export type DraftValue = { kind: 'set'; text: string } | { kind: 'inherit' };
export type Draft = Readonly<Record<string, DraftValue>>;

/** What a row shows before any draft is applied. */
export interface RowFacts {
  id: string;
  label: string;
  help: string;
  unit?: Unit | undefined;
  text: string;
  /** "Set here", "Inherited from installation", "Installation only". */
  origin: string;
  setHere: boolean;
  canInherit: boolean;
  options?: readonly string[] | undefined;
  note?: string | undefined;
}

type Parsed = { ok: true; value: unknown } | { ok: false; error: string };

const scopeName: Record<SettingsScope['kind'], string> = {
  installation: 'installation',
  organization: 'organization',
  workspace: 'workspace',
};

function origin(data: SettingsData, source: SettingsScope): { origin: string; setHere: boolean } {
  const setHere = source.kind === data.scope.kind;
  return { origin: setHere ? 'Set here' : `Inherited from ${scopeName[source.kind]}`, setHere };
}

function numeric(id: string, copy: NumericCopy, base: number, data: SettingsData, source: SettingsScope): RowFacts {
  const scoped = data.scope.kind !== 'installation';
  const where = origin(data, source);
  const unit = displayUnit(base, copy.unit);
  return { id, ...copy, unit, text: toUnit(base, unit), ...where, canInherit: scoped && where.setHere };
}

export function budgetRows(data: SettingsData): RowFacts[] {
  const leaves = data.effective.runDefaults.budget;
  return budgetOrder.map((key) =>
    numeric(`budget.${key}`, budgetCopy[key], leaves[key].value, data, leaves[key].source),
  );
}

export function profileRow(data: SettingsData): RowFacts {
  const leaf = data.effective.runDefaults.engineProfile;
  const where = origin(data, leaf.source);
  return {
    id: 'engineProfile',
    label: 'Engine for new runs',
    help: 'An installed engine profile. Choosing one does not install an image.',
    text: leaf.value,
    options: leaf.allowedValues,
    ...where,
    canInherit: data.scope.kind !== 'installation' && where.setHere,
  };
}

const otherRules = (policy: RetentionPolicy) =>
  policy.mode === 'enabled'
    ? [
        policy.completedRunCount ? `keeps at most ${policy.completedRunCount.toLocaleString()} finished runs` : '',
        policy.storageBytes ? `keeps at most ${bytesText(policy.storageBytes)} of results` : '',
      ].filter(Boolean)
    : [];

export function retentionRow(data: SettingsData): RowFacts {
  const leaf = data.effective.retention;
  const where = origin(data, leaf.source);
  const policy = leaf.value;
  const rest = otherRules(policy);
  return {
    id: 'retention.ageDays',
    label: 'Remove finished runs older than',
    help: 'Off unless set. Pinned and unfinished runs are never removed, and nothing goes until you preview and apply.',
    unit: units.days,
    text: policy.mode === 'enabled' && policy.ageDays ? String(policy.ageDays) : 'Off',
    ...where,
    canInherit: data.scope.kind !== 'installation' && where.setHere,
    note: rest.length > 0 ? `This policy also ${rest.join(' and ')}.` : undefined,
  };
}

export function installationRows(data: Extract<SettingsData, { values: unknown }>) {
  const here = { origin: 'Set here', setHere: true, canInherit: false };
  const pool = poolOrder.map((key) => fixedRow(`pool.${key}`, poolCopy[key], data.values.pool[key], here));
  const ceilings = budgetOrder.map((key) =>
    fixedRow(`ceiling.${key}`, ceilingCopy[key], data.values.perRunCeilings[key], here),
  );
  const admin: RowFacts = {
    id: 'administratorName',
    label: 'Administrator name',
    help: 'Shown as “saved by” on revisions, settings changes and run notes.',
    text: data.values.administratorName ?? '',
    ...(data.values.administratorName ? here : { ...here, origin: 'Not set; shown as Administrator' }),
  };
  return { pool, ceilings, admin };
}

function fixedRow(
  id: string,
  copy: NumericCopy,
  base: number,
  here: Pick<RowFacts, 'origin' | 'setHere' | 'canInherit'>,
) {
  const unit = displayUnit(base, copy.unit);
  return { id, ...copy, unit, text: toUnit(base, unit), ...here };
}
function bytesText(base: number): string {
  const unit = displayUnit(base, units.gigabytes);
  return `${toUnit(base, unit)} ${unit.label}`;
}

function numericRange(data: SettingsData, id: string): [number, number] {
  const [group, key] = id.split('.') as [string, string];
  if (group === 'budget') {
    const range = data.effective.runDefaults.budget[key as keyof Budget].allowedRange;
    return [range.minimum, range.maximum];
  }
  if (group === 'retention') return [1, 365_000];
  return [key === 'freeSpaceReserveBytes' ? 0 : 1, Number.MAX_SAFE_INTEGER];
}

/** Parses one draft value into its patch leaf, or a field error in the row's own words. */
export function parseRow(data: SettingsData, row: RowFacts, value: DraftValue): Parsed {
  if (value.kind === 'inherit') return { ok: true, value: null };
  const text = value.text.trim();
  if (row.options) return row.options.includes(text) ? { ok: true, value: text } : { ok: false, error: 'Choose one.' };
  if (row.id === 'administratorName') return parseName(text);
  if (row.id === 'retention.ageDays') return parseRetentionDays(data, text);
  const unit = row.unit!;
  const [minimum, maximum] = numericRange(data, row.id);
  const base = fromUnit(text, unit);
  if (base === undefined || base < minimum || base > maximum)
    return { ok: false, error: rangeText(minimum, maximum, unit) };
  return { ok: true, value: base };
}

function parseRetentionDays(data: SettingsData, text: string): Parsed {
  const current = data.effective.retention.value;
  const rest =
    current.mode === 'enabled'
      ? {
          ...(current.completedRunCount ? { completedRunCount: current.completedRunCount } : {}),
          ...(current.storageBytes ? { storageBytes: current.storageBytes } : {}),
        }
      : {};
  if (text === '' || text.toLowerCase() === 'off')
    return { ok: true, value: Object.keys(rest).length > 0 ? { mode: 'enabled', ...rest } : { mode: 'manual' } };
  const days = fromUnit(text, units.days);
  if (days === undefined || days < 1 || days > 365_000)
    return { ok: false, error: 'Must be from 1 to 365000 days, or Off.' };
  return { ok: true, value: { mode: 'enabled', ...rest, ageDays: days } };
}

function parseName(text: string): Parsed {
  return text.length > 0 && text.length <= 128 && !/\p{Cc}/u.test(text)
    ? { ok: true, value: text }
    : { ok: false, error: 'Enter a name of 1 to 128 characters.' };
}

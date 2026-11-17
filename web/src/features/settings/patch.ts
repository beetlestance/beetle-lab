import type { Budget, InstallationPatch, RetentionPolicy, ScopedOverridePatch } from '@beetle/contracts/api';
import type { SettingsData } from './intents.js';
import type { Draft, RowFacts } from './model.js';
import { budgetRows, installationRows, parseRow, profileRow, retentionRow } from './model.js';

export type Installation = Extract<SettingsData, { values: unknown }>;

/** Every editable row for a settings record, keyed by row id. */
export function allRows(data: SettingsData): Map<string, RowFacts> {
  const rows = [...budgetRows(data), profileRow(data), retentionRow(data)];
  if ('values' in data) {
    const extra = installationRows(data);
    rows.push(extra.admin, ...extra.pool, ...extra.ceilings);
  }
  return new Map(rows.map((row) => [row.id, row]));
}

export interface Built {
  patch: InstallationPatch | ScopedOverridePatch | undefined;
  errors: Readonly<Record<string, string>>;
}

/** Parses the draft into one patch: scoped levels send changed leaves, installation replaces whole groups. */
export function buildPatch(data: SettingsData, draft: Draft): Built {
  const rows = allRows(data);
  const errors: Record<string, string> = {};
  const leaves: Record<string, unknown> = {};
  for (const [id, value] of Object.entries(draft)) {
    const row = rows.get(id);
    if (!row) continue;
    const parsed = parseRow(data, row, value);
    if (parsed.ok) leaves[id] = parsed.value;
    else errors[id] = parsed.error;
  }
  if (Object.keys(errors).length > 0 || Object.keys(leaves).length === 0) return { patch: undefined, errors };
  return { patch: 'values' in data ? installationPatch(data, leaves) : scopedPatch(leaves), errors };
}

function pick(leaves: Record<string, unknown>, group: string): Record<string, unknown> | undefined {
  const entries = Object.entries(leaves)
    .filter(([id]) => id.startsWith(`${group}.`))
    .map(([id, value]) => [id.slice(group.length + 1), value]);
  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
}

function scopedPatch(leaves: Record<string, unknown>): ScopedOverridePatch {
  const budget = pick(leaves, 'budget');
  const runDefaults = {
    ...('engineProfile' in leaves ? { engineProfile: leaves.engineProfile as string | null } : {}),
    ...(budget ? { budget } : {}),
  };
  return {
    ...(Object.keys(runDefaults).length > 0 ? { runDefaults } : {}),
    ...('retention.ageDays' in leaves
      ? { retention: leaves['retention.ageDays'] as ScopedOverridePatch['retention'] }
      : {}),
  } as ScopedOverridePatch;
}

function installationPatch(data: Installation, leaves: Record<string, unknown>): InstallationPatch {
  const values = data.values;
  const budget = pick(leaves, 'budget') as Partial<Budget> | undefined;
  const pool = pick(leaves, 'pool');
  const ceilings = pick(leaves, 'ceiling') as Partial<Budget> | undefined;
  const patch: InstallationPatch = {};
  if (budget || 'engineProfile' in leaves)
    patch.runDefaults = {
      engineProfile: (leaves.engineProfile as string | undefined) ?? values.runDefaults.engineProfile,
      budget: { ...values.runDefaults.budget, ...budget },
    };
  if (pool) patch.pool = { ...values.pool, ...pool };
  if (ceilings) patch.perRunCeilings = { ...values.perRunCeilings, ...ceilings };
  if ('retention.ageDays' in leaves) patch.retention = leaves['retention.ageDays'] as RetentionPolicy;
  if ('administratorName' in leaves) patch.administratorName = leaves.administratorName as string;
  return patch;
}

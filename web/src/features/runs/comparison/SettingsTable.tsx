import type { RunComparisonItem } from '@beetle/contracts/api';
import { Table, Td, Th } from '../../../components/Table.js';
import { formatBytes, formatDuration } from '../../run-results/format.js';
import { comparisonRunLabels } from './run-labels.js';
import { scenarioFact } from './scenario-intent.js';
import type { ComparisonContexts } from './useComparison.js';

/** "What was different": recorded run settings side by side; equal values say same. */
export function WhatWasDifferent({
  items,
  contexts,
}: {
  items: readonly RunComparisonItem[];
  contexts: ComparisonContexts | undefined;
}) {
  const facts: readonly [string, (item: RunComparisonItem) => string][] = [
    [
      'Revision',
      (item) => {
        const context = contexts?.get(item.run.id.toLowerCase());
        return context ? `${context.suiteName} rev ${context.revisionOrdinal}` : 'Revision unknown';
      },
    ],
    ['Configured executor', (item) => scenarioFact(item, 'executor')],
    ['Configured arrivals', (item) => scenarioFact(item, 'arrival')],
    ['Configured VUs', (item) => scenarioFact(item, 'vus')],
    ['Engine profile', (item) => `${item.run.engine.id} / ${item.run.engine.profileId}`],
    ['Memory limit', (item) => formatBytes(item.run.budget.memoryBytes) ?? '—'],
    ['Time limit', (item) => formatDuration(item.run.budget.timeoutMs) ?? '—'],
    ['Execution policy', (item) => item.run.executionPolicy.mode],
    ['Note', (item) => item.run.note ?? 'None'],
  ];
  return (
    <>
      <FactsTable items={items} facts={facts.filter(([label]) => primaryLabels.has(label))} primary />
      <details className="compare-additional">
        <summary>Additional saved settings</summary>
        <p className="compare-muted">Saved intent, not observed traffic, admission or combined concurrency.</p>
        <FactsTable items={items} facts={facts.filter(([label]) => !primaryLabels.has(label))} />
      </details>
    </>
  );
}
const primaryLabels = new Set(['Revision', 'Configured executor', 'Configured arrivals', 'Configured VUs', 'Note']);
const visibleLabels: Record<string, string> = {
  'Configured executor': 'Executor',
  'Configured arrivals': 'Rate',
  'Configured VUs': 'Virtual users',
};
function FactsTable({
  items,
  facts,
  primary = false,
}: {
  items: readonly RunComparisonItem[];
  facts: readonly (readonly [string, (item: RunComparisonItem) => string])[];
  primary?: boolean;
}) {
  const labels = comparisonRunLabels(items.map((item) => item.run.id));
  return (
    <Table
      caption={primary ? 'What was different between the runs' : 'Additional saved settings'}
      className={primary ? 'compare-different compare-intent' : 'compare-different'}
      scrollLabel={primary ? 'Run settings differences' : 'Additional run settings differences'}
      columns={[
        { key: 'fact', label: 'Setting' },
        ...items.map((item) => ({ key: item.run.id, label: labels.get(item.run.id.toLowerCase())! })),
      ]}
    >
      {facts.map(([label, read]) => {
        const base = read(items[0]!);
        return (
          <tr key={label}>
            <Th scope="row" aria-label={label}>
              {visibleLabels[label] ?? label}
            </Th>
            {items.map((item, index) => {
              const value = read(item);
              const same =
                label === 'Revision'
                  ? item.run.revisionId.toLowerCase() === items[0]!.run.revisionId.toLowerCase()
                  : value === base;
              return (
                <Td key={item.run.id} muted={index > 0 && same && label !== 'Note'}>
                  {value}
                </Td>
              );
            })}
          </tr>
        );
      })}
    </Table>
  );
}

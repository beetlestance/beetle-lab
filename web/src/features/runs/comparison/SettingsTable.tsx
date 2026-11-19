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
  const labels = comparisonRunLabels(items.map((item) => item.run.id));
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
    <Table
      caption="What was different between the runs"
      className="compare-different"
      scrollLabel="Run settings differences"
      columns={[
        { key: 'fact', label: 'Setting' },
        ...items.map((item) => ({ key: item.run.id, label: labels.get(item.run.id.toLowerCase())! })),
      ]}
    >
      {facts.map(([label, read]) => {
        const base = read(items[0]!);
        return (
          <tr key={label}>
            <Th scope="row">{label}</Th>
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

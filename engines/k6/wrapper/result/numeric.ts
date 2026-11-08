import type { SummaryEvidence } from '../collection/index.js';

/** A missing native statistic is unknown; registered metrics do not imply zero. */
export function counter(summary: SummaryEvidence | null, key: string): number | null {
  return countStat(summary, key, 'count');
}
export function countStat(summary: SummaryEvidence | null, key: string, stat: string): number | null {
  const value = summary?.metrics[key]?.values[stat];
  if (value === undefined) return null;
  if (!Number.isSafeInteger(value) || value < 0) throw new Error('invalid_input');
  return value;
}
export function sum(left: number, right: number): number {
  const value = left + right;
  if (!Number.isSafeInteger(value)) throw new Error('invalid_input');
  return value;
}
export function verdict(summary: SummaryEvidence | null, key: string, expression: string): boolean | null {
  const matches = summary?.metrics[key]?.thresholds.filter(item => item.expression === expression) ?? [];
  const values = matches.map(item => item.ok);
  if (values.some(value => value !== null && typeof value !== 'boolean')) throw new Error('invalid_input');
  if (values.some(value => value !== values[0])) throw new Error('invalid_input');
  return values[0] ?? null;
}

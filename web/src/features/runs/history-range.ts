import type { RunPage } from '@beetle/contracts/api';

/** The server counted the exact current snapshot on both sides of the cursor. */
export function historyRange(page: RunPage): string | undefined {
  const counts = page.counts;
  if (!counts) return undefined;
  const number = (value: number) => value.toLocaleString('en-US');
  if (page.items.length === 0) return `No runs on this page · ${number(counts.matched)} matching runs`;
  return `Showing ${number(counts.before + 1)} to ${number(counts.before + page.items.length)} of ${number(counts.matched)}`;
}

import { useId } from 'react';
import type { OverviewBucket } from '@beetle/contracts/api';
import { clockTime, plural } from './format.js';

/**
 * "Last 24 hours": one column per hourly bucket, newest on the right. Buckets
 * carry submission counts only, so columns are one colour (no pass/fail split).
 * The same figures are available to assistive tech as a table.
 */
export function ActivityChart({ buckets }: { buckets: readonly OverviewBucket[] }) {
  const heading = useId();
  const max = Math.max(1, ...buckets.map((bucket) => bucket.count));
  const total = buckets.reduce((sum, bucket) => sum + bucket.count, 0);
  const middle = buckets[Math.floor(buckets.length / 2)];
  return (
    <section className="overview-activity" aria-labelledby={heading}>
      <header className="overview-section-head">
        <h2 id={heading}>Last 24 hours</h2>
        <p>One column per hour, newest on the right.</p>
      </header>
      <div className="overview-bars" aria-hidden="true">
        {buckets.map((bucket) => (
          <span
            key={bucket.from}
            className={bucket.count ? 'overview-bar overview-bar-filled' : 'overview-bar'}
            style={bucket.count ? { height: `${Math.max(12, (bucket.count / max) * 100)}%` } : undefined}
            title={`${clockTime(bucket.from)}–${clockTime(bucket.to)}: ${plural(bucket.count, 'run')} submitted`}
          />
        ))}
      </div>
      {buckets[0] && middle && (
        <div className="overview-axis" aria-hidden="true">
          <span>{clockTime(buckets[0].from)}</span>
          <span>{clockTime(middle.from)}</span>
          <span>now</span>
        </div>
      )}
      <table className="sr-only">
        <caption>{plural(total, 'run')} submitted in the last 24 hours, by hour</caption>
        <thead>
          <tr>
            <th scope="col">From</th>
            <th scope="col">To</th>
            <th scope="col">Submitted</th>
          </tr>
        </thead>
        <tbody>
          {buckets.map((bucket) => (
            <tr key={bucket.from}>
              <td>
                <time dateTime={bucket.from}>{clockTime(bucket.from)}</time>
              </td>
              <td>
                <time dateTime={bucket.to}>{clockTime(bucket.to)}</time>
              </td>
              <td>{bucket.count}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

import { useId } from 'react';
import type { OverviewBucket } from '@beetle/contracts/api';
import { clockTime, plural } from './format.js';
const outcomes = ['passed', 'failed', 'inProgress', 'other'] as const;

/** Current outcomes of each hour's submissions; the same exact counts have a text table. */
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
            title={`${clockTime(bucket.from)}–${clockTime(bucket.to)}: ${plural(bucket.count, 'run')} submitted; ${bucket.outcomes.passed} passed, ${bucket.outcomes.failed} failed, ${bucket.outcomes.inProgress} in progress, ${bucket.outcomes.other} other`}
          >
            {outcomes.map(
              (outcome) =>
                bucket.outcomes[outcome] > 0 && (
                  <span
                    key={outcome}
                    className={`overview-bar-${outcome}`}
                    style={{ height: `${(bucket.outcomes[outcome] / bucket.count) * 100}%` }}
                  />
                ),
            )}
          </span>
        ))}
      </div>
      {buckets[0] && middle && (
        <div className="overview-axis" aria-hidden="true">
          <span>{clockTime(buckets[0].from)}</span>
          <span>{clockTime(middle.from)}</span>
          <span>now</span>
        </div>
      )}
      <div className="sr-only">
        <table>
          <caption>{plural(total, 'run')} submitted in the last 24 hours, by hour</caption>
          <thead>
            <tr>
              <th scope="col">From</th>
              <th scope="col">To</th>
              <th scope="col">Submitted</th>
              <th scope="col">Passed</th>
              <th scope="col">Failed</th>
              <th scope="col">In progress</th>
              <th scope="col">Other</th>
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
                <td>{bucket.outcomes.passed}</td>
                <td>{bucket.outcomes.failed}</td>
                <td>{bucket.outcomes.inProgress}</td>
                <td>{bucket.outcomes.other}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

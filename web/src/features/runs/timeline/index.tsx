import { useId } from 'react';
import type { Run } from '@beetle/contracts/api';
import { useTimeline } from './useTimeline.js';
import type { Progress, Timeline } from './projection.js';
function coverage(data: Timeline) {
  if (data.blocked) return `Delivery blocked: ${data.blocked.replaceAll('_', ' ')}.`;
  if (data.coverage === 'pending') return 'Event capture pending; no activity reported yet.';
  if (data.coverage === 'partial') return 'Partial event coverage.';
  return data.backlog ? 'More durable activity remains; reading in bounded intervals.' : 'Caught up with currently durable activity; this does not establish complete capture.';
}
export function ExecutionActivity({ run, terminal }: { run: Run; terminal: boolean }) {
  const heading = useId(); const query = useTimeline(run, terminal); const data = query.data;
  return <section className="execution-activity" aria-labelledby={heading}>
    <header className="section-header"><div><h2 id={heading}>Execution activity</h2>
      <p>Source timestamps correlate observations; they do not measure elapsed time.</p></div>
      <button disabled={query.isFetching} onClick={() => void query.refetch({ cancelRefetch: false })}>Refresh activity</button></header>
    {query.isPending && <p role="status">Loading execution activity…</p>}
    {query.isError && <p role="alert">Activity read failed. Recent activity is retained. Automatic refresh stopped; use Refresh activity to retry.</p>}
    {data && <>
      <p role="status">{coverage(data)}</p>
      {data.retainedStart !== null && <p>Retained activity starts at sequence {data.retainedStart}; earlier coverage has a gap.</p>}
      {data.omitted && <p>Recent history only: earlier activity was omitted to keep this view bounded.</p>}
      <dl className="run-facts">
        <div><dt>Latest useful progress</dt><dd><ProgressFact progress={data.progress} /></dd></div>
        <div><dt>Reported resources</dt><dd>{data.resources ?? 'Not reported'}</dd></div>
      </dl>
      {data.rows.length === 0 ? <p>No activity rows reported.</p> : <ol tabIndex={0} className="activity-rows" aria-label="Recent execution observations">
        {data.rows.map(row => <li key={row.seq}><span className="number">#{row.seq}</span> <time dateTime={row.at}>{row.at}</time>
          <span>{row.phase}</span><span>{row.text}</span></li>)}
      </ol>}
    </>}
  </section>;
}

function ProgressFact({ progress }: { progress: Progress | null }) {
  if (!progress) return <>Not reported</>;
  return <>{progress.phase}: {progress.completed} completed units
    {progress.total > 0 && ` of ${progress.total}`}; last useful observation <time dateTime={progress.usefulAt ?? undefined}>{progress.usefulAt ?? 'not reported'}</time></>;
}

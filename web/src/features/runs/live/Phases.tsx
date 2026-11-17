import { Link } from 'react-router-dom';
import type { Run, RunQueueStatus } from '@beetle/contracts/api';
import { routes } from '../../../app/routes.js';
import { Button } from '../../../components/Button.js';
import type { Row } from '../timeline/projection.js';
import { useTimeline } from '../timeline/useTimeline.js';
import { useQueue } from './data.js';
import { shortId, wallTime } from './format.js';

/** Queued: who holds the run slots and where this run stands (035 getRunQueue). */
export function Waiting({ run }: { run: Run }) {
  const query = useQueue(run, run.state === 'queued');
  const queue = query.data;
  return (
    <section className="live-phase" aria-labelledby="live-phase">
      <h2 id="live-phase">Waiting for capacity</h2>
      {query.isPending && <p role="status">Reading the run queue…</p>}
      {query.isError && (
        <p role="alert">
          The queue could not be read.{' '}
          <Button size="sm" onClick={() => void query.refetch()}>
            Retry
          </Button>
        </p>
      )}
      {queue && <QueueFacts run={run} queue={queue} />}
    </section>
  );
}

function slotsText(queue: RunQueueStatus): string {
  const slots = queue.slots.effective ?? queue.slots.configured;
  const all = queue.slots.used >= slots;
  if (all) {
    const lead = slots === 1 ? 'The run slot is' : slots === 2 ? 'Both run slots are' : `All ${slots} run slots are`;
    return `${lead} busy.`;
  }
  return `${queue.slots.used} of ${slots} run ${slots === 1 ? 'slot' : 'slots'} in use.`;
}

function positionText(queue: RunQueueStatus): string {
  if (queue.waiting === 'agent_admission') return 'Sent to the agent, waiting for it to admit the run.';
  if (queue.waiting === 'not_waiting') return 'No longer waiting.';
  if (queue.position === null) return 'Queued; position not reported.';
  return queue.position === 1 ? 'Queued, first in line.' : `Queued, number ${queue.position} in line.`;
}

function QueueFacts({ run, queue }: { run: Run; queue: RunQueueStatus }) {
  const { organizationId, workspaceId } = run.scope;
  return (
    <>
      <p className="live-lede">
        {slotsText(queue)}
        {queue.holders.length > 0 && (
          <>
            {' '}
            {queue.holders.map((holder, index) => (
              <span key={holder.runId}>
                {index > 0 && (index === queue.holders.length - 1 ? ' and ' : ', ')}
                <Link to={routes.run(organizationId, workspaceId, holder.runId)}>
                  {holder.suiteName ?? `suite ${shortId(holder.suiteId)}`} {shortId(holder.runId)}
                </Link>
              </span>
            ))}{' '}
            {queue.holders.length === 1 ? 'holds one.' : 'hold them.'}
          </>
        )}
        {queue.otherWorkspaceRuns > 0 &&
          ` ${queue.otherWorkspaceRuns} more ${queue.otherWorkspaceRuns === 1 ? 'run' : 'runs'} from other workspaces.`}
      </p>
      <p role="status">{positionText(queue)}</p>
      {queue.slots.exports > 0 && (
        <p className="live-note">
          {queue.slots.exports} of the busy slots {queue.slots.exports === 1 ? 'is' : 'are'} script exports.
        </p>
      )}
    </>
  );
}

interface Step {
  label: string;
  at: string | null;
  done: boolean;
}

function firstAt(rows: readonly Row[], kind: Row['kind']): string | null {
  return rows.find((row) => row.kind === kind)?.at ?? null;
}

/** Dispatching or active before the first live window: the start-up steps reported so far. */
export function Starting({ run }: { run: Run }) {
  const timeline = useTimeline(run, false);
  const rows = timeline.data?.rows ?? [];
  const admitted = firstAt(rows, 'admitted');
  const started = firstAt(rows, 'runtime.started');
  const steps: Step[] = [
    { label: 'Accepted', at: run.requestedAt, done: true },
    { label: 'Admitted by the agent', at: admitted, done: admitted !== null || run.state === 'active' },
    { label: `Starting ${run.engine.id} (${run.engine.profileId})`, at: started, done: started !== null },
    { label: 'First metrics', at: null, done: false },
  ];
  return (
    <section className="live-phase" aria-labelledby="live-phase">
      <h2 id="live-phase">Starting</h2>
      <Steps steps={steps} />
      {timeline.isError && <p className="live-note">Start-up events could not be read; the steps may lag.</p>}
    </section>
  );
}

/** Finalizing: the sealing events reported so far; only rows that exist are shown. */
export function Finalizing({ run }: { run: Run }) {
  const timeline = useTimeline(run, false);
  const rows = timeline.data?.rows ?? [];
  const sealed = rows.filter((row) => row.kind === 'artifact.sealed');
  const exited = firstAt(rows, 'runtime.exited');
  const result = firstAt(rows, 'engine.result');
  const steps: Step[] = [
    ...(exited ? [{ label: 'Load generator stopped', at: exited, done: true }] : []),
    ...(result ? [{ label: 'Engine report written', at: result, done: true }] : []),
    ...(sealed.length
      ? [
          {
            label: `${sealed.length} ${sealed.length === 1 ? 'file' : 'files'} sealed`,
            at: sealed.at(-1)!.at,
            done: true,
          },
        ]
      : []),
  ];
  return (
    <section className="live-phase" aria-labelledby="live-phase">
      <h2 id="live-phase">Sealing results</h2>
      {steps.length ? <Steps steps={steps} /> : <p role="status">Waiting for the first sealing event…</p>}
    </section>
  );
}

function Steps({ steps }: { steps: readonly Step[] }) {
  return (
    <ol className="live-steps">
      {steps.map((step) => (
        <li key={step.label} className={step.done ? 'is-done' : 'is-pending'}>
          <span aria-hidden="true">{step.done ? '✓' : '◌'}</span> {step.label}
          {step.done ? '' : ' (not yet)'}
          {step.at && (
            <time className="live-muted" dateTime={step.at}>
              {' '}
              {wallTime(step.at)}
            </time>
          )}
        </li>
      ))}
    </ol>
  );
}

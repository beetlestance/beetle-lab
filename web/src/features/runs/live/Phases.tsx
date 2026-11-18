import { Link } from 'react-router-dom';
import type { ReactNode } from 'react';
import type { Run, RunQueueStatus, SuiteRevision } from '@beetle/contracts/api';
import { routes } from '../../../app/routes.js';
import { Button } from '../../../components/Button.js';
import type { Row } from '../timeline/projection.js';
import { useTimeline } from '../timeline/useTimeline.js';
import type { QueueRead } from './data.js';
import { shortId, wallTime } from './format.js';

/** Queued: who holds the run slots and where this run stands (035 getRunQueue). */
export function Waiting({ run, revision, query }: { run: Run; revision: SuiteRevision | undefined; query: QueueRead }) {
  const queue = query.isError ? undefined : query.data;
  return (
    <section className="live-phase live-early-phase" aria-labelledby="live-phase">
      <h2 id="live-phase" className="sr-only">
        Waiting for capacity
      </h2>
      {query.isPending && <p role="status">Reading the run queue…</p>}
      {query.isError && (
        <p role="alert">
          The queue could not be read.{' '}
          <Button size="sm" disabled={query.isFetching} onClick={() => void query.refetch({ cancelRefetch: false })}>
            Retry
          </Button>
        </p>
      )}
      {queue && <QueueFacts run={run} queue={queue} revision={revision} />}
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

function QueueFacts({
  run,
  queue,
  revision,
}: {
  run: Run;
  queue: RunQueueStatus;
  revision: SuiteRevision | undefined;
}) {
  const { organizationId, workspaceId } = run.scope;
  return (
    <>
      <Steps
        showTimes={false}
        steps={[
          {
            label:
              revision?.preflightStatus === 'passed'
                ? `Checked revision ${revision.ordinal} against the ${run.engine.id} schema`
                : 'Saved revision validation is not available yet',
            at: null,
            done: revision?.preflightStatus === 'passed',
          },
          { label: positionText(queue), at: null, done: queue.position !== null },
          {
            label: (
              <span>
                Waiting for a run slot.
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
              </span>
            ),
            at: null,
            done: false,
          },
          { label: `The agent accepts it and starts ${run.engine.id}`, at: null, done: false },
        ]}
      />
      {queue.slots.exports > 0 && (
        <p className="live-note">
          {queue.slots.exports} of the busy slots {queue.slots.exports === 1 ? 'is' : 'are'} script exports.
        </p>
      )}
    </>
  );
}

interface Step {
  label: ReactNode;
  at: string | null;
  done: boolean;
}

function firstAt(rows: readonly Row[], kind: Row['kind']): string | null {
  return rows.find((row) => row.kind === kind)?.at ?? null;
}

/** Dispatching or active before the first live window: the start-up steps reported so far. */
export function Starting({ run, revision }: { run: Run; revision: SuiteRevision | undefined }) {
  const timeline = useTimeline(run, false);
  const rows = timeline.data?.rows ?? [];
  const admitted = firstAt(rows, 'admitted');
  const started = firstAt(rows, 'runtime.started');
  const compiled =
    rows.find((row) => row.kind === 'phase.started' && (row.phase === 'prepare' || row.phase === 'execute'))?.at ??
    null;
  const steps: Step[] = [
    { label: 'Accepted by the agent', at: admitted, done: admitted !== null || run.state === 'active' },
    {
      label: revision
        ? `Compiled revision ${revision.ordinal} to a ${run.engine.id} plan`
        : 'Compiling the saved revision',
      at: compiled,
      done: compiled !== null,
    },
    { label: `Starting ${run.engine.id} in its own container`, at: started, done: started !== null },
    { label: 'First metrics arrive', at: null, done: false },
  ];
  return (
    <section className="live-phase live-early-phase" aria-labelledby="live-phase">
      <h2 id="live-phase" className="sr-only">
        Starting
      </h2>
      <Steps steps={steps} showTimes={false} />
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

function Steps({ steps, showTimes = true }: { steps: readonly Step[]; showTimes?: boolean }) {
  const pending = steps.findIndex((step) => !step.done);
  return (
    <ol className="live-steps">
      {steps.map((step, index) => (
        <li
          key={index}
          aria-current={index === pending ? 'step' : undefined}
          className={step.done ? 'is-done' : 'is-pending' + (index === pending ? ' is-current' : '')}
        >
          <span aria-hidden="true">{step.done ? '✓' : '○'}</span>
          <span className="sr-only">{step.done ? 'Completed: ' : 'Pending: '}</span>
          <span className="live-step-label">{step.label}</span>
          {showTimes && step.at && (
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

export function queueSentence(queue: RunQueueStatus | undefined): string {
  if (!queue) return 'Reading capacity and queue position…';
  if (queue.waiting === 'not_waiting') return 'No longer queued; refreshing the run state.';
  if (queue.waiting === 'agent_admission') return 'Sent to the agent and waiting for admission.';
  if (queue.slots.used < (queue.slots.effective ?? queue.slots.configured))
    return `${slotsText(queue)} This run is queued until its execution budget is available.`;
  return `${slotsText(queue).replace(/\.$/, '')}, so this run is queued and starts by itself when one frees up. Nothing has been sent to the target yet.`;
}

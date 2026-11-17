import { Link } from 'react-router-dom';
import type { RetentionBatchStatus, RetentionPreview, RetentionStatusItem } from '@beetle/contracts/api';
import { Banner } from '../../components/Banner.js';
import { buttonClass } from '../../components/Button.js';
import { Table, Td } from '../../components/Table.js';
import { routes } from '../../app/routes.js';
import { bytes, clock, itemProblem, runs, shortId, stages } from './format.js';
import type { Stage } from './format.js';

/**
 * Settings / Workspace / Retention progress. Counts and credit come only from the
 * status read; the preview supplies per-run size estimates for blocked runs.
 */
export function Progress({ value, preview }: { value: RetentionBatchStatus; preview: RetentionPreview }) {
  const total = value.items.length;
  const done = value.state === 'completed';
  return (
    <section className="retention-progress" aria-label="Deletion progress">
      <header className="retention-intro">
        <h3>{done ? `Removed ${runs(total)}` : `Removing ${runs(total)}`}</h3>
        <p>
          {done && value.completedAt
            ? `Finished at ${clock(value.completedAt)}, from the ${clock(value.capturedAt)} preview.`
            : `Applied from the ${clock(value.capturedAt)} preview. You can leave this page; removal carries on and this page shows where it stands.`}
        </p>
      </header>
      <DriverAvailability state={value.driverState} done={done} />
      <div className="retention-meter">
        <p>
          <strong>
            {value.completedCount} of {total} removed
          </strong>
          <span className="retention-muted">
            {bytes(value.refundedLogicalBytes)} of about {bytes(value.estimatedLogicalBytes)} returned to the storage
            budget
          </span>
        </p>
        <progress aria-label="Runs removed" max={Math.max(total, 1)} value={Math.min(value.completedCount, total)} />
      </div>
      {value.state === 'applied' && (
        <p className="retention-note">Waiting for authoritative cleanup and settlement confirmation.</p>
      )}
      <StageTable items={value.items} />
      <Problems value={value} preview={preview} />
    </section>
  );
}

const stageColumns = [
  { key: 'stage', label: 'Stage' },
  { key: 'runs', label: 'Runs', numeric: true },
  { key: 'meaning', label: 'What it means' },
] as const;

function StageTable({ items }: { items: readonly RetentionStatusItem[] }) {
  const rows = stages
    .map((stage) => ({ stage, count: items.filter((item) => stage.phases.includes(item.phase)).length }))
    .filter((row) => row.stage.always || row.count > 0);
  return (
    <Table caption="Removal stages" columns={stageColumns} className="retention-table">
      {rows.map(({ stage, count }) => {
        const tone = stageTone(stage.phases, count);
        return (
          <tr key={stage.label}>
            <Td className={tone}>{stage.label}</Td>
            <Td numeric className={tone === 'retention-stage-fail' ? tone : undefined}>
              {count}
            </Td>
            <Td>{stage.meaning}</Td>
          </tr>
        );
      })}
    </Table>
  );
}

function stageTone(phases: Stage['phases'], count: number): string | undefined {
  if (phases.includes('settled')) return 'retention-stage-pass';
  return phases.includes('blocked') && count > 0 ? 'retention-stage-fail' : undefined;
}

function Problems({ value, preview }: { value: RetentionBatchStatus; preview: RetentionPreview }) {
  const problems = value.items.filter((item) => item.phase === 'blocked');
  if (problems.length === 0) return null;
  return (
    <>
      {problems.map((item) => {
        const estimate = preview.candidates.find((candidate) => candidate.id === item.runId)?.estimatedBytes;
        const path = routes.run(value.scope.organizationId, value.scope.workspaceId, item.runId);
        return (
          <Banner
            key={item.deletionId}
            tone="danger"
            title={`Run ${shortId(item.runId)} is blocked`}
            actions={
              <Link className={buttonClass('secondary', 'sm')} to={path}>
                Open run {shortId(item.runId)}
              </Link>
            }
          >
            {itemProblem(item)} The run stays listed and{' '}
            {estimate === undefined ? 'it' : `its estimated ${bytes(estimate)}`} still counts toward storage until
            cleanup succeeds.
          </Banner>
        );
      })}
    </>
  );
}

function DriverAvailability({ state, done }: { state: RetentionBatchStatus['driverState']; done: boolean }) {
  if (done) return null;
  const messages = {
    running: null,
    stopped: 'Automatic cleanup is stopped. Pending deletion and its storage charges remain protected.',
    disabled: 'Automatic cleanup is not configured. Accepted deletion waits for an installed cleanup driver.',
    unknown: 'Automatic cleanup availability is unknown. No completion or reclaimed space is assumed.',
  };
  const message = messages[state];
  return message ? <Banner tone="warning">{message}</Banner> : null;
}

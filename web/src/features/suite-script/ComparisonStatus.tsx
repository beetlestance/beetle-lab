import { Button, buttonClass } from '../../components/Button.js';
import { LoadingState } from '../../components/States.js';
import { routes } from '../../app/routes.js';
import type { SuiteRevision } from '@beetle/contracts/api';
import type { Comparison, ScriptSide } from './comparison-model.js';

function SourceNeed({ ordinal, side }: { ordinal: number; side: ScriptSide }) {
  return (
    <p className="script-note">
      Revision {ordinal}: {side.job ? `latest export is ${side.job.state}.` : 'no script export is recorded.'}
    </p>
  );
}

/** Missing scripts stay missing; preparing one always requires an explicit operator action. */
export function ComparisonStatus({
  comparison,
  revision,
  openCurrent,
}: {
  comparison: Comparison;
  revision: SuiteRevision;
  openCurrent(): void;
}) {
  const { status, other } = comparison;
  if (status === 'only')
    return <p className="script-note">This is the only revision, so there is nothing to compare.</p>;
  if (status === 'loading') return <LoadingState label="Reading comparison scripts…" />;
  if (status === 'error')
    return (
      <div role="alert" className="script-comparison-status">
        <p className="field-error">Could not read and verify the comparison scripts.</p>
        <Button disabled={comparison.refreshing} onClick={comparison.retry}>
          Retry comparison
        </Button>
      </div>
    );
  if (status === 'too_large')
    return (
      <div className="script-comparison-status">
        <p className="script-note">
          These scripts are too large to compare here. Each source must fit 1 MiB; the comparison is limited to 4,096
          combined lines and 4 million cells. Copy or export the complete scripts instead.
        </p>
        <Button onClick={openCurrent}>View this revision’s export</Button>
      </div>
    );
  const otherHref = other
    ? routes.suiteScript(other.scope.organizationId, other.scope.workspaceId, other.suiteId, other.id)
    : undefined;
  return (
    <div className="script-comparison-status">
      <p className="script-note">
        {status === 'preparing'
          ? 'Waiting for the exported scripts to be ready.'
          : 'Both revisions need a verified exported script before their JavaScript can be compared.'}
      </p>
      <SourceNeed ordinal={revision.ordinal} side={comparison.current} />
      {other && <SourceNeed ordinal={other.ordinal} side={comparison.compared} />}
      <div className="script-actions">
        <Button onClick={openCurrent}>View this revision’s export</Button>
        {otherHref && (
          <a className={buttonClass('secondary')} href={otherHref} target="_blank" rel="noopener noreferrer">
            Open revision {other!.ordinal} to prepare its script
          </a>
        )}
        <Button disabled={comparison.refreshing} onClick={comparison.retry}>
          Check again
        </Button>
      </div>
    </div>
  );
}

import type { Run } from '@beetle/contracts/api';
/** Display label captured at admission; never a claim of authenticated person identity. */
export function RunRequester({ run }: { run: Pick<Run, 'requestedBy'> }) {
  return (
    <span title="Configured administrator display name when this run was requested">
      {run.requestedBy ? `by ${run.requestedBy}` : 'requester not recorded'}
    </span>
  );
}

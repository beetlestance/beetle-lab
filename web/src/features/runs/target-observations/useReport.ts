import { useApi } from '../../../app/api.js';
import { useArtifactReport } from '../../../lib/use-artifact-report.js';
import { targetReportReads } from './read.js';
import type { TargetRead, TargetReportReads } from './read.js';
export function useTargetReport(selection: Omit<TargetRead, 'signal'>, reads: Pick<TargetReportReads, 'read'> = targetReportReads) {
  const {state, retry} = useArtifactReport(selection, reads, useApi());
  return {state: state.status === 'ready' ? {...state, report: state.value} : state, retry};
}

import { useId } from 'react';
import { artifactDownload } from '@beetle/contracts';
import { runArtifactContentPath } from '@beetle/contracts/api';
import { useApi } from '../../../app/api.js';
import { useArtifactReport } from '../../../lib/use-artifact-report.js';
import type { ArtifactReader } from '../../../lib/use-artifact-report.js';
import type { ArtifactRead } from '../../../lib/verified-artifact.js';
import { performanceReportReads } from './read.js';

export function RunPerformanceReport({params, artifact, reads = performanceReportReads}: Omit<ArtifactRead, 'signal'> & {reads?: ArtifactReader<string>}) {
  const heading = useId(); const {state, retry} = useArtifactReport({params, artifact}, reads, useApi());
  return <section className="performance-report" aria-labelledby={heading}>
    <header className="section-header"><h2 id={heading}>Performance report</h2>
      <button disabled={state.status === 'loading'} onClick={retry}>Reload performance report</button></header>
    {state.status === 'loading' && <p role="status">Loading performance report…</p>}
    {state.status === 'error' && <p role="alert">Performance report could not be verified or loaded. Reload to retry.</p>}
    {state.status === 'ready' && <>
      <a href={runArtifactContentPath(params)} download={artifactDownload(artifact).filename}>Download text report</a>
      <pre tabIndex={0} role="region" aria-label="Verified performance report">{state.value}</pre>
    </>}
  </section>;
}

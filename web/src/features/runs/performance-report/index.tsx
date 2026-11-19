import { useId, useState } from 'react';
import { artifactDownload } from '@beetle/contracts';
import { runArtifactContentPath } from '@beetle/contracts/api';
import { useApi } from '../../../app/api.js';
import { Button, buttonClass } from '../../../components/Button.js';
import { useArtifactReport } from '../../../lib/use-artifact-report.js';
import type { ArtifactReader } from '../../../lib/use-artifact-report.js';
import type { ArtifactRead } from '../../../lib/verified-artifact.js';
import { performanceReportReads } from './read.js';

export function RunPerformanceReport({
  params,
  artifact,
  reads = performanceReportReads,
}: Omit<ArtifactRead, 'signal'> & { reads?: ArtifactReader<string> }) {
  const heading = useId();
  const { state, retry } = useArtifactReport({ params, artifact }, reads, useApi());
  return (
    <section className="performance-report" aria-labelledby={heading}>
      <h2 id={heading} className={state.status === 'ready' ? 'sr-only' : undefined}>
        Performance report
      </h2>
      {state.status === 'loading' && <p role="status">Loading performance report…</p>}
      {state.status === 'error' && (
        <>
          <p role="alert">Performance report could not be verified or loaded. Reload to retry.</p>
          <Button size="sm" onClick={retry}>
            Reload performance report
          </Button>
        </>
      )}
      {state.status === 'ready' && (
        <>
          <pre tabIndex={0} role="region" aria-label="Verified performance report">
            {state.value}
          </pre>
          <div className="performance-report-actions">
            <a
              className={buttonClass('secondary', 'sm')}
              href={runArtifactContentPath(params)}
              download={artifactDownload(artifact).filename}
            >
              Download report
            </a>
            <CopyReport text={state.value} />
          </div>
        </>
      )}
    </section>
  );
}

function CopyReport({ text }: { text: string }) {
  const [status, setStatus] = useState<'idle' | 'copying' | 'copied' | 'failed'>('idle');
  async function copy() {
    setStatus('copying');
    try {
      await navigator.clipboard.writeText(text);
      setStatus('copied');
    } catch {
      setStatus('failed');
    }
  }
  return (
    <>
      <Button size="sm" loading={status === 'copying'} onClick={() => void copy()}>
        Copy
      </Button>
      {status === 'copied' && <span role="status">Report copied.</span>}
      {status === 'failed' && <span role="alert">Could not copy. You can select the report text or download it.</span>}
    </>
  );
}

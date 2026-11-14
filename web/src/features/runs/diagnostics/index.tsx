import {useState} from 'react';
import type {Artifact} from '@beetle/contracts';
import type {RunArtifactParams} from '@beetle/contracts/api';
import {diagnosticText} from '@beetle/contracts/k6-diagnostics';
import type {K6Diagnostics} from '@beetle/contracts/k6-diagnostics';
import {useApi} from '../../../app/api.js';
import {useArtifactReport} from '../../../lib/use-artifact-report.js';
import {diagnosticReads} from './read.js';
type Params = Omit<RunArtifactParams, 'artifactId'>;
export function PublishedDiagnostics({params, artifacts}: {params: Params; artifacts: readonly Artifact[]}) {
  const matches = artifacts.filter(artifact => artifact.kind === 'k6-diagnostics');
  if (matches.length === 0) return <p>Native diagnostic history was not recorded for this attempt.</p>;
  if (matches.length !== 1) return <p role="alert">Multiple diagnostic artifacts were published; none selected.</p>;
  const artifact = matches[0]!;
  return <DiagnosticSelection key={`${params.organizationId}/${params.workspaceId}/${params.attemptId}/${artifact.sha256}`}
    params={{...params, artifactId: artifact.artifactId}} artifact={artifact} />;
}
function DiagnosticSelection({params, artifact}: {params: RunArtifactParams; artifact: Artifact}) {
  const [open, setOpen] = useState(false);
  return <section aria-label="Native diagnostic history"><h2>Native diagnostic history</h2>
    <p>Ordered sanitized records after publication. Native messages, URLs and dynamic values are omitted. This is not live output or original stderr replay.</p>
    <button onClick={() => setOpen(value => !value)}>{open ? 'Close diagnostic history' : 'View diagnostic history'}</button>
    {open && <DiagnosticRead params={params} artifact={artifact} />}
  </section>;
}
function DiagnosticRead({params, artifact}: {params: RunArtifactParams; artifact: Artifact}) {
  const {state, retry} = useArtifactReport({params, artifact}, diagnosticReads, useApi());
  if (state.status === 'ready') return <DiagnosticSummary report={state.value} />;
  if (state.status === 'loading') return <p role="status">Loading diagnostic history…</p>;
  return <><p role="alert">Diagnostic history could not be verified.</p><button onClick={retry}>Retry diagnostic history</button></>;
}
export function DiagnosticSummary({report}: {report: K6Diagnostics}) {
  return <><p>Capture coverage: {report.coverage}. Observed bytes: {report.observedBytes}; records: {report.observedRecords}.</p>
    <p>Redacted records: {report.redactedRecords}. Invalid segments: {report.invalidSegments}. Records beyond the retained limit: {report.droppedRecords}.</p>
    {report.coverage === 'partial' && <p>Capture is incomplete; this history cannot establish that no other diagnostics occurred.</p>}
    {report.records.length === 0 && <p>No diagnostic records retained. Check coverage before interpreting this as silence.</p>}
    <ol>{report.records.map(record => <li key={record.sequence}>#{record.sequence} [{record.level}] {diagnosticText(record.code)}</li>)}</ol>
  </>;
}

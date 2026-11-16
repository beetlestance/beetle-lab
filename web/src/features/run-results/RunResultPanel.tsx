import type { EngineResult } from '@beetle/contracts';
import type { RunResultProps } from './types.js';
import { resultView } from './view.js';
import type { ResultView } from './view.js';

export function RunResultPanel(props: RunResultProps) {
  const view = resultView(props);
  return <section className="run-result-panel" aria-label="Run result">
    <header className="result-header"><h2>Result</h2><p>Application outcome and engine evidence</p></header>
    {view.status === 'ready' ? <ReadyResult view={view} /> : <ResultStatus status={view.status} />}
  </section>;
}
function ResultStatus({ status }: { status: 'loading' | 'unavailable' | 'error' }) {
  if (status === 'loading') return <p role="status" className="notice">Loading result details…</p>;
  if (status === 'error') return <p role="alert" className="notice error">Result details could not be loaded.</p>;
  return <p className="notice">Metrics and result artifacts are unavailable in this view. Application state and engine validation are reported independently.</p>;
}
function ReadyResult({ view }: { view: Extract<ResultView, { status: 'ready' }> }) {
  const { run, result, provisional } = view;
  return <>
    <dl className="result-application" aria-label="Application result">
      <div><dt>Application state</dt><dd>{run.state}</dd></div>
      <div><dt>Application outcome</dt><dd className="result-outcome">{run.outcome}</dd></div>
      <div><dt>Application reason</dt><dd>{run.reason ?? 'None reported'}</dd></div>
    </dl>
    {provisional && <p role="status" className="notice">Awaiting application finalization. Engine evidence is provisional.</p>}
    <div className="result-engine">
      <dl className="result-facts" aria-label="Engine evidence">
        <div><dt>Engine-reported outcome</dt><dd>{result.outcome}{provisional && <span className="result-provisional"> Provisional</span>}</dd></div>
        <div><dt>Engine execution</dt><dd>{result.execution.status}</dd></div>
        <div><dt>Engine reason</dt><dd>{'reason' in result.execution ? result.execution.reason : 'None reported'}</dd></div>
        <div><dt>Evidence completeness</dt><dd>{result.completeness}</dd></div>
        <div><dt>Exit code</dt><dd>{result.execution.exitCode === null ? 'Unavailable' : result.execution.exitCode}</dd></div>
      </dl>
      <p className="result-note">Engine evidence does not change the application outcome. Metrics are unavailable in this view.</p>
      <dl className="result-facts" aria-label="Required assertions">
        <div><dt>Required assertions</dt><dd>{result.requiredAssertions.required}</dd></div>
        <div><dt>Assertions passed</dt><dd>{result.requiredAssertions.passed}</dd></div>
        <div><dt>Assertions failed</dt><dd>{result.requiredAssertions.failed}</dd></div>
        <div><dt>Assertions unknown</dt><dd>{result.requiredAssertions.unknown}</dd></div>
      </dl>
      <Thresholds thresholds={result.thresholds} />
    </div>
    <Artifacts artifacts={result.artifacts} />
  </>;
}
function Thresholds({ thresholds }: { thresholds: EngineResult['thresholds'] }) {
  return <details className="result-thresholds"><summary>Declared thresholds ({thresholds.length})</summary>
    {thresholds.length === 0 ? <p>No thresholds declared.</p> : <ul aria-label="Declared thresholds">
      {thresholds.map((threshold, index) => <li key={`${threshold.id}/${index}`}><code>{threshold.id}</code>
        <span>{threshold.purpose}</span><span>{threshold.passed ? 'Passed' : 'Failed'}</span></li>)}
    </ul>}
  </details>;
}
function Artifacts({ artifacts }: { artifacts: EngineResult['artifacts'] }) {
  return <div className="result-artifacts">
    <h3>Declared artifacts ({artifacts.length})</h3>
    <p className="result-note">Declarations do not establish verified publication. Downloads are unavailable.</p>
    {artifacts.length === 0 ? <p>No artifacts declared.</p> : <div className="result-table-scroll" tabIndex={0} role="region" aria-label="Declared artifact metadata">
      <table><caption>Declared artifact metadata</caption><thead><tr>
        <th scope="col">Artifact ID</th><th scope="col">Kind</th><th scope="col">Relative path</th><th scope="col">Bytes</th><th scope="col">SHA-256</th>
      </tr></thead><tbody>{artifacts.map((artifact, index) => <tr key={`${artifact.artifactId}/${index}`}>
        <td className="number">{artifact.artifactId}</td><td>{artifact.kind}</td><td>{artifact.relativePath}</td>
        <td className="number">{artifact.bytes}</td><td className="number">{artifact.sha256}</td>
      </tr>)}</tbody></table>
    </div>}
  </div>;
}

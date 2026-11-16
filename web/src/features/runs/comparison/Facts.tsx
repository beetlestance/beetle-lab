import { Link } from 'react-router-dom';
import type { RunComparisonItem } from '@beetle/contracts/api';
import { routes } from '../../../app/routes.js';
const warnings: Record<RunComparisonItem['warnings'][number], string> = {
  unknown_target_revision: 'Target revision is unknown.', unknown_contention: 'Actual contention is unknown.',
  unknown_secret_version: 'Secret versions are unknown.', target_sampler_disabled: 'Target sampler was disabled.',
  missing_result: 'No engine result was published.', partial_result: 'Engine result is incomplete.',
  limited_config_diff: 'Configuration differences reached a limit.', metric_unavailable: 'Selected metric is unavailable.',
  partial_metric_windows: 'Recorded metric windows are incomplete.',
};
export function ComparisonFacts({item}: {item: RunComparisonItem}) {
  const {run, result, environment, differences} = item;
  return <><dl className="run-facts">
    <div><dt>Application state / outcome</dt><dd>{run.state} / {run.outcome}</dd></div>
    <div><dt>Engine outcome / completeness</dt><dd>{result ? `${result.outcome} / ${result.completeness}` : 'No published result'}</dd></div>
    {result && <><div><dt>Engine execution</dt><dd>{result.execution.status}</dd></div>
      <div><dt>Required assertion definitions</dt><dd>{result.requiredAssertions.passed} passed; {result.requiredAssertions.failed} failed; {result.requiredAssertions.unknown} unknown; {result.requiredAssertions.required} required</dd></div>
      <div><dt>Failed SLOs / discovery reached</dt><dd>{result.failedSloCount} / {result.discoveryReached === null ? 'unknown' : String(result.discoveryReached)}</dd></div></>}
    <div><dt>Engine / profile</dt><dd>{run.engine.id} / {run.engine.profileId}</dd></div>
    <div><dt>Engine image</dt><dd className="number">{run.engine.imageDigest}</dd></div>
    <div><dt>Saved revision</dt><dd className="number">{run.revisionId}</dd></div>
    <div><dt>Suite</dt><dd><Link to={routes.suite(run.scope.organizationId, run.scope.workspaceId, run.suiteId)}>{run.suiteId}</Link></dd></div>
    <div><dt>Revision digest</dt><dd className="number">{run.revisionDigest}</dd></div>
    <div><dt>Accepted budget</dt><dd>{run.budget.cpuMillis} CPU millis; {run.budget.memoryBytes} memory bytes; {run.budget.pids} PIDs; {run.budget.timeoutMs} ms; {run.budget.outputBytes} output bytes</dd></div>
    <div><dt>Execution policy</dt><dd>{run.executionPolicy.mode}; prefer idle: {String(run.executionPolicy.preferIdle)}</dd></div>
    <div><dt>Settings versions</dt><dd>{run.settingsVersions.installation} / {run.settingsVersions.organization} / {run.settingsVersions.workspace}</dd></div>
    <div><dt>Target fingerprint</dt><dd className="number">{environment.targetDigest}</dd></div>
    <div><dt>Inputs fingerprint</dt><dd className="number">{environment.inputsDigest}</dd></div>
    <div><dt>Secret references fingerprint</dt><dd className="number">{environment.secretBindingsDigest}</dd></div>
    <div><dt>Secret versions / target sampler</dt><dd>{environment.secretVersions} / {environment.targetSampler}</dd></div>
  </dl>
    <p>Changed fields: {differences.fields.join(', ') || 'None recorded'}. Matching fingerprints do not establish equivalent test conditions.</p>
    <details><summary>Configuration paths ({differences.configChanges.length}{differences.limited ? '; limited' : ''})</summary>
      <ul>{differences.configChanges.map(change => <li key={change.path}><code>{change.path || '(root)'}</code>: {change.change}</li>)}</ul>
      {differences.limited && <p role="status">Additional differences may be omitted.</p>}</details>
    <ul aria-label="Evidence warnings">{item.warnings.map(warning => <li key={warning}>{warnings[warning]}</li>)}</ul>
  </>;
}

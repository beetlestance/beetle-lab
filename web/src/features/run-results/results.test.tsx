// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { validate } from '@beetle/contracts';
import type { EngineResult } from '@beetle/contracts';
import { validateApi } from '@beetle/contracts/api';
import type { Run } from '@beetle/contracts/api';
import passed from '../../../../contracts/fixtures/valid/passed-result.json' with { type: 'json' };
import { run, scope, runId, ids } from '../runs/test-fixtures.js';
import { RunResultPanel } from './index.js';
import type { RunResultProps } from './index.js';

afterEach(() => { cleanup(); });
function application(patch: Partial<Run> = {}): Run {
  const checked = validateApi('Run', { ...run(), ...patch });
  if (!checked.ok) throw new Error('Invalid synthetic Run');
  return checked.value;
}
function engine(patch: object = {}): EngineResult {
  const checked = validate('EngineResult', { ...structuredClone(passed), organizationId: scope.organizationId,
    workspaceId: scope.workspaceId, attemptId: run().activeAttemptId, ...patch });
  if (!checked.ok) throw new Error('Invalid synthetic EngineResult');
  return checked.value;
}
function props(): RunResultProps {
  return { scope, runId, run: application({ state: 'active' }), result: engine(), status: 'ready' };
}
function fact(label: string): HTMLElement {
  return screen.getByText(label, { selector: 'dt' }).nextElementSibling as HTMLElement;
}
it.each(['queued', 'dispatching', 'active', 'finalizing'] as const)('keeps %s application outcome pending when engine evidence reports pass', state => {
  render(<RunResultPanel {...props()} run={application({ state })} />);
  expect(fact('Application state')).toHaveTextContent(state); expect(fact('Application outcome')).toHaveTextContent('pending');
  expect(fact('Engine-reported outcome')).toHaveTextContent('passed'); expect(fact('Engine-reported outcome')).toHaveTextContent('Provisional');
  expect(screen.getByRole('status')).toHaveTextContent('Awaiting application finalization');
  expect(fact('Required assertions')).toHaveTextContent('2'); expect(fact('Assertions failed')).toHaveTextContent('0');
});
it.each(['cancelled', 'errored'] as const)('never upgrades %s application state or outcome from a passed engine result', state => {
  render(<RunResultPanel {...props()} run={application({ state, outcome: 'inconclusive', reason: state === 'cancelled' ? 'cancelled' : 'execution_lost' })} />);
  expect(fact('Application state')).toHaveTextContent(state); expect(fact('Application outcome')).toHaveTextContent('inconclusive');
  expect(fact('Application outcome')).not.toHaveTextContent('passed'); expect(fact('Engine-reported outcome')).toHaveTextContent('passed');
  expect(screen.queryByText('Provisional', { exact: true })).not.toBeInTheDocument();
  expect(screen.getByText(/Engine evidence does not change the application outcome/)).toBeVisible();
});
it('keeps final application outcome independent and presents only declared metadata with semantic labels', async () => {
  render(<RunResultPanel {...props()} run={application({ state: 'finished', outcome: 'failed', validationStatus: 'passed' })} />);
  expect(fact('Application outcome')).toHaveTextContent('failed'); expect(fact('Engine-reported outcome')).toHaveTextContent('passed');
  const table = screen.getByRole('table', { name: 'Declared artifact metadata' });
  expect(within(table).getAllByRole('columnheader').map(header => header.textContent)).toEqual(['Artifact ID', 'Kind', 'Relative path', 'Bytes', 'SHA-256']);
  expect(within(table).getByRole('cell', { name: 'reports/result.json' })).toBeVisible(); expect(within(table).getByRole('cell', { name: '32' })).toBeVisible();
  expect(screen.getByRole('region', { name: 'Declared artifact metadata' })).toHaveAttribute('tabindex', '0');
  expect(screen.queryByRole('link')).not.toBeInTheDocument(); expect(screen.queryByRole('button', { name: /download/i })).not.toBeInTheDocument();
  expect(screen.getByText(/Declarations do not establish verified publication/)).toBeVisible();
  const summary = screen.getByText('Declared thresholds (1)');
  await userEvent.click(summary); expect(summary.parentElement).toHaveAttribute('open');
  expect(screen.getByRole('list', { name: 'Declared thresholds' })).toHaveTextContent('latency');
});
it.each(['loading', 'error', 'unavailable'] as const)('renders fixed accessible %s state without stale evidence or invented counts', status => {
  render(<RunResultPanel {...props()} status={status} />);
  expect(screen.queryByText('reports/result.json')).not.toBeInTheDocument(); expect(screen.queryByText('Required assertions')).not.toBeInTheDocument();
  expect(screen.queryByRole('table')).not.toBeInTheDocument(); expect(screen.queryByText('0', { exact: true })).not.toBeInTheDocument();
  if (status === 'loading') expect(screen.getByRole('status')).toHaveTextContent('Loading result details');
  if (status === 'error') expect(screen.getByRole('alert')).toHaveTextContent('Result details could not be loaded.');
  if (status === 'unavailable') expect(screen.getByText(/Metrics and result artifacts are unavailable/)).toBeVisible();
});
it('distinguishes a missing result from a known empty artifact list and never traverses summary extensions', () => {
  const missing = render(<RunResultPanel {...props()} result={null} />);
  expect(screen.getByText(/Metrics and result artifacts are unavailable/)).toBeVisible(); expect(screen.queryByText(/No artifacts declared/)).not.toBeInTheDocument();
  expect(screen.queryByText('0', { exact: true })).not.toBeInTheDocument();
  const result = engine({ artifacts: [], thresholds: [] }); const getter = vi.fn(() => { throw new Error('arbitrary summary traversal'); });
  Object.defineProperty(result, 'engineSummary', { get: getter });
  missing.rerender(<RunResultPanel {...props()} result={result} />);
  expect(screen.getByRole('heading', { name: 'Declared artifacts (0)' })).toBeVisible(); expect(screen.getByText('No artifacts declared.')).toBeVisible();
  expect(screen.queryByRole('table')).not.toBeInTheDocument(); expect(getter).not.toHaveBeenCalled();
});
it('keeps unknown native exit evidence unavailable while showing the actual partial assertion counts', () => {
  const result = engine({ outcome: 'inconclusive', completeness: 'partial', requiredAssertions: { required: 2, passed: 0, failed: 0, unknown: 2 },
    execution: { status: 'lost', reason: 'execution_lost', exitCode: null, stoppedAt: passed.execution.stoppedAt } });
  render(<RunResultPanel {...props()} result={result} />);
  expect(fact('Exit code')).toHaveTextContent('Unavailable'); expect(fact('Engine reason')).toHaveTextContent('execution_lost');
  expect(fact('Evidence completeness')).toHaveTextContent('partial'); expect(fact('Assertions unknown')).toHaveTextContent('2');
});
const retired = {
  organization: (value: RunResultProps): RunResultProps => ({ ...value, scope: { ...scope, organizationId: ids.b } }),
  workspace: (value: RunResultProps): RunResultProps => ({ ...value, scope: { ...scope, workspaceId: ids.b } }),
  runId: (value: RunResultProps): RunResultProps => ({ ...value, runId: ids.b }),
  runScope: (value: RunResultProps): RunResultProps => ({ ...value, run: { ...value.run!, scope: { ...scope, organizationId: ids.b } } }),
  runIdentity: (value: RunResultProps): RunResultProps => ({ ...value, run: { ...value.run!, id: ids.b } }),
  attempt: (value: RunResultProps): RunResultProps => ({ ...value, run: { ...value.run!, activeAttemptId: ids.b } }),
  runMissing: (value: RunResultProps): RunResultProps => ({ ...value, run: null }),
  resultScope: (value: RunResultProps): RunResultProps => ({ ...value, result: { ...value.result!, workspaceId: ids.b } }),
  resultOrganization: (value: RunResultProps): RunResultProps => ({ ...value, result: { ...value.result!, organizationId: ids.b } }),
  resultAttempt: (value: RunResultProps): RunResultProps => ({ ...value, result: { ...value.result!, attemptId: ids.b } }),
  resultEngine: (value: RunResultProps): RunResultProps => ({ ...value, result: { ...value.result!, engineId: 'other' } }),
  generation: (value: RunResultProps): RunResultProps => ({ ...value, result: { ...value.result!, generation: 2 } }),
};
it.each(Object.keys(retired) as (keyof typeof retired)[])('immediately fences stale %s data, including counts, paths, hashes and reasons', boundary => {
  const initial: RunResultProps = { ...props(), run: application({ state: 'errored', outcome: 'inconclusive', reason: 'execution_lost' }),
    result: engine({ requiredAssertions: { required: 9191, passed: 9191, failed: 0, unknown: 0 },
      artifacts: [{ ...passed.artifacts[0]!, relativePath: 'stale-canary/private.json', sha256: 'f'.repeat(64) }] }) };
  const view = render(<RunResultPanel {...initial} />); expect(screen.getByText('stale-canary/private.json')).toBeVisible();
  view.rerender(<RunResultPanel {...retired[boundary](initial)} />);
  expect(screen.getByText(/Metrics and result artifacts are unavailable/)).toBeVisible();
  for (const text of ['stale-canary/private.json', 'f'.repeat(64), '9191', 'execution_lost']) expect(screen.queryAllByText(text)).toHaveLength(0);
  expect(screen.queryByRole('table')).not.toBeInTheDocument(); expect(screen.queryByText('Application outcome')).not.toBeInTheDocument();
});
it('refuses an oversized threshold carrier before rendering a partial list', () => {
  const result = engine();
  render(<RunResultPanel {...props()} result={{ ...result,
    thresholds: Array.from({ length: 257 }, () => ({ id: 'bound', purpose: 'slo' as const, passed: true as const })) }} />);
  expect(screen.getByRole('alert')).toHaveTextContent('Result details could not be loaded.');
  expect(screen.queryByText(/Declared thresholds/)).not.toBeInTheDocument(); expect(screen.queryByRole('table')).not.toBeInTheDocument();
});
it('checks foreign identity before inspecting artifact declarations', () => {
  const result = engine({ workspaceId: ids.b }); const getter = vi.fn(() => { throw new Error('foreign artifact inspection'); });
  Object.defineProperty(result, 'artifacts', { get: getter });
  render(<RunResultPanel {...props()} result={result} />);
  expect(screen.getByText(/Metrics and result artifacts are unavailable/)).toBeVisible(); expect(getter).not.toHaveBeenCalled();
});
it('renders all 128 bounded long declarations and refuses an oversized carrier instead of silently truncating it', () => {
  const artifacts = Array.from({ length: 128 }, (_, index) => ({ ...passed.artifacts[0]!,
    artifactId: `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`, relativePath: 'reports/' + 'a'.repeat(504),
    bytes: index === 0 ? Number.MAX_SAFE_INTEGER : index, sha256: 'f'.repeat(64) }));
  const result = engine({ artifacts }); const view = render(<RunResultPanel {...props()} result={result} />);
  expect(screen.getByRole('heading', { name: 'Declared artifacts (128)' })).toBeVisible();
  expect(within(screen.getByRole('table')).getAllByRole('row')).toHaveLength(129);
  expect(screen.getByRole('cell', { name: String(Number.MAX_SAFE_INTEGER) })).toBeVisible();
  expect(screen.queryByRole('link')).not.toBeInTheDocument();
  view.rerender(<RunResultPanel {...props()} result={{ ...result, artifacts: [...artifacts, artifacts[0]!] }} />);
  expect(screen.getByRole('alert')).toHaveTextContent('Result details could not be loaded.');
  expect(screen.queryByRole('table')).not.toBeInTheDocument(); expect(screen.queryByText('Application outcome')).not.toBeInTheDocument();
});

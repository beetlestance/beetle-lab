// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { ThresholdReading } from './ThresholdReading.js';
import type { EngineResult } from '@beetle/contracts';
import type { PlanRule } from '../live/plan.js';
afterEach(cleanup);
const rule: PlanRule={id:'p95',metric:'http_req_duration',stat:'p95',operator:'<',value:250};
const verdict:EngineResult['thresholds'][number]={id:'p95',purpose:'slo',passed:true,reading:{source:'native-summary',metric:'http_req_duration',stat:'p95',value:186}};
it('renders the exact native reading and saved bound while keeping the native verdict authoritative',()=>{
 render(<ul><ThresholdReading threshold={{...verdict,reading:{...verdict.reading!,value:999}}} rules={[rule]} /></ul>);
 expect(screen.getByText('Passed')).toBeVisible();expect(screen.getByText('999 ms; limit under 250 ms')).toBeVisible();
 expect(document.querySelector('.result-threshold-meter > span')).toHaveStyle({width:'100%'});
});
it('does not hide a recorded zero or substitute an estimate for legacy missing readings',()=>{
 const view=render(<ul><ThresholdReading threshold={{...verdict,reading:{...verdict.reading!,value:0}}} rules={[rule]} /></ul>);
 expect(screen.getByText('0 ms; limit under 250 ms')).toBeVisible();
 const {reading,...legacy}=verdict;void reading;view.rerender(<ul><ThresholdReading threshold={legacy} rules={[rule]} /></ul>);
 expect(screen.getByText('Native reading not recorded; limit under 250 ms.')).toBeVisible();
 expect(document.querySelector('.result-threshold-meter')).toBeNull();
});
it('refuses to use a mismatched native metric as a saved-rule reading',()=>{
 render(<ul><ThresholdReading threshold={{...verdict,reading:{...verdict.reading!,metric:'http_req_failed'}}} rules={[rule]} /></ul>);
 expect(screen.getByText('Native reading does not match the saved rule.')).toBeVisible();expect(document.querySelector('.result-threshold-meter')).toBeNull();
});
it('shows discovery trigger meaning without calling its inverse failed comparison a failed SLO',()=>{
 render(<ul><ThresholdReading threshold={{...verdict,purpose:'discovery',passed:false}} rules={[rule]} /></ul>);
 expect(screen.getByText('Reached')).toBeVisible();expect(screen.queryByText('Failed')).not.toBeInTheDocument();
 expect(screen.getByText('186 ms; saved limit unavailable.')).toBeVisible();
});

it.each([
  [337 / 712940, '0.05%', true],
  [0.010001, '1.0001%', false],
] as const)('displays the failure rate compactly without crossing its limit (%s)', (value, label, passed) => {
  const failure: PlanRule = { id: 'failure', metric: 'http_req_failed', stat: 'rate', operator: '<', value: 0.01 };
  render(<ul><ThresholdReading rules={[failure]} threshold={{
    id: 'failure', purpose: 'slo', passed,
    reading: { source: 'native-summary', metric: 'http_req_failed', stat: 'rate', value },
  }} /></ul>);
  expect(screen.getByText(`${label}; limit under 1%`)).toBeVisible();
  expect(screen.getByText(passed ? 'Passed' : 'Failed')).toBeVisible();
});

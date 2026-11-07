import type { DiscoveryMetadata, K6Threshold, ReadonlyLoadPlan, RuleMetadata, ThresholdRule } from './types.js';

const inverse = { '>': '<=', '>=': '<', '<': '>=', '<=': '>' } as const;

export function thresholdExpression(rule: ThresholdRule, discovery: boolean): string {
  const stat = rule.stat.startsWith('p') ? `p(${rule.stat.slice(1)})` : rule.stat;
  return `${stat}${discovery ? inverse[rule.operator] : rule.operator}${rule.value}`;
}

export function compileThresholds(plan: ReadonlyLoadPlan): {
  options: Record<string, K6Threshold[]>; rules: RuleMetadata[]; discovery: DiscoveryMetadata[];
} {
  const options: Record<string, K6Threshold[]> = Object.create(null) as Record<string, K6Threshold[]>;
  const rules: RuleMetadata[] = [];
  const discovery: DiscoveryMetadata[] = [];
  const add = (rule: ThresholdRule, scenarioId?: string): void => {
    const isDiscovery = scenarioId !== undefined;
    const threshold = thresholdExpression(rule, isDiscovery);
    const list = options[rule.metric] ?? [];
    list.push({ threshold, abortOnFail: isDiscovery });
    options[rule.metric] = list;
    const metadata: RuleMetadata = { id: rule.id, kind: isDiscovery ? 'discovery' : 'slo',
      rule: { ...rule }, threshold, abortScope: isDiscovery ? 'all-scenarios' : 'none' };
    if (scenarioId !== undefined) metadata.scenarioId = scenarioId;
    rules.push(metadata);
  };
  plan.slos.forEach(rule => add(rule));
  for (const scenario of plan.scenarios) {
    if (scenario.executor !== 'ramp-until') continue;
    add(scenario.stopRule, scenario.id);
    discovery.push({ scenarioId: scenario.id, ruleId: scenario.stopRule.id, abortScope: 'all-scenarios',
      affectedScenarioIds: plan.scenarios.map(item => item.id),
      companionScenarioIds: plan.scenarios.filter(item => item.id !== scenario.id).map(item => item.id),
      exhaustionOutcome: 'inconclusive', requiresObservedRuleFailure: true });
  }
  return { options, rules, discovery };
}

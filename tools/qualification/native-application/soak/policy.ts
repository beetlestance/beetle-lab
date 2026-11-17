import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import type { SuiteRevision } from '@beetle/contracts/api';
import { createK6ConfigSchema } from '@beetle/contracts/engine-config/k6';
import { starterPolicy } from '../../../install/starter/policy.js';
export const wallMs = 32 * 60 * 1000;
/** Qualification-only explicit policy; factory policy and other resource caps stay intact. */
export function longPolicy() {
  const policy = starterPolicy();
  return {
    ...policy,
    installationValues: {
      ...policy.installationValues,
      perRunCeilings: { ...policy.installationValues.perRunCeilings, timeoutMs: wallMs },
      runDefaults: {
        ...policy.installationValues.runDefaults,
        budget: { ...policy.installationValues.runDefaults.budget, timeoutMs: wallMs },
      },
    },
    agentPolicy: { ...policy.agentPolicy, maxTimeoutMs: wallMs },
    engine: {
      ...policy.engine,
      manifest: {
        ...policy.engine.manifest,
        defaultBudget: { ...policy.engine.manifest.defaultBudget, timeoutMs: wallMs },
        phases: policy.engine.manifest.phases.map((phase) =>
          phase.phase === 'execute' ? { ...phase, timeoutMs: wallMs } : phase,
        ),
      },
    },
  };
}
export async function longConfiguration() {
  const source = JSON.parse(
    await readFile('contracts/fixtures/api/valid/suite-revision.json', 'utf8'),
  ) as SuiteRevision;
  const config = source.config;
  config.target = 'http://target:8080';
  config.secrets = [];
  config.requests = [
    {
      id: 'get',
      name: 'Bounded30minute_work',
      method: 'GET',
      path: '/work',
      query: {},
      headers: {},
      assertions: [{ id: 'ok', kind: 'statusEq', value: 200, required: true }],
    },
  ];
  config.readiness = {
    path: '/ready',
    attempts: 1,
    intervalMs: 0,
    timeoutMs: 1000,
    wallBudgetMs: 1000,
    expectedStatus: 200,
    assertions: [],
  };
  config.loadPlan = {
    version: 1,
    scenarios: [
      {
        id: 'main',
        name: 'Long_original',
        executor: 'per-vu-iterations',
        vus: 1,
        iterations: 1830,
        maxDuration: '31m',
        startTime: '0s',
        gracefulStop: '0s',
      },
    ],
    slos: [],
  };
  config.selections = [
    { scenarioId: 'main', entries: [{ requestId: 'get', weight: 1, wait: { durationMs: 1000, jitterMs: 0 } }] },
  ];
  assert(createK6ConfigSchema((bytes) => createHash('sha256').update(bytes).digest('hex')).validate(config));
  return config;
}

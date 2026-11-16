import { tmpdir } from 'node:os';
/** Manual native option compatibility probe: inspect only, no execution or requests. */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdtemp, writeFile, realpath } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import type { K6LoadOptions, Scenario } from '../../compiler/index.js';
import { compiled, planWith, scenarios } from './fixtures.js';

interface Probe { name: string; options: K6LoadOptions; expectedExit: 0 | 104 }
const binary = process.argv[2];
if (!binary || !isAbsolute(binary)) throw new Error('Provide the installed absolute k6 binary path');
const output = await mkdtemp(join(await realpath(tmpdir()), 'w08-scenarios-r1-inspect-'));
const config = join(output, 'empty-config.json');
await writeFile(config, '{}\n');
const boundedProcess = { env: {}, encoding: 'utf8' as const, timeout: 10_000, maxBuffer: 65_536 };
const version = spawnSync(binary, ['version'], boundedProcess);
if (version.error || version.status !== 0) throw new Error('Native k6 version probe failed');

function fixture(executor: Scenario['executor']): Scenario {
  const result = scenarios.find(scenario => scenario.executor === executor);
  if (!result) throw new Error('Missing native fixture');
  return result;
}

function options(scenario: Scenario): K6LoadOptions {
  return compiled(planWith([scenario])).options;
}

function probes(): Probe[] {
  const result: Probe[] = [{ name: 'all-seven-compiled', options: compiled(planWith()).options, expectedExit: 0 }];
  const fixed = ['constant-arrival-rate', 'constant-vus', 'shared-iterations', 'per-vu-iterations'] as const;
  for (const executor of fixed) {
    const scenario = fixture(executor);
    const key = executor.includes('iterations') ? 'maxDuration' : 'duration';
    const valid = options({ ...scenario, [key]: '1000ms' });
    result.push({ name: executor + '-minimum-1000ms', options: valid, expectedExit: 0 });
    for (const value of ['1ms', '999ms']) {
      const invalid = structuredClone(valid);
      const native = invalid.scenarios[scenario.name];
      if (!native) throw new Error('Missing native options');
      Object.assign(native, { [key]: value });
      result.push({ name: executor + '-invalid-' + value, options: invalid, expectedExit: 104 });
    }
  }
  const shared = fixture('shared-iterations') as Extract<Scenario, { executor: 'shared-iterations' }>;
  const sharedValid = options({ ...shared, vus: 2, iterations: 2, maxDuration: '1s' });
  result.push({ name: 'shared-iterations-equal-vus', options: sharedValid, expectedExit: 0 });
  const sharedInvalid = structuredClone(sharedValid);
  Object.assign(sharedInvalid.scenarios[shared.name]!, { iterations: 1 });
  result.push({ name: 'shared-iterations-below-vus', options: sharedInvalid, expectedExit: 104 });
  const perVu = fixture('per-vu-iterations') as Extract<Scenario, { executor: 'per-vu-iterations' }>;
  result.push({ name: 'per-vu-iterations-below-vus',
    options: options({ ...perVu, vus: 2, iterations: 1, maxDuration: '1s' }), expectedExit: 0 });
  return [...result, ...rampingProbes()];
}

function rampingProbes(): Probe[] {
  const vus = fixture('ramping-vus') as Extract<Scenario, { executor: 'ramping-vus' }>;
  const down = options({ ...vus, startVUs: 1, stages: [{ duration: '1ms', target: 0 }], gracefulRampDown: '1ms' });
  const zero = structuredClone(down);
  Object.assign(zero.scenarios[vus.name]!, { startVUs: 0 });
  const arrival = fixture('ramping-arrival-rate') as Extract<Scenario, { executor: 'ramping-arrival-rate' }>;
  const discovery = fixture('ramp-until') as Extract<Scenario, { executor: 'ramp-until' }>;
  return [
    { name: 'ramping-vus-positive-start-rampdown-ms', options: down, expectedExit: 0 },
    { name: 'ramping-vus-all-zero', options: zero, expectedExit: 104 },
    { name: 'ramping-vus-later-positive-ms', options: options({ ...vus, startVUs: 0,
      stages: [{ duration: '1ms', target: 0 }, { duration: '1ms', target: 1 }] }), expectedExit: 0 },
    { name: 'ramping-arrival-ms', options: options({ ...arrival, stages: [{ duration: '1ms', target: 1 }] }), expectedExit: 0 },
    { name: 'discovery-ms', options: options({ ...discovery, startRate: 1, maxRate: 2, stepRate: 1, stepDuration: '1ms' }), expectedExit: 0 },
    { name: 'constant-ms-offset-grace', options: options({ ...fixture('constant-vus'), executor: 'constant-vus',
      vus: 1, duration: '1s', startTime: '1ms', gracefulStop: '7ms' }), expectedExit: 0 },
  ];
}

const evidence = [];
for (const probe of probes()) {
  const path = join(output, probe.name + '.js');
  const names = Object.values(probe.options.scenarios).map(scenario => scenario.exec);
  const source = `export const options = ${JSON.stringify(probe.options)};\n`
    + names.map(name => `export function ${name}() {}`).join('\n') + '\n';
  await writeFile(path, source);
  const native = spawnSync(binary, ['inspect', '--execution-requirements', '--config', config, path], boundedProcess);
  const record = { name: probe.name, expectedExit: probe.expectedExit, actualExit: native.status,
    signal: native.signal, processError: native.error ? 'native_process_error' : null,
    stdout: native.stdout, stderr: native.stderr, sourceSha256: createHash('sha256').update(source).digest('hex') };
  evidence.push(record);
  if (native.error || native.status !== probe.expectedExit) process.exitCode = 1;
}
const binaryHash = createHash('sha256');
for await (const chunk of createReadStream(binary, { highWaterMark: 65_536 })) binaryHash.update(chunk as Buffer);
const manifest = { binary, version: version.stdout.trim(), binarySha256: binaryHash.digest('hex'),
  environment: {}, config: '{}', command: 'inspect --execution-requirements --config empty-config.json <empty-entrypoint-script>',
  executesLoad: false, probes: evidence };
await writeFile(join(output, 'evidence.json'), JSON.stringify(manifest, null, 2) + '\n');
console.log(JSON.stringify({ output, version: manifest.version, total: evidence.length,
  matched: evidence.filter(item => item.actualExit === item.expectedExit && item.processError === null).length }));

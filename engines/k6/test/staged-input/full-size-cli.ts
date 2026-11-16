import { createHash } from 'node:crypto';
import { openStagedInput } from '../../wrapper/input/index.js';

const hash = (value: unknown): string => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const [inputRoot, secretRoot, version] = process.argv.slice(2);
if (!inputRoot || !secretRoot || !version || process.argv.length !== 5) throw new Error('cli_arguments');
const operation = openStagedInput({ inputRoot, secretRoot, uid: process.getuid!(), headerTimeoutMs: 5000,
  signal: new AbortController().signal, installed: { id: 'k6', version, configVersion: 1,
    configSchema: 'https://beetle.test/contracts/engines/k6/v1/suite',
    resultSchema: 'https://beetle-lab.dev/contracts/runner/v1/engine-result' } });
const opened = await operation.result; await operation.quiesced;
if (!opened.ok) throw new Error(`open_${opened.code}`);
try {
  const compile = opened.value.compile(); const result = await compile.result; await compile.quiesced;
  if (!result.ok) throw new Error(`compile_${result.code}`);
  process.stdout.write(JSON.stringify({ offerBytes: Buffer.byteLength(JSON.stringify(opened.value.offer)),
    configBytes: Buffer.byteLength(JSON.stringify(opened.value.offer.config)), offerHash: hash(opened.value.offer),
    configHash: hash(opened.value.offer.config), requests: result.value.suite.requests.length,
    inputs: result.value.suite.identity.inputs.length }) + '\n');
} finally { await opened.value.close(); }

import { validateAttempt } from '../runtime/index.js';
import type { BuildInput } from '../build/index.js';
import type { CompiledSuite, DeepReadonly } from '../plan/index.js';
import { StandaloneExportError } from './types.js';
import type { StandaloneExportInput } from './types.js';

function own(input: object, name: keyof StandaloneExportInput): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(input, name);
  if (!descriptor || !descriptor.enumerable || !('value' in descriptor)) throw new Error('export_options');
  return descriptor.value;
}
function compiled(value: unknown): DeepReadonly<CompiledSuite> {
  if (!value || typeof value !== 'object' || !Object.isFrozen(value)) throw new Error('export_suite');
  const suite = value as DeepReadonly<CompiledSuite>;
  if (suite.component !== 'k6-suite' || suite.compilerVersion !== '1.0' || suite.schemaVersion !== 1
    || !suite.identity || !Array.isArray(suite.identity.secrets)) throw new Error('export_suite');
  return suite;
}
function directory(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0 || value.includes('\0')
    || Buffer.byteLength(value, 'utf8') > 4096) throw new Error('export_options');
  return value;
}
function allowance(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) throw new Error('export_options');
  return value;
}
/** Trusted compiler output remains owned; only supplied scalar options are captured here. */
export function captureOptions(input: StandaloneExportInput): Readonly<BuildInput> {
  try {
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('export_options');
    const suite = compiled(own(input, 'suite'));
    const outputDirectory = directory(own(input, 'outputDirectory'));
    const timeoutMs = own(input, 'timeoutMs');
    const maximumBuildBytes = allowance(own(input, 'maximumBuildBytes'));
    const attempt = Object.freeze(validateAttempt({ mode: 'standalone', timeoutMs }));
    return Object.freeze({ suite, outputDirectory, attempt, maximumBuildBytes });
  } catch { throw new StandaloneExportError('invalid_input'); }
}

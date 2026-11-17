import { encodeJson } from '@beetle/contracts';

import type { JournalOptions } from '../journal/index.js';

import { AgentRuntimeError } from './types.js';
import type { AgentRuntimeOptions } from './types.js';
function journalCopy(input: JournalOptions): JournalOptions {
  const result: Record<string, unknown> = {};
  for (const key of ['path', 'queueLimit', 'spoolQuotaBytes', 'workerUrl']) {
    const descriptor = Object.getOwnPropertyDescriptor(input, key);
    if (descriptor && !('value' in descriptor)) throw new AgentRuntimeError('startup');
    if (descriptor) result[key] = descriptor.value;
  }
  if (result.workerUrl !== undefined) {
    const href = Object.getOwnPropertyDescriptor(URL.prototype, 'href')!.get!.call(result.workerUrl) as string;
    result.workerUrl = new URL(href);
  }
  return Object.freeze(result) as unknown as JournalOptions;
}
function validateStorageObserver(value: unknown): void {
  if (value !== undefined && typeof value !== 'function') throw new AgentRuntimeError('startup');
}
export function captureRuntimeOptions(input: AgentRuntimeOptions): AgentRuntimeOptions {
  const result: Record<string, unknown> = {};
  for (const name of [
    'journal',
    'installation',
    'transport',
    'catalog',
    'configuration',
    'providers',
    'credential',
    'minimumFreeBytes',
    'signal',
    'configurationCheck',
    'onStorageFailure',
  ]) {
    const descriptor = Object.getOwnPropertyDescriptor(input, name);
    if (descriptor && !('value' in descriptor)) throw new AgentRuntimeError('startup');
    result[name] = descriptor?.value;
  }
  if (
    typeof result.minimumFreeBytes !== 'number' ||
    !Number.isSafeInteger(result.minimumFreeBytes) ||
    result.minimumFreeBytes < 0
  ) {
    throw new AgentRuntimeError('startup');
  }
  validateStorageObserver(result.onStorageFailure);
  if (result.configurationCheck !== undefined && typeof result.configurationCheck !== 'function')
    throw new AgentRuntimeError('startup');
  const options = result as unknown as AgentRuntimeOptions;
  return Object.freeze({
    ...options,
    journal: journalCopy(options.journal),
    installation: JSON.parse(encodeJson(options.installation, 4096)) as AgentRuntimeOptions['installation'],
    configuration: JSON.parse(encodeJson(options.configuration, 65_536)) as AgentRuntimeOptions['configuration'],
  });
}

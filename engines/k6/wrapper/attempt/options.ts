import { isAbsolute, resolve } from 'node:path';
import { AttemptError, type StagedK6Options } from './types.js';
function path(value: string): boolean {
  return typeof value === 'string' && isAbsolute(value) && resolve(value) === value && !value.includes('\0');
}
function validateOptions(input: StagedK6Options): void {
  const roots = [input.inputRoot, input.secretRoot, input.outputRoot];
  if (
    !roots.every(path) ||
    new Set(roots).size !== 3 ||
    !Number.isSafeInteger(input.uid) ||
    input.uid < 0 ||
    input.uid !== process.getuid?.() ||
    !(input.signal instanceof AbortSignal)
  )
    throw new AttemptError('profile');
}
export function captureOptions(input: StagedK6Options): StagedK6Options {
  validateOptions(input);
  const headerTimeoutMs = input.headerTimeoutMs ?? 5000;
  if (!Number.isSafeInteger(headerTimeoutMs) || headerTimeoutMs < 1 || headerTimeoutMs > 60_000)
    throw new AttemptError('profile');
  validateCallbacks(input);
  if (input.liveMetricMailbox !== undefined && typeof input.liveMetricMailbox !== 'boolean')
    throw new AttemptError('profile');
  return Object.freeze({
    inputRoot: input.inputRoot,
    secretRoot: input.secretRoot,
    outputRoot: input.outputRoot,
    uid: input.uid,
    signal: input.signal,
    headerTimeoutMs,
    liveMetricMailbox: input.liveMetricMailbox === true,
    installed: Object.freeze({ ...input.installed }),
    ...(input.expected ? { expected: Object.freeze({ ...input.expected }) } : {}),
    ...(input.onEvent ? { onEvent: input.onEvent } : {}),
    ...(input.onWindow ? { onWindow: input.onWindow } : {}),
  });
}
function validateCallbacks(input: StagedK6Options): void {
  for (const callback of [input.onEvent, input.onWindow]) {
    if (callback !== undefined && typeof callback !== 'function') throw new AttemptError('profile');
  }
}

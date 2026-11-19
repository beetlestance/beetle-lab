import type { TargetRuntimeSample } from './types.js';
type GcWindow = NonNullable<TargetRuntimeSample['gcWindow']>;
const maximumPauses = 16;

function safeCounter(value: unknown, minimum: number): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= minimum;
}
function validPause(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

/** Detach the bounded optional evidence before it reaches retained samples. */
export function captureTargetGcWindow(input: unknown): GcWindow | undefined {
  if (!input || typeof input !== 'object' || Reflect.ownKeys(input).length !== 3) return undefined;
  const { generation, through, recentMs } = input as Record<string, unknown>;
  if (!safeCounter(generation, 1) || !safeCounter(through, 0) || !Array.isArray(recentMs)) return undefined;
  if (recentMs.length > Math.min(through, maximumPauses)) return undefined;
  const values = Array.from(recentMs);
  if (!values.every(validPause)) return undefined;
  Object.freeze(values);
  return Object.freeze({ generation, through, recentMs: values });
}

function tailMatches(previous: GcWindow, current: GcWindow, advanced: number): boolean {
  const overlap = Math.min(previous.recentMs.length, current.recentMs.length - advanced);
  for (let offset = 1; offset <= overlap; offset++) {
    if (previous.recentMs.at(-offset) !== current.recentMs.at(-advanced - offset)) return false;
  }
  return true;
}

function sequenceAdvance(previous: GcWindow, current: GcWindow): number | null {
  const advanced = current.through - previous.through;
  if (current.generation !== previous.generation || advanced < 0 || advanced > current.recentMs.length) return null;
  return tailMatches(previous, current, advanced) ? advanced : null;
}

/** Maximum over collected pauses between the first and last observations. */
export function targetGcPauseMaximum(samples: readonly TargetRuntimeSample[]): number | null {
  const first = samples[0]?.gcWindow;
  const last = samples.at(-1)?.gcWindow;
  if (!first || !last) return null;
  let previous = first;
  let maximum: number | null = null;
  for (const sample of samples.slice(1)) {
    const current = sample.gcWindow;
    if (!current) continue;
    const advanced = sequenceAdvance(previous, current);
    if (advanced === null) return null;
    if (advanced > 0) maximum = Math.max(maximum ?? 0, ...current.recentMs.slice(-advanced));
    previous = current;
  }
  return maximum;
}

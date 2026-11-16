import { createHash } from 'node:crypto';
import { captureLiveMetricSnapshot } from '@beetle/contracts/api';
import type { LiveMetricSnapshot } from '@beetle/contracts/api';
import data from '../../../contracts/fixtures/api/valid/live-metric-snapshot.json' with {type: 'json'};
export { deferred } from '../runner/fixtures.js';
export const hash = (value: string | Uint8Array): string => createHash('sha256').update(value).digest('hex');
const template = captureLiveMetricSnapshot(data, hash);
export function frame(patch: Partial<LiveMetricSnapshot> = {}): LiveMetricSnapshot {return {...structuredClone(template), ...patch};}

import { createHash } from 'node:crypto';
import type { Offer } from '@beetle/contracts';
import type { AdmissionCommand } from '../../src/admission/index.js';
import { configDigest } from '../../src/journal/admission-input.js';
import { offer, registration } from '../catalog/fixtures.js';

export const sha256 = (value: string): string => createHash('sha256').update(value).digest('hex');
/** Independent fixture accounting: root is node one at depth zero. */
export function shape(value: unknown): { nodes: number; depth: number } {
  if (value === null || typeof value !== 'object') return { nodes: 1, depth: 0 };
  const children = Object.values(value).map(shape);
  return { nodes: 1 + children.reduce((sum, child) => sum + child.nodes, 0),
    depth: children.length ? 1 + Math.max(...children.map(child => child.depth)) : 0 };
}
export function original(boundary: 'nodes' | 'depth', maximum?: number): Offer {
  const job = offer(); const payload: unknown[] = [];
  job.budget = { cpuMillis: 1000, memoryBytes: 1000, pids: 10, outputBytes: 100, timeoutMs: 1000 };
  job.executionPolicy.preferIdle = false;
  const request = job.config.requests as Record<string, unknown>[];
  request[0]!.method = 'POST'; request[0]!.body = { kind: 'json', value: payload };
  if (boundary === 'nodes') {
    let left = (maximum ?? 65_536) - shape(job).nodes;
    while (left > 1) {
      const length = Math.min(4096, left - 1);
      payload.push(Array.from({ length }, () => null)); left -= length + 1;
    }
    if (left) payload.push(null);
  } else {
    let nested = payload;
    while (shape(job).depth < (maximum ?? 64)) {
      const child: unknown[] = []; nested.push(child); nested = child;
    }
  }
  return job;
}
export function command(job: Offer): Extract<AdmissionCommand, { kind: 'offer' }> {
  return { kind: 'offer', offer: job, now: 100_000,
    validation: { ...registration().validation, configDigest: configDigest(job.config) } };
}

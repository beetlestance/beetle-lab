import assert from 'node:assert/strict';
import { constants } from 'node:fs';
import { open, writeFile } from 'node:fs/promises';
import type { Fixture } from '../../../agent/test/container/fixture.js';
import { argumentsFor } from './configuration.js';

export function absenceArguments(values: string[]) {
  assert(values.length >= 2 && values.length <= 3,
    'Usage: smoke-absence.ts AGENT_IMAGE ENGINE_IMAGE [LOCAL_CONTEXT]');
  return argumentsFor([values[0]!, values[1]!, '200', values[2] ?? 'default']);
}
/** Only the enqueue request changes; installation configuration keeps its real ceiling. */
export function rejectedFixture<T extends { budget: Fixture['budget']; manifest: { minimumBudget: { cpuMillis: number } } }>(f: T): T {
  const cpuMillis = f.manifest.minimumBudget.cpuMillis - 1;
  assert(Number.isSafeInteger(cpuMillis) && cpuMillis > 0 && cpuMillis < f.budget.cpuMillis);
  return { ...f, budget: { ...f.budget, cpuMillis } };
}
export function absenceCharge(events: number, result: number, maximum: number) {
  for (const amount of [events, result, maximum]) assert(Number.isSafeInteger(amount) && amount >= 0);
  const retained = events + result;
  assert(Number.isSafeInteger(retained) && retained <= maximum && Number.isSafeInteger(retained + 65536));
  return { events, result, retained, refunded: maximum - retained, charged: retained + 65536 };
}
export async function boundedFile(path: string | URL, maximum: number): Promise<Buffer> {
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const info = await handle.stat(); assert(info.isFile() && info.size <= maximum);
    const buffer = Buffer.alloc(maximum + 1); let bytes = 0;
    for (let calls = 0; calls < 128; calls++) {
      const read = await handle.read(buffer, bytes, buffer.length - bytes, bytes); bytes += read.bytesRead;
      assert(bytes <= maximum, 'File read limit');
      if (read.bytesRead === 0) return buffer.subarray(0, bytes);
    }
    throw new Error('File read call limit');
  } finally { await handle.close(); }
}
export async function privateJson(path: string, value: unknown) {
  const encoded = JSON.stringify(value, null, 2); assert(Buffer.byteLength(encoded) <= 131072);
  await writeFile(path, encoded, { mode: 0o600 });
}

import assert from 'node:assert/strict';
import {record} from '../../resources/values.js';
export function bounded(value: unknown, maximum: number, minimum = 0): number {
 assert(typeof value === 'number' && Number.isFinite(value) && value >= minimum && value <= maximum); return value;
}
export function count(value: unknown, maximum = 10000000): number {const result = bounded(value, maximum); assert(Number.isSafeInteger(result)); return result;}
export function array(value: unknown, length: number): unknown[] {assert(Array.isArray(value) && value.length === length); return value;}
export function images(input: unknown) {
 const row = record(input); const result: Record<string, string> = {};
 for (const role of ['frontend', 'backend', 'agent', 'installer', 'engine', 'offline']) {
  const id = row[role]; assert(typeof id === 'string' && /^sha256:[a-f0-9]{64}$/.test(id)); result[role] = id;
 }
 return result;
}
export function terminal(input: unknown, expected: string) {
 const run = record(input); assert.equal(run.state, 'finished'); assert.equal(run.outcome, expected); assert.equal(run.reason, null);
 return {state: 'finished', outcome: expected};
}
export function result(input: unknown, expected: {outcome: string; exitCode: number}) {
 const row = record(input); const execution = record(row.execution);
 assert.equal(row.outcome, expected.outcome); assert.equal(execution.status, 'completed'); assert.equal(execution.exitCode, expected.exitCode);
 return {outcome: expected.outcome, exitCode: expected.exitCode};
}

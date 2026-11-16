import type { FileHandle } from 'node:fs/promises';
import type * as Fs from 'node:fs/promises';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as validation from '../../compiler/suite/validation.js';
import { fixture, now, opened } from './fixtures.js';
import type { Fixture } from './fixtures.js';

const io = vi.hoisted(() => ({ handles: [] as FileHandle[],
  onOpen: undefined as ((handle: FileHandle, path: string) => void) | undefined }));
vi.mock('node:fs/promises', async original => {
  const actual = await original<typeof Fs>();
  return { ...actual, open: vi.fn(async (path: string, flags: number) => {
    const handle = await actual.open(path, flags); io.handles.push(handle); io.onOpen?.(handle, path); return handle;
  }) };
});
const fixtures: Fixture[] = [];
afterEach(async () => {
  io.onOpen = undefined; vi.restoreAllMocks();
  await Promise.allSettled(io.handles.splice(0).map(handle => handle.close()));
  for (const item of fixtures.splice(0)) { item.controller.abort(); await item.cleanup(); }
});
async function setup(): Promise<Fixture> { const value = await fixture(); fixtures.push(value); return value; }
describe('failed validation publication eligibility', () => {
  it.each([['deadline', now + 60_000], ['clock_fenced', now - 1]] as const)(
    'fences failed semantic verdict against %s arriving at quiescence', async (code, next) => {
      const value = await setup(); value.offer.config = { invalid: true }; await value.save();
      let wall = now; const session = await opened({ ...value.options, wallNow: () => wall });
      const operation = session.compile(); void operation.quiesced.then(() => { wall = next; });
      const result = await operation.result; await operation.quiesced; await session.close();
      expect(result).toEqual({ ok: false, code });
    });
  it.each([['deadline', now + 60_000], ['clock_fenced', now - 1]] as const)(
    'fences synchronous failing config validation after %s', async (code, next) => {
      const value = await setup(); value.offer.config = { invalid: true }; await value.save();
      let wall = now; const session = await opened({ ...value.options, wallNow: () => wall });
      const original = validation.validateSuiteConfig;
      vi.spyOn(validation, 'validateSuiteConfig').mockImplementationOnce(config => {
        const result = original(config); expect(result.ok).toBe(false); wall = next; return result;
      });
      const operation = session.compile(); const result = await operation.result;
      await operation.quiesced; await session.close(); expect(result).toEqual({ ok: false, code });
    });
  it.each([['deadline', now + 60_000], ['clock_fenced', now - 1]] as const)(
    'fences synchronous failing dependency validation after %s', async (code, next) => {
      const value = await setup(); value.offer.inputs[0]!.id = 'urn:uuid:' + value.offer.inputs[0]!.id;
      value.staging.inputFiles[0]!.inputId = value.offer.inputs[0]!.id; await value.save();
      let wall = now; const session = await opened({ ...value.options, wallNow: () => wall });
      const original = validation.validateCompileInput;
      vi.spyOn(validation, 'validateCompileInput').mockImplementationOnce(input => {
        const result = original(input); expect(result.ok).toBe(false); wall = next; return result;
      });
      const operation = session.compile(); const result = await operation.result;
      await operation.quiesced; await session.close(); expect(result).toEqual({ ok: false, code });
    });
  it.each([now + 60_000, now - 1])('preserves cancellation precedence with invalid config and wall %s', async next => {
    const value = await setup(); value.offer.config = { invalid: true }; await value.save();
    let wall = now; const session = await opened({ ...value.options, wallNow: () => wall });
    const operation = session.compile(); void operation.quiesced.then(() => { wall = next; value.controller.abort(); });
    const result = await operation.result; await operation.quiesced; await session.close();
    expect(result).toEqual({ ok: false, code: 'cancelled' });
  });
  it.each([now + 60_000, now - 1])('retains original failed close evidence with wall %s', async next => {
    const value = await setup(); let wall = now; const session = await opened({ ...value.options, wallNow: () => wall });
    let calls = 0;
    io.onOpen = (handle, path) => {
      if (path.endsWith('input-000.bin')) vi.spyOn(handle, 'close').mockImplementation(async () => {
        calls++; wall = next; throw new Error('PRIVATE_ORIGINAL_CLOSE');
      });
    };
    const operation = session.compile(); const result = await operation.result;
    await expect(operation.quiesced).rejects.toMatchObject({ code: 'filesystem' });
    const close = session.close(); expect(session.close()).toBe(close); await expect(close).rejects.toMatchObject({ code: 'filesystem' });
    expect(result).toEqual({ ok: false, code: 'filesystem' }); expect(calls).toBe(1);
  });
});

import { writeFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { readK6Summary } from '../../wrapper/collection/index.js';
import type { SummaryOptions } from '../../wrapper/collection/index.js';
import type { ProcessObservation } from '../../wrapper/process/index.js';
import { fixture } from './fixtures.js';

type Mutable<T> = { -readonly [Key in keyof T]: T[Key] };

describe('summary publication fences and captured admission', () => {
  it.each(['valid', 'invalid'])('honors quiesced callback abort for %s summary', async shape => {
    const f = await fixture(); const controller = new AbortController();
    try {
      if (shape === 'invalid') await writeFile(f.path, '{}');
      const op = readK6Summary({ ...f.options, signal: controller.signal });
      void op.quiesced.then(() => controller.abort());
      expect(await op.result).toEqual({ ok: false, code: 'cancelled', closeFailed: false }); await op.quiesced;
    } finally { await f.dispose(); }
  });
  it.each(['valid', 'invalid'])('honors quiesced callback close for %s summary', async shape => {
    const f = await fixture();
    try {
      if (shape === 'invalid') await writeFile(f.path, '{}');
      const op = readK6Summary(f.options);
      void op.quiesced.then(() => op.close());
      expect(await op.result).toEqual({ ok: false, code: 'closed', closeFailed: false }); await op.quiesced;
    } finally { await f.dispose(); }
  });
  it.each(['valid', 'invalid'])('honors final deadline for %s summary', async shape => {
    const f = await fixture(); let now = 100;
    try {
      if (shape === 'invalid') await writeFile(f.path, '{}');
      const op = readK6Summary({ ...f.options, deadlineMs: 1000, wallNow: () => now });
      void op.quiesced.then(() => { now = 1000; });
      expect(await op.result).toEqual({ ok: false, code: 'deadline', closeFailed: false }); await op.quiesced;
    } finally { await f.dispose(); }
  });
  it.each(['valid', 'invalid'])('honors final clock rollback for %s summary', async shape => {
    const f = await fixture(); let now = 100;
    try {
      if (shape === 'invalid') await writeFile(f.path, '{}');
      const op = readK6Summary({ ...f.options, deadlineMs: 1000, wallNow: () => now });
      void op.quiesced.then(() => { now = 99; });
      expect(await op.result).toEqual({ ok: false, code: 'clock', closeFailed: false }); await op.quiesced;
    } finally { await f.dispose(); }
  });
  it.each(['frozen replacement', 'mutable observation'])('does not admit unknown process via %s', async kind => {
    const f = await fixture();
    try {
      const stopped = Object.freeze({ ...f.options.process });
      const unknown: Mutable<ProcessObservation> = { ...stopped, state: 'unknown' };
      const options: Mutable<SummaryOptions> = { ...f.options, process: kind === 'frozen replacement' ? Object.freeze({ ...unknown }) : unknown };
      options.wallNow = () => {
        if (kind === 'frozen replacement') options.process = stopped;
        else unknown.state = 'stopped';
        return Date.now();
      };
      const op = readK6Summary(options);
      expect(await op.result).toMatchObject({ ok: false, code: 'process' }); await op.quiesced;
    } finally { await f.dispose(); }
  });
  it.each(['frozen replacement', 'mutable observation'])('does not upgrade partial collection via %s', async kind => {
    const f = await fixture(); let checks = 0;
    try {
      const partial: Mutable<ProcessObservation> = { ...f.options.process, collection: 'partial' };
      const complete = Object.freeze({ ...partial, collection: 'complete' as const });
      const options: Mutable<SummaryOptions> = { ...f.options, process: kind === 'frozen replacement' ? Object.freeze({ ...partial }) : partial };
      options.wallNow = () => {
        if (++checks === 3) {
          if (kind === 'frozen replacement') options.process = complete;
          else partial.collection = 'complete';
        }
        return Date.now();
      };
      const op = readK6Summary(options);
      expect(await op.result).toMatchObject({ ok: true, evidence: { nativeCollection: 'partial' } }); await op.quiesced;
    } finally { await f.dispose(); }
  });
  it('captures directory, UID, deadline, timeout and suite before clock reentry', async () => {
    const f = await fixture();
    try {
      const options = { ...f.options, wallNow: () => 100, deadlineMs: 1000 };
      options.wallNow = () => {
        options.outputDirectory += '/missing'; options.uid++;
        options.deadlineMs = 1; options.timeoutMs = 0;
        options.compiledSuite = { ...f.options.compiledSuite, requests: [] };
        return 100;
      };
      const op = readK6Summary(options);
      expect(await op.result).toMatchObject({ ok: true, evidence: { nativeCollection: 'partial' } }); await op.quiesced;
    } finally { await f.dispose(); }
  });
  it('captures clock and signal references through final publication', async () => {
    const f = await fixture(); const controller = new AbortController(); let now = 100;
    try {
      const options = { ...f.options, deadlineMs: 1000, signal: controller.signal, wallNow: () => now };
      options.wallNow = () => {
        options.signal = new AbortController().signal;
        options.wallNow = () => 0;
        return now;
      };
      const op = readK6Summary(options);
      void op.quiesced.then(() => { now = 1000; controller.abort(); });
      expect(await op.result).toEqual({ ok: false, code: 'cancelled', closeFailed: false }); await op.quiesced;
    } finally { await f.dispose(); }
  });
  it('checks the captured clock after a replacement callback is supplied', async () => {
    const f = await fixture(); let now = 100;
    try {
      const options = { ...f.options, deadlineMs: 1000, wallNow: () => now };
      options.wallNow = () => { options.wallNow = () => 100; return now; };
      const op = readK6Summary(options);
      void op.quiesced.then(() => { now = 1000; });
      expect(await op.result).toEqual({ ok: false, code: 'deadline', closeFailed: false }); await op.quiesced;
    } finally { await f.dispose(); }
  });
});

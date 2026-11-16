import { expect, it } from 'vitest';
import { ProcessActor } from '../../wrapper/process/actor.js';
import { nodeSpawn, ownedGroup } from '../../wrapper/process/ports.js';
import { validateProfile } from '../../wrapper/process/profile.js';
import type { NativeProcessOptions } from '../../wrapper/process/index.js';
import { deferred } from './fixtures.js';
import { ownedFiles } from './files.js';

function standIn(input: NativeProcessOptions) {
  let ownedPid: number | undefined;
  const actor = new ProcessActor(input, { validate: validateProfile, group: ownedGroup,
    spawn: (binary, _args, launch) => {
      const child = nodeSpawn(binary, [input.script], launch);
      child.once('spawn', () => { ownedPid = child.pid; }); return child;
    } });
  return { actor, async cleanup() {
    // Only this detached child's spawn event authorizes a PID. Never inspect or signal unrelated PIDs.
    if (ownedPid !== undefined && ownedGroup(ownedPid, 0) !== 'absent') ownedGroup(ownedPid, 'SIGKILL');
    await actor.close();
  } };
}
it('streams an actual owned Node child and observes its exit without inferring test outcome', async () => {
  const input = await ownedFiles('process.stdout.write("x".repeat(100000)); process.stderr.write("secret"); process.exitCode=99;');
  let bytes = 0; let largest = 0;
  const h = standIn({ ...input, sink: async chunk => { bytes += chunk.length; largest = Math.max(largest, chunk.length); } });
  try {
    const result = await h.actor.run();
    expect(result).toMatchObject({ state: 'stopped', exitCode: 99, cause: null, collection: 'complete',
      metricBytes: 100000, diagnosticBytes: 6, groupAbsent: true, quiescent: true });
    expect(bytes).toBe(100000); expect(largest).toBeLessThanOrEqual(65_536);
    expect(JSON.stringify(result)).not.toContain('secret');
  } finally { await h.cleanup(); }
});
it('signals a real owned child while its sink is blocked and preserves the close boundary', async () => {
  const input = await ownedFiles('setTimeout(()=>process.exit(7),8000); process.stdout.write("x".repeat(65536));');
  const entered = deferred(); const gate = deferred(); const cancel = new AbortController();
  const h = standIn({ ...input, signal: cancel.signal, sink: async () => { entered.resolve(); await gate.promise; } });
  try {
    const run = h.actor.run(); await entered.promise; cancel.abort(); const result = await run;
    expect(result).toMatchObject({ cause: 'cancelled', state: 'stopped', collection: 'partial', quiescent: false });
    expect(result.signal).toBe('SIGTERM'); gate.resolve(); await h.actor.close();
  } finally { gate.resolve(); await h.cleanup(); }
});
it('broadcasts cancellation to owned descendants and confirms the reaped group is absent', async () => {
  const input = await ownedFiles([
    'const {spawn}=require("node:child_process");',
    'const child=spawn(process.execPath,["-e","setTimeout(()=>{},8000)"],{stdio:"ignore"});',
    'process.on("SIGTERM",()=>{}); child.on("exit",()=>process.exit(0));',
    'setTimeout(()=>process.exit(7),8000);',
    'child.on("spawn",()=>process.stdout.write("x".repeat(65536)));',
  ].join('\n'));
  const entered = deferred(); const cancel = new AbortController();
  const h = standIn({ ...input, signal: cancel.signal, sink: async () => { entered.resolve(); } });
  try {
    const run = h.actor.run(); await entered.promise; cancel.abort();
    expect(await run).toMatchObject({ state: 'stopped', cause: 'cancelled', groupAbsent: true });
  } finally { await h.cleanup(); }
});

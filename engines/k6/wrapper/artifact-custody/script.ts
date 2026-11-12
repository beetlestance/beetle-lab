import { lstat, realpath } from 'node:fs/promises';
import { isAbsolute, join, resolve } from 'node:path';
import type { Artifact } from '@beetle/contracts';
import type { BuildOutput } from '../../build/index.js';
import { AttemptError } from '../failure/index.js';
import { Artifacts } from './artifacts.js';
import type { ArtifactFence } from './artifacts.js';
import { directory } from './identity.js';
export interface ExportScriptInput {readonly outputRoot: string; readonly uid: number; readonly built: BuildOutput; readonly maximumBuildBytes: number; readonly fence: ArtifactFence}
export interface ExportScriptJob {readonly result: Promise<Artifact>; readonly settled: Promise<void>}
function capture(input: ExportScriptInput): ExportScriptInput {
  const value = {outputRoot: input.outputRoot, uid: input.uid, built: {...input.built}, maximumBuildBytes: input.maximumBuildBytes,
    fence: Object.freeze({check: input.fence.check.bind(input.fence), timestamp: input.fence.timestamp.bind(input.fence)})};
  requireProfile(value); requireBuild(value);
  return Object.freeze(value);
}
/** Original native work; parent retains its own fence and controls publication. */
export function sealExportScript(input: ExportScriptInput): ExportScriptJob {
  const value = capture(input); const artifacts = new Artifacts({directory: join(value.outputRoot,'standalone'),uid: value.uid,fence: value.fence});
  const work = Promise.resolve().then(async () => {
    value.fence.check();
    if (await realpath(value.outputRoot) !== value.outputRoot) throw new AttemptError('profile'); value.fence.check();
    const before = await lstat(value.outputRoot,{bigint:true}); directory(before,value.uid); value.fence.check();
    const artifact = await artifacts.existingScript(value.built.bytes,value.maximumBuildBytes);
    value.fence.check(); const canonical = await realpath(value.outputRoot); value.fence.check();
    const named = await lstat(value.outputRoot,{bigint:true}); directory(named,value.uid); value.fence.check();
    if (canonical !== value.outputRoot || named.dev !== before.dev || named.ino !== before.ino) throw new AttemptError('artifact');
    value.fence.check(); return Object.freeze({...artifact,relativePath:'standalone/suite.js'});
  });
  const result = work.catch(error => {throw error instanceof AttemptError ? error : new AttemptError('artifact');});
  const settled = result.then(() => undefined, () => {if (artifacts.quiescence === 'failed') throw new AttemptError('cleanup');});
  void result.catch(() => undefined); void settled.catch(() => undefined); return Object.freeze({result,settled});
}

function requireProfile(value: ExportScriptInput): void {
  if (typeof value.outputRoot !== 'string' || !isAbsolute(value.outputRoot) || resolve(value.outputRoot) !== value.outputRoot
    || value.outputRoot.includes('\0') || !Number.isSafeInteger(value.uid) || value.uid < 0 || value.uid !== process.getuid?.()) throw new AttemptError('profile');
  if (value.built.scriptPath !== join(value.outputRoot,'standalone','suite.js')) throw new AttemptError('profile');
}
function requireBuild(value: ExportScriptInput): void {
  const bytes = value.built.bytes; const peak = value.built.peakBytes; const maximum = value.maximumBuildBytes;
  if (!Number.isSafeInteger(maximum) || maximum < 1 || maximum > 64 * 1048576 || !Number.isSafeInteger(bytes)
    || bytes < 1 || !Number.isSafeInteger(peak) || bytes > peak || peak > maximum) throw new AttemptError('output_limit');
}

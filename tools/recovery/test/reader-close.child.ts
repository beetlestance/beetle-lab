import assert from 'node:assert/strict';
import { chmod, lstat, mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { createHash } from 'node:crypto';
import header from '../../../contracts/fixtures/valid/recovery-header.json' with {type: 'json'};
import { captureRecoveryRecord } from '@beetle/contracts/recovery';
import type { RecoveryHeader } from '@beetle/contracts/recovery';
import { rootIdentity } from '../src/claim.js';
import { stable } from '../src/files.js';
import { native } from '../src/io.js';
import { HistoryReader } from '../src/viewer/reader.js';
const root = await realpath(await mkdtemp(join(tmpdir(), 'beetle-history-close-')));
try {
  await mkdir(join(root, 'work'), {mode: 0o700}); await mkdir(join(root, 'data'), {mode: 0o500});
  await chmod(join(root, 'data'), 0o700); const path = join(root, 'data/item'); await writeFile(path, 'native', {mode: 0o400}); await chmod(join(root, 'data'), 0o500);
  const entry = {kind: 'file' as const, path: 'item', bytes: 6, sha256: createHash('sha256').update('native').digest('hex')};
  const claim = {version: 1 as const, destination: root, historyId: randomUUID(), operationId: randomUUID(), backupId: header.backupId,
    manifestDigest: 'a'.repeat(64), rootIdentity: rootIdentity(await lstat(root, {bigint: true})), workIdentity: rootIdentity(await lstat(join(root, 'work'), {bigint: true}))};
  const reader = new HistoryReader(claim, captureRecoveryRecord(header) as RecoveryHeader, [entry], {digest: 'b'.repeat(64),
    files: new Map([['item',stable(await lstat(path, {bigint: true}))]]), directories: new Map([['',rootIdentity(await lstat(join(root, 'data'), {bigint: true}))]])});
  const original = native.open; let closes = 0;
  native.open = async (...args) => {
    const handle = await original(...args);
    if (args[0] === path) {const close = handle.close.bind(handle); handle.close = async () => {closes++; await close(); throw new Error('PRIVATE_CLOSE_CANARY');};}
    return handle;
  };
  const job = reader.read({...entry, start: 0, endExclusive: 6, sink: {write: async () => {}}}, {signal: new AbortController().signal, deadline: performance.now() + 10000});
  await assert.rejects(job.result); let settled = false; void job.settled.then(() => {settled = true;});
  await new Promise<void>(resolve => setImmediate(resolve)); assert.equal(settled, false);
  const closing = reader.close(); await assert.rejects(closing); assert.equal(reader.close(), closing); await assert.rejects(reader.close());
  assert.equal(closes, 1); console.log(JSON.stringify({closes, settled, fenced: true}));
} finally {await chmod(join(root, 'data'), 0o700); await rm(root, {recursive: true, force: true});}

// Run only in a task-owned Linux container with the admitted bounded /beetle/live tmpfs.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { open, readFile, statfs, writeFile } from 'node:fs/promises';
import { createMailboxSink, openNativeMailbox } from './index.js';
import { captureMailboxImage, MAILBOX_BYTES, LIVE_MAILBOX_PATH } from '@beetle/contracts/live-mailbox';

const hash = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const file = await openNativeMailbox({uid: process.getuid!()});
const sink = createMailboxSink({file, hash, maximumProducedBytes: 1000000});
const signal = new AbortController().signal;
await sink.write(new TextEncoder().encode('window-one'), signal);
assert.equal(captureMailboxImage(await readFile(LIVE_MAILBOX_PATH), hash).revision, 1);
await sink.write(new TextEncoder().encode('window-two'), signal);
assert.equal(captureMailboxImage(await readFile(LIVE_MAILBOX_PATH), hash).revision, 2);
assert.equal((await readFile(LIVE_MAILBOX_PATH)).length, MAILBOX_BYTES);
// A same-container writer may corrupt this disposable channel, but cannot allocate
// beyond the kernel cap or cause the reader/writer to materialise a sparse extent.
const corrupt = await open(LIVE_MAILBOX_PATH, 'r+'); await corrupt.truncate(1073741824);
await assert.rejects(sink.write(new Uint8Array([1]), signal), {code: 'io'});
await corrupt.truncate(MAILBOX_BYTES); await corrupt.close(); await sink.close();
await writeFile('/beetle/live/one', 'x'); await writeFile('/beetle/live/two', 'x');
await assert.rejects(writeFile('/beetle/live/three', 'x'), {code: 'ENOSPC'});
const fs = await statfs('/beetle/live', {bigint: true});
assert.ok(fs.blocks * fs.bsize <= 131072n); assert.equal(fs.files, 4n);
console.log(JSON.stringify({platform: process.platform, architecture: process.arch, uid: process.getuid!(),
  twoCommittedFrames: true, sparseGrowthRejected: true, inodeCapEnforced: true,
  allocatedCapacityBytes: Number(fs.blocks * fs.bsize), closeQuiescence: sink.state().quiescence}));

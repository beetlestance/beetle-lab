import { readFile, writeFile } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import { setTimeout as pause } from 'node:timers/promises';
import { pathToFileURL } from 'node:url';
import { expect, it } from 'vitest';
import type { AttemptSnapshot } from '@beetle/contracts';
import { openJournal } from '../../src/journal/index.js';
import { offerInput } from '../../src/journal/input.js';
import { journalFixture } from './fixtures.js';

const f = journalFixture();
interface CommittedReply { id: number; value: AttemptSnapshot }

async function committedReplies(marker: string): Promise<CommittedReply[]> {
  for (let poll = 0; poll < 200; poll++) {
    const bytes = await readFile(marker).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== 'ENOENT') throw error;
      return null;
    });
    if (bytes) {
      expect(bytes.byteLength).toBeLessThan(4096);
      const replies = JSON.parse(bytes.toString()) as CommittedReply[];
      if (replies.length === 2) return replies;
    }
    await pause(10);
  }
  throw new Error('Committed cancellation replies were not intercepted within 200 polls');
}

it('retains committed cancellations with dropped replies through pending-credit custody, abort and exact reopen replay', async () => {
  const path = f.path(); const entry = path + '.mjs'; const marker = path + '.committed.json';
  await writeFile(entry, `import {parentPort} from 'node:worker_threads';
    import {writeFileSync,renameSync} from 'node:fs';
    const cancelIds=new Set(); const held=[];
    const post=parentPort.postMessage.bind(parentPort);
    parentPort.on('message',command=>{if(command.kind==='cancelOriginal') cancelIds.add(command.id);});
    parentPort.postMessage=reply=>{
      if(reply.kind==='result' && reply.ok===true && cancelIds.has(reply.id)) {
        // The real worker posts this only after Store.execute and its COMMIT return.
        if(held.length>=2) throw new Error('Synthetic interception bound exceeded');
        held.push({id:reply.id,value:reply.value});
        writeFileSync(${JSON.stringify(marker + '.tmp')},JSON.stringify(held));
        renameSync(${JSON.stringify(marker + '.tmp')},${JSON.stringify(marker)});
        return;
      }
      post(reply);
    };
    await import(${JSON.stringify(f.workerUrl().href)});`);
  const journal = await openJournal({ path, workerUrl: pathToFileURL(entry) });
  const offer = f.offer(); const original = offerInput(offer); let settled = 0;
  const first = journal.cancelOriginal({ offer, now: 1000 });
  const duplicate = journal.cancelOriginal({ offer, now: 2000 });
  const observed = [first, duplicate].map(promise => promise.then(
    value => { settled++; return { value }; }, error => { settled++; return { error: error as unknown }; }));
  let replies: CommittedReply[];
  try {
    replies = await committedReplies(marker);
    expect(new Set(replies.map(reply => reply.id)).size).toBe(2);
    expect(replies[0]?.value.admission).toEqual({ state: 'rejected', reason: 'cancelled' });
    expect(replies[1]?.value).toEqual(replies[0]?.value);
    expect(settled).toBe(0);
    let traversed = false;
    const opaque = new Proxy({}, { ownKeys() { traversed = true; throw new Error('Unexpected traversal'); } });
    await expect(journal.cancelOriginal({ offer: opaque, now: 3000 })).rejects.toMatchObject({ code: 'queue_full' });
    await expect(journal.immutableOffer(opaque)).rejects.toMatchObject({ code: 'queue_full' });
    await expect(journal.readOffer(f.key())).rejects.toMatchObject({ code: 'queue_full' });
    expect(traversed).toBe(false);
    // A real small command can still observe the committed receipt while both replies stay withheld.
    expect(await journal.get(f.key())).toEqual(replies[0]?.value);
    expect(settled).toBe(0);
    await journal.abort();
    for (const result of await Promise.all(observed)) expect(result).toMatchObject({ error: { code: 'unavailable' } });
    expect(settled).toBe(2);
    await expect(journal.cancelOriginal({ offer, now: 3000 })).rejects.toMatchObject({ code: 'closed' });
  } finally { await journal.abort(); }

  const reopened = await f.open(path);
  expect(await reopened.get(f.key())).toEqual(replies[0]?.value);
  expect(await reopened.cancelOriginal({ offer, now: 3000 })).toEqual(replies[0]?.value);
  expect(await reopened.immutableOffer(offer)).toEqual(replies[0]?.value);
  expect(await reopened.readOffer(f.key())).toEqual(offer);
  expect(await reopened.supervision({ key: f.key(), now: 3000 })).toEqual({ clockHighWater: 3000,
    clockFenced: false, cancelRequested: true, cancelRequestedAt: 1000, cancelReason: 'cancelled', immediateStop: false });
  await f.close(reopened);
  const db = new DatabaseSync(path);
  try {
    expect(db.prepare('SELECT * FROM cancelled_originals').all()).toEqual([{ attempt_id: offer.attemptId, generation: 1 }]);
    expect(db.prepare(`SELECT offer_json,canonical_json,last_seq,spool_rows,wrapper_high,supervisor_high,
      phase,result_json,exit_json,exit_facts_json,wrapper_checkpoint_json FROM accepted_attempts`).all()).toEqual([{
      offer_json: original.json, canonical_json: original.canonical, last_seq: 0, spool_rows: 0,
      wrapper_high: 0, supervisor_high: 0, phase: null, result_json: null, exit_json: null,
      exit_facts_json: null, wrapper_checkpoint_json: null,
    }]);
    for (const table of ['admission_queue', 'reservations', 'event_spool']) {
      expect(db.prepare(`SELECT * FROM ${table}`).all()).toEqual([]);
    }
    expect(db.prepare('SELECT cancel_at,cancel_reason FROM supervision_clock').all()).toEqual([{ cancel_at: 1000, cancel_reason: 'cancelled' }]);
    expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
  } finally { db.close(); }
});

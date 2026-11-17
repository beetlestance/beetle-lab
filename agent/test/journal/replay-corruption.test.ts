import {expect,it} from 'vitest';
import {validate} from '@beetle/contracts';
import {journalFixture} from './fixtures.js';
import {rawJournal} from './raw-connection.js';
const f=journalFixture();
it.each([0,1])('refuses an otherwise valid stored event beyond the durable last_seq, after %s',async after=>{
  const path=f.path();const first=await f.open(path);await first.immutableOffer(f.offer());
  await first.appendWrapper(f.wrapper(1));await first.appendWrapper(f.wrapper(2));await f.close(first);
  const db=rawJournal(path);
  try {
    // Synthetic cold corruption: preserve the real event, charge and source ordinal.
    db.prepare('UPDATE accepted_attempts SET last_seq=1 WHERE attempt_id=?').run(f.key().attemptId);
    const json=db.prepare('SELECT event_json FROM event_spool WHERE seq=2').get()?.event_json;
    expect(typeof json).toBe('string');expect(validate('AgentEvent',JSON.parse(String(json))).ok).toBe(true);
    expect(db.prepare('SELECT last_seq FROM accepted_attempts').get()?.last_seq).toBe(1);
  }finally{db.close();}
  const journal=await f.open(path);
  await expect(journal.readEvents(f.key(),after)).rejects.toMatchObject({code:'unavailable'});
});

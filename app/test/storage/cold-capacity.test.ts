import { expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { storageFixture, seed, settingsFixture, uuid } from './fixture.js';
import { readColdSettings, applyColdMemoryChange, applyColdOutputPoolChange } from '../../src/adapters/outbound/sqlite/cold-inspection/index.js';
const f = storageFixture();
async function setup() {
  const path = f.path(); const metadata = await f.open(path); await seed(metadata); await f.close(metadata);
  const db = new DatabaseSync(path); const fixture = settingsFixture();
  const expected = readColdSettings(db, fixture.chain.installation);
  const input = { expected, memoryBytes: 1500, operationId: uuid(99), ceilings: fixture.runtime };
  return { db, input };
}
it('updates installed memory once through the settings owner while preserving descendant settings and namespaces', async () => {
  const { db, input } = await setup();
  try {
    const descendants = db.prepare("SELECT * FROM settings WHERE kind!='installation' ORDER BY scope_key").all();
    const namespaces = db.prepare('SELECT * FROM workspaces ORDER BY id').all();
    expect(applyColdMemoryChange(db, input)).toBe('changed');
    const current = readColdSettings(db, input.expected);
    expect(current.version).toBe(input.expected.version + 1);
    expect(current.values).toEqual({ ...input.expected.values,
      perRunCeilings: { ...input.expected.values.perRunCeilings, memoryBytes: 1500 },
      runDefaults: { ...input.expected.values.runDefaults,
        budget: { ...input.expected.values.runDefaults.budget, memoryBytes: 1500 } } });
    expect(applyColdMemoryChange(db, input)).toBe('unchanged');
    expect(readColdSettings(db, input.expected)).toEqual(current);
    expect(db.prepare("SELECT * FROM settings WHERE kind!='installation' ORDER BY scope_key").all()).toEqual(descendants);
    expect(db.prepare('SELECT * FROM workspaces ORDER BY id').all()).toEqual(namespaces);
  } finally { db.close(); }
});
it('rejects conflicting settings versions or values without overwriting them', async () => {
  const { db, input } = await setup();
  try {
    expect(applyColdMemoryChange(db, { ...input, memoryBytes: 1250, operationId: uuid(98) })).toBe('changed');
    const before = readColdSettings(db, input.expected);
    expect(() => applyColdMemoryChange(db, input)).toThrow();
    expect(readColdSettings(db, input.expected)).toEqual(before);
  } finally { db.close(); }
});
it('rolls back invalid policy rather than manufacturing extra pool or host capacity', async () => {
  const { db, input } = await setup();
  try {
    expect(() => applyColdMemoryChange(db, { ...input, memoryBytes: 2500 })).toThrow();
    expect(readColdSettings(db, input.expected)).toEqual(input.expected);
    expect(() => applyColdMemoryChange(db, { ...input, memoryBytes: 500 })).toThrow();
    expect(readColdSettings(db, input.expected)).toEqual(input.expected);
  } finally { db.close(); }
});

it('grows output once while retaining prior memory, storage, descendants and namespace records',async()=>{
 const {db,input}=await setup();
 try{
  applyColdMemoryChange(db,input);const expected=readColdSettings(db,input.expected);
  const before=db.prepare("SELECT * FROM settings WHERE kind!='installation' ORDER BY scope_key").all();
  const namespaces=db.prepare('SELECT * FROM workspaces ORDER BY id').all();
  const change={expected,outputBytes:4000,operationId:uuid(97),ceilings:{...input.ceilings,pool:{...input.ceilings.pool,outputBytes:4000}}};
  expect(applyColdOutputPoolChange(db,change)).toBe('changed');
  const current=readColdSettings(db,expected);
  expect(current.version).toBe(expected.version+1);
  expect(current.values).toEqual({...expected.values,pool:{...expected.values.pool,outputBytes:4000}});
  expect(current.values.perRunCeilings.memoryBytes).toBe(1500);
  expect(applyColdOutputPoolChange(db,change)).toBe('unchanged');
  expect(readColdSettings(db,expected)).toEqual(current);
  expect(db.prepare("SELECT * FROM settings WHERE kind!='installation' ORDER BY scope_key").all()).toEqual(before);
  expect(db.prepare('SELECT * FROM workspaces ORDER BY id').all()).toEqual(namespaces);
  expect(()=>applyColdOutputPoolChange(db,{...change,outputBytes:5000,operationId:uuid(96)})).toThrow();
  expect(readColdSettings(db,expected)).toEqual(current);
 }finally{db.close();}
});
it.each([0,2000,10000])('rolls back invalid or non-increasing output capacity %s',async outputBytes=>{
 const {db,input}=await setup();
 try{
  const change={expected:input.expected,outputBytes,operationId:uuid(95),ceilings:{...input.ceilings,pool:{...input.ceilings.pool,outputBytes:20000}}};
  expect(()=>applyColdOutputPoolChange(db,change)).toThrow();
  expect(readColdSettings(db,input.expected)).toEqual(input.expected);
 }finally{db.close();}
});

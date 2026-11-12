import { afterEach, expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openApplication } from '../../../src/bootstrap/api.js';
import { authenticatedClient } from '../../../src/client/cli/auth.js';
import { parseOptions } from '../../../src/client/cli/options.js';
import { runClient } from '../../../src/client/cli/main.js';
import { nodeFetch } from '../../../src/client/cli/http.js';
import { storageFixture, settingsFixture } from '../../storage/fixture.js';
const storage = storageFixture(); const roots: string[] = [];
afterEach(async () => {await Promise.all(roots.splice(0).map(root => rm(root, {recursive: true, force: true})));});
function capture() {const stdout: string[] = []; const stderr: string[] = []; return {stdout, stderr, streams: {
  stdout: {write: async (value: string) => {stdout.push(value);}}, stderr: {write: async (value: string) => {stderr.push(value);}}}};}
async function setup(localAccess: 'automatic' | 'paired' = 'automatic') {
  const root = await mkdtemp(join(tmpdir(),'beetle-connect-tcp-')); roots.push(root); const path = storage.path();
  const origin = 'http://127.0.0.1:43127'; const app = await openApplication({externalOrigin: origin, localAccess, metadata: {
    path, workerUrl: storage.workerUrl(), installation: settingsFixture().chain.installation, runtime: null}});
  try {
    await app.server.listen({host:'127.0.0.1',port:0}); const address = app.server.server.address();
    if (!address || typeof address === 'string') throw new Error('Synthetic listener missing');
    const common = ['--endpoint',`http://127.0.0.1:${address.port}`,'--origin',origin,'--session-file',join(root,'session')];
    return {root,path,app,common};
  } catch (error) {await app.close(); throw error;}
}
it('connects to the real automatic backend and reuses its one persisted grant on explicit lost-reply recovery', async () => {
  const f = await setup();
  try {
    const opened = capture(); expect(await runClient(['connect',...f.common],opened.streams)).toBe(0); expect(opened.stdout).toEqual(['{"connected":true}\n']);
    const api = await authenticatedClient(parseOptions(['connect',...f.common])); expect((await api.listOrganizations({query:{limit:100}})).ok).toBe(true);
    const saved = JSON.parse(await readFile(join(f.root,'session'),'utf8')) as {cookie:string;session:{csrfToken:string}};
    const retry = [...f.common]; retry[retry.length-1] = join(f.root,'retry'); let calls = 0;
    const lost: typeof fetch = async (input,init) => {calls++; const result = await nodeFetch(input,init); await result.body?.cancel(); throw new Error('private lost reply canary');};
    const unknown = capture(); expect(await runClient(['connect',...retry],unknown.streams,lost)).toBe(3); expect(calls).toBe(1);
    await expect(readFile(join(f.root,'retry'))).rejects.toMatchObject({code:'ENOENT'});
    const recovered = capture(); expect(await runClient(['connect',...retry],recovered.streams)).toBe(0);
    const second = JSON.parse(await readFile(join(f.root,'retry'),'utf8')) as object; expect(second).toMatchObject(saved);
    expect([...opened.stdout,...opened.stderr,...unknown.stdout,...unknown.stderr,...recovered.stdout,...recovered.stderr].join('')).not.toContain(saved.cookie);
    expect(unknown.stderr.join('')).not.toContain('canary');
  } finally {await f.app.close();}
  const db = new DatabaseSync(f.path,{readOnly:true});
  try {expect(db.prepare('SELECT version FROM local_browser_session WHERE id=1').get()?.version).toBe(1);} finally {db.close();}
});
it('refuses connect on a paired backend without consuming its token, and preserves the existing pair command', async () => {
  const f = await setup('paired');
  try {
    const refused = capture(); expect(await runClient(['connect',...f.common],refused.streams)).toBe(5); expect(refused.stdout).toEqual([]);
    await expect(readFile(join(f.root,'session'))).rejects.toMatchObject({code:'ENOENT'});
    const token = join(f.root,'token'); await writeFile(token,f.app.bootstrapToken+'\n',{mode:0o600}); const paired = capture();
    expect(await runClient(['pair',...f.common,'--token-file',token],paired.streams)).toBe(0); expect(paired.stdout).toEqual(['{"paired":true}\n']);
    const api = await authenticatedClient(parseOptions(['connect',...f.common])); expect((await api.listOrganizations({query:{limit:100}})).ok).toBe(true);
  } finally {await f.app.close();}
});

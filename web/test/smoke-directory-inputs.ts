import assert from 'node:assert/strict';
import {createHash, randomUUID} from 'node:crypto';
import type {ApiClient, InputTransferClient} from '@beetle/contracts/api';
import {readResult} from '../src/app/errors.js';
import {BrowserSessionGate} from '../src/features/session/session.js';
import type {SessionState} from '../src/features/session/session.js';
import {DirectoryWorkflow} from '../src/features/input-directory/workflow.js';
import {planDirectory} from '../src/features/input-directory/plan.js';
import {withBackend} from './backend-fixture.js';

function transport(origin: string) {
  let cookie = ''; let requests = 0; let lost = false;
  const folderCreates: string[] = [];
  const fetcher: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    assert.equal(url.origin, origin); assert(++requests <= 80, 'Request budget');
    const headers = new Headers(init?.headers); headers.set('origin', origin); if (cookie) headers.set('cookie', cookie);
    const folderCreate = init?.method === 'POST' && url.pathname.endsWith('/folders');
    if (folderCreate) folderCreates.push(String(init.body));
    const response = await fetch(input, {...init, headers, redirect: 'error'});
    const received = response.headers.get('set-cookie');
    if (received) {assert(received.length <= 4096); cookie = received.split(';')[0]!;}
    if (folderCreate && !lost) {assert.equal(response.status, 201); lost = true; await response.body?.cancel(); throw new Error('Synthetic committed reply loss');}
    return response;
  };
  return {fetcher, folderCreates};
}
function waitFor(gate: BrowserSessionGate, kind: SessionState['kind']): Promise<SessionState> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {off(); reject(new Error('Session deadline'));}, 5000);
    const check = () => {const state = gate.getSnapshot(); if (state.kind === kind) {off(); clearTimeout(timer); resolve(state);}};
    const off = gate.subscribe(check); check();
  });
}
function file(path: string, content: Uint8Array): File {
  const selected = new File([content], path.split('/').at(-1)!);
  Object.defineProperty(selected, 'webkitRelativePath', {value: path}); return selected;
}
async function exercise(api: ApiClient, transfers: InputTransferClient, folderCreates: string[]) {
  const org = await readResult(api.createOrganization({body: {scope: {kind: 'installation'}, requestId: randomUUID(), name: 'Directory smoke', slug: 'directory-smoke'}}));
  const workspace = await readResult(api.createWorkspace({params: {organizationId: org.id}, body: {scope: {kind: 'organization', organizationId: org.id}, requestId: randomUUID(), name: 'Owned workspace'}}));
  const params = {organizationId: org.id, workspaceId: workspace.id};
  const content = new TextEncoder().encode('synthetic π\n'); const empty = new Uint8Array();
  const owner = new DirectoryWorkflow({api, transfers, workspace, changed: () => {}, invalidate: () => {}});
  try {
    await owner.start(planDirectory([file('data/a.txt', content), file('data/nested/empty', empty)]), workspace.rootFolderId);
    assert.equal(owner.state.complete, false); assert.equal(owner.state.current, undefined);
    await owner.run(); assert.equal(owner.state.complete, true);
    assert.deepEqual(owner.state.rows.map(row => row.status), ['published', 'published']);
    assert.equal(folderCreates.length, 3); assert.equal(folderCreates[0], folderCreates[1]);
    const folders = await readResult(api.listFolders({params, query: {limit: 100}}));
    const top = folders.items.find(row => row.name === 'data')!; const nested = folders.items.find(row => row.name === 'nested')!;
    assert.equal(top.parentFolderId, workspace.rootFolderId); assert.equal(nested.parentFolderId, top.id);
    const inputs = await readResult(api.listInputs({params, query: {limit: 100}})); assert.equal(inputs.items.length, 2);
    for (const record of inputs.items) {
      const expected = record.name === 'a.txt' ? content : empty;
      assert.equal(record.folderId, record.name === 'a.txt' ? top.id : nested.id);
      assert.equal(record.sha256, createHash('sha256').update(expected).digest('hex'));
      const download = await transfers.download({record}); assert(download.ok); assert.deepEqual(download.value, expected);
    }
  } finally {owner.dispose();}
}
await withBackend(async (origin, token) => {
  const network = transport(origin); const gate = new BrowserSessionGate({baseUrl: origin, fetch: network.fetcher}); gate.start();
  try {
    await waitFor(gate, 'unpaired'); gate.pair(token); const session = await waitFor(gate, 'paired');
    assert(session.kind === 'paired'); await exercise(session.client, session.transfers, network.folderCreates);
    gate.logout(); await waitFor(gate, 'unpaired'); await session.transfers.close();
  } finally {gate.stop();}
});
process.stdout.write('Directory smoke passed: real session, committed folder replay, nested folders, sequential published inputs and verified nonempty/empty downloads.\n');

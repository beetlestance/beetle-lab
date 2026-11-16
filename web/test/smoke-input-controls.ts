import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import type { ApiClient, Workspace } from '@beetle/contracts/api';
import { readResult } from '../src/app/errors.js';
import { BrowserSessionGate } from '../src/features/session/session.js';
import type { SessionState } from '../src/features/session/session.js';
import { UploadWorkflow } from '../src/features/input-upload/workflow.js';
import { withBackend } from './backend-fixture.js';

function browserTransport(origin: string): typeof fetch {
  let cookie = ''; let requests = 0;
  return async (input, init) => {
    const url = new URL(String(input)); const headers = new Headers(init?.headers); headers.set('origin', origin);
    if (url.origin !== origin || !url.pathname.startsWith('/api/v2/') || ++requests > 64) throw new Error('Synthetic request limit');
    if (cookie) headers.set('cookie', cookie);
    const response = await fetch(input, { ...init, headers, redirect: 'error' });
    const received = response.headers.get('set-cookie');
    if (received) { if (received.length > 4096) throw new Error('Synthetic cookie limit'); cookie = received.split(';')[0]!; }
    return response;
  };
}
function operation(url: URL, method: string | undefined): 'create' | 'seal' | 'chunk' | undefined {
  if (method === 'POST' && url.pathname.endsWith('/inputs')) return 'create';
  if (method === 'POST' && url.pathname.endsWith('/seal')) return 'seal';
  if (method === 'PUT' && url.pathname.endsWith('/chunks')) return 'chunk';
  return undefined;
}
function transport(origin: string) {
  const native = browserTransport(origin); const dropped = new Set<string>();
  const controls = { create: [] as string[], seal: [] as string[], offsets: [] as string[],
    originalStatuses: {} as Partial<Record<'create' | 'chunk' | 'seal', number>> };
  const fetcher: typeof fetch = async (input, init) => {
    const url = new URL(String(input)); const kind = operation(url, init?.method);
    if (kind === 'chunk') controls.offsets.push(url.searchParams.get('offset') ?? '');
    else if (kind) controls[kind].push(String(init?.body));
    if (controls.create.length + controls.seal.length + controls.offsets.length > 16) throw new Error('Synthetic request limit');
    const response = await native(input, init);
    if (kind && !dropped.has(kind)) {
      controls.originalStatuses[kind] = response.status;
      dropped.add(kind); await response.body?.cancel(); throw new Error('Synthetic lost acknowledgement');
    }
    return response;
  };
  return { fetcher, controls };
}
function waitFor(gate: BrowserSessionGate, kind: SessionState['kind']): Promise<SessionState> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { off(); reject(new Error('Expected session state unavailable')); }, 5000);
    const check = () => { const state = gate.getSnapshot(); if (state.kind === kind) { off(); clearTimeout(timer); resolve(state); } };
    const off = gate.subscribe(check); check();
  });
}
async function namespace(api: ApiClient): Promise<Workspace> {
  const organization = await readResult(api.createOrganization({ body: { scope: { kind: 'installation' },
    requestId: randomUUID(), name: 'Owned controller smoke', slug: 'owned-controller-smoke' } }));
  return readResult(api.createWorkspace({ params: { organizationId: organization.id }, body: {
    scope: { kind: 'organization', organizationId: organization.id }, requestId: randomUUID(), name: 'Owned workspace' } }));
}
async function start(workflow: UploadWorkflow, file: File, workspace: Workspace, finished: Promise<void>): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    workflow.start(file, file.name, workspace.rootFolderId);
    await Promise.race([finished, new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => reject(new Error('Upload workflow did not settle')), 5000);
    })]);
  } finally { if (timer) clearTimeout(timer); }
}
async function upload(api: ApiClient, transfers: Extract<SessionState, { kind: 'paired' }>['transfers'], workspace: Workspace, empty = false) {
  let done!: () => void; const finished = new Promise<void>(resolve => { done = resolve; });
  const workflow = new UploadWorkflow({ api, transfers, workspace,
    changed: state => { if (!state.busy) done(); }, invalidate: () => undefined });
  const content = new Uint8Array(empty ? 0 : 65_543).fill(97);
  if (!empty) content.set(new TextEncoder().encode('synthetic π\n'));
  try {
    await start(workflow, new File([content], empty ? 'empty.bin' : 'owned.bin'), workspace, finished);
    if (!empty) {
      assert.equal(workflow.state.phase, 'replay-create'); await workflow.run('replay-create');
      assert.equal(workflow.state.phase, 'resume'); await workflow.run('resume');
      assert.equal(workflow.state.phase, 'refresh'); await workflow.run('refresh');
      assert.equal(workflow.state.record?.offset, 65_536); await workflow.run('resume');
      assert.equal(workflow.state.phase, 'replay-seal'); await workflow.run('replay-seal');
    }
    assert.equal(workflow.state.phase, 'complete'); const record = workflow.state.record;
    if (!record) throw new Error('Published record missing');
    assert.equal(record.sha256, createHash('sha256').update(content).digest('hex'));
    const result = await transfers.download({ record }); assert(result.ok, 'Verified download failed');
    assert.deepEqual(result.value, content);
  } finally { workflow.dispose(); }
}
await withBackend(async (origin, token) => {
  const { fetcher, controls } = transport(origin); const gate = new BrowserSessionGate({ baseUrl: origin, fetch: fetcher });
  gate.start();
  try {
    await waitFor(gate, 'unpaired'); gate.pair(token); const session = await waitFor(gate, 'paired');
    if (session.kind !== 'paired') throw new Error('Session unavailable');
    const workspace = await namespace(session.client);
    await upload(session.client, session.transfers, workspace);
    assert.deepEqual(controls.originalStatuses, { create: 201, chunk: 200, seal: 202 });
    assert.equal(controls.create.length, 2); assert.equal(controls.create[0], controls.create[1]);
    assert.equal(controls.seal.length, 2); assert.equal(controls.seal[0], controls.seal[1]);
    assert.deepEqual(controls.offsets, ['0', '65536']);
    await upload(session.client, session.transfers, workspace, true);
    const page = await readResult(session.client.listInputs({ params: {
      organizationId: workspace.scope.organizationId, workspaceId: workspace.id }, query: { limit: 100 } }));
    assert.equal(page.items.length, 2); assert(page.items.every(item => item.state === 'published'));
    gate.logout(); await waitFor(gate, 'unpaired');
    assert.deepEqual(await session.transfers.prepare({ file: new Blob([]) }), { ok: false, issued: false, error: { kind: 'closed' } });
    await session.transfers.close();
  } finally { gate.stop(); }
});
process.stdout.write('Input controller smoke passed: real pairing, lost create/chunk/seal acknowledgements, identical replay, committed-offset resume, empty input, verified downloads, logout and clean backend shutdown.\n');

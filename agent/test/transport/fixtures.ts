import { readFile } from 'node:fs/promises';
import { afterEach, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { AgentHttpOptions } from '../../src/transport/index.js';
import { createAgentServer } from '../../src/transport/index.js';
import type { AttemptSnapshot, Capabilities } from '@beetle/contracts';
import { journalFixture } from '../journal/fixtures.js';

export const credential = 'S'.repeat(64);
export function fixture() {
  const f = journalFixture(); const servers: FastifyInstance[] = [];
  afterEach(async () => { await Promise.all(servers.splice(0).map(server => server.close())); });
  return { ...f, async server() {
    const journal = await f.open(); const job = f.offer(); const key = f.key();
    const capabilities = JSON.parse(await readFile('contracts/fixtures/valid/capabilities.json', 'utf8')) as Capabilities;
    capabilities.journalAuthority = await journal.journalAuthority();
    let cap: () => Promise<Capabilities> = async () => capabilities;
    const enqueue = vi.fn(async (input: unknown) => ({ accepted: true as const, snapshot: await journal.immutableOffer(input) }));
    const cancel = vi.fn(async () => {
      await journal.supervision({ key, now: Date.now(), cancel: true }); return journal.get(key);
    });
    const cancelOriginal = vi.fn(async (offer: unknown) => journal.cancelOriginal({ offer, now: Date.now() }));
    const events = vi.fn(journal.readEvents.bind(journal));
    const options: AgentHttpOptions = { credential, journalAuthority: capabilities.journalAuthority, installation: { enqueue, cancel, cancelOriginal },
      journal: { get: input => journal.get(input), readEvents: events, acknowledge: input => journal.acknowledge(input) },
      capabilities: () => cap() };
    const server = createAgentServer(options); servers.push(server);
    const headers = { authorization: `Bearer ${credential}`, 'x-beetle-organization-id': key.organizationId,
      'x-beetle-workspace-id': key.workspaceId, 'x-beetle-journal-authority': capabilities.journalAuthority, 'x-beetle-generation': String(key.generation) };
    return { server, journal, job, key, headers, enqueue, cancel, cancelOriginal, events, capabilities,
      path: `/runner/v1/attempts/${key.attemptId}`, setCapabilities(value: typeof cap) { cap = value; },
      async store(): Promise<AttemptSnapshot> { return journal.immutableOffer(job); } };
  } };
}

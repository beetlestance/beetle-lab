import { afterEach, beforeAll } from 'vitest';
import { join } from 'node:path';
import { build } from 'tsup';
import { validate, validatePrimitive } from '@beetle/contracts';
import type { Ack, AckReceipt, AgentEvent, ControlEvent, Offer, ProtocolName } from '@beetle/contracts';
import { ChildChannel, record } from './child-channel.js';

export type AgentKey = Pick<Ack, 'attemptId' | 'organizationId' | 'workspaceId' | 'generation'>;
function checked<N extends ProtocolName>(name: N, value: unknown) {
  const result = validate(name, value);
  if (!result.ok) throw new Error('Invalid actual agent fixture reply');
  return result.value;
}
export interface Traffic { requests: string[]; receipts: AckReceipt[]; statuses: number[]; observations: unknown[] }
function requests(input: unknown): string[] {
  if (!Array.isArray(input) || input.length > 16 || !input.every(item => typeof item === 'string' && item.length <= 2056)) throw new Error('Agent request bound');
  return input as string[];
}
function statuses(input: unknown): number[] {
  if (!Array.isArray(input) || input.length > 16 || !input.every(item => Number.isSafeInteger(item) && item >= 100 && item <= 599)) throw new Error('Agent status bound');
  return input as number[];
}
export class AgentFixture {
  constructor(private readonly channel: ChildChannel) {}
  async journalAuthority(): Promise<string> {
    const value = await this.channel.call('authority');
    if (!validatePrimitive('uuid', value).ok || typeof value !== 'string') throw new Error('Invalid actual journal authority');
    return value;
  }
  async immutableOffer(input: Offer) { return checked('AttemptSnapshot', await this.channel.call('offer', input)); }
  async appendSupervisor(input: unknown): Promise<AgentEvent> { return checked('AgentEvent', await this.channel.call('appendSupervisor', input)); }
  async appendWrapper(input: ControlEvent): Promise<AgentEvent> { return checked('AgentEvent', await this.channel.call('appendWrapper', input)); }
  async readEvents(key: AgentKey, after: number) { return checked('EventBatch', await this.channel.call('events', { key: scopeKey(key), after })); }
  async acknowledge(input: Ack) { return checked('AckReceipt', await this.channel.call('ack', input)); }
  async prune(key: AgentKey) {
    const value = record(await this.channel.call('prune', scopeKey(key)));
    if (Object.keys(value).sort().join() !== 'pruned,snapshot' || !Number.isSafeInteger(value.pruned) || Number(value.pruned) < 0 || Number(value.pruned) > 100) throw new Error('Invalid prune reply');
    return { pruned: Number(value.pruned), snapshot: checked('AttemptSnapshot', value.snapshot) };
  }
  async listen(): Promise<string> {
    const value = await this.channel.call('listen');
    if (typeof value !== 'string' || !/^http:\/\/127\.0\.0\.1:\d{1,5}$/.test(value)) throw new Error('Invalid child origin');
    return value;
  }
  async configure(input: { loseAck: boolean; commitPath: string | null }): Promise<void> {
    if (await this.channel.call('configure', input) !== null) throw new Error('Invalid fault-config reply');
  }
  async traffic(): Promise<Traffic> {
    const value = record(await this.channel.call('traffic'));
    if (Object.keys(value).sort().join() !== 'fault,observations,receipts,requests,statuses' || value.fault !== null) throw new Error('Agent fixture traffic failure');
    if (!Array.isArray(value.receipts) || value.receipts.length > 8 || !Array.isArray(value.observations) || value.observations.length > 8) throw new Error('Agent observation bound');
    return { requests: requests(value.requests), statuses: statuses(value.statuses), observations: value.observations as unknown[],
      receipts: value.receipts.map(receipt => checked('AckReceipt', receipt)) };
  }
  async stopServer(): Promise<void> { if (await this.channel.call('stopServer') !== null) throw new Error('Invalid server-close reply'); }
  async inspect() {
    const value = record(await this.channel.call('inspect'));
    if (Object.keys(value).sort().join() !== 'attempts,rows' || !Array.isArray(value.attempts)
      || value.attempts.length > 2 || !Array.isArray(value.rows) || value.rows.length > 3) throw new Error('Invalid native journal inspection');
    return { attempts: value.attempts.map(attemptInspection), rows: value.rows.map(row => {
      const item = record(row);
      if (Object.keys(item).join() !== 'seq' || !Number.isSafeInteger(item.seq) || Number(item.seq) < 1) throw new Error('Invalid spool inspection');
      return { seq: Number(item.seq) };
    }) };
  }
  close(): Promise<void> { return this.channel.close(); }
}
function scopeKey(value: AgentKey): AgentKey {
  return { attemptId: value.attemptId, organizationId: value.organizationId, workspaceId: value.workspaceId, generation: value.generation };
}
function attemptInspection(input: unknown): Record<string, unknown> {
  const value = record(input);
  const numbers = ['last_seq', 'acknowledged_seq', 'retained_start_seq', 'spool_rows', 'spool_bytes'];
  if (Object.keys(value).sort().join() !== ['attempt_id', ...numbers].sort().join()
    || !validatePrimitive('uuid', value.attempt_id).ok) throw new Error('Invalid native attempt inspection');
  if (!numbers.every(key => Number.isSafeInteger(value[key]) && Number(value[key]) >= 0)) throw new Error('Invalid native attempt counters');
  return value;
}
export function agentProcessFixture(root: () => string) {
  let sequence = 0; let worker: string; const handles = new Set<AgentFixture>();
  beforeAll(async () => {
    const directory = root();
    if (!directory || directory.length > 4096) throw new Error('Invalid agent fixture root');
    const outDir = join(directory, 'agent-worker');
    await build({ entry: ['agent/src/journal/worker.ts'], outDir, format: ['esm'], platform: 'node', target: 'node24',
      bundle: true, noExternal: [/.*/], shims: true, removeNodeProtocol: false, splitting: false, silent: true });
    worker = join(outDir, 'worker.js');
  }, 20000);
  afterEach(async () => { const closing = [...handles]; handles.clear(); await Promise.all(closing.map(handle => handle.close())); });
  const path = () => join(root(), `agent-journal-${++sequence}.sqlite`);
  return { path, async open(journalPath = path()) {
    const channel = new ChildChannel({ root: root(), journal: journalPath, worker });
    const agent = new AgentFixture(channel); handles.add(agent);
    await channel.start(); return agent;
  }, async close(agent: AgentFixture) { await agent.close(); handles.delete(agent); } };
}

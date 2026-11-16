import {requireRuntimeAssociationResume} from './runtime-association.js';
import { performance } from 'node:perf_hooks';
import { encodeJson } from '@beetle/contracts';
import { mailboxOptions,mailboxVolumeName } from './live-channel.js';
import { record } from './inspect.js';
import type { RuntimePlan } from './prepare.js';
import type { DockerReply, DockerTransport, FailureReason, MutationResult, Operation } from './types.js';

const unknown = (reason: FailureReason): MutationResult<void> => ({outcome: 'unknown', reason});
const rejected = (reason: FailureReason): MutationResult<void> => ({outcome: 'rejected', reason});
const ready = (): MutationResult<void> => ({outcome: 'known', value: undefined});
/** One trusted daemon namespace; untrusted containers never receive the Docker socket. */
export class MailboxVolumeOwner {
  private claimed = false;
  private seen = false;
  private removed = false;
  private readonly name: string;
  private readonly labels: Readonly<Record<string, string>>;
  private readonly options: Readonly<Record<string, string>>;
  constructor(plan: RuntimePlan, private readonly transport: DockerTransport) {
    this.name = mailboxVolumeName(plan.name);
    this.labels = {...plan.spec.Labels, 'dev.beetle.purpose': 'live-mailbox'};
    this.options = mailboxOptions(plan.spec.User);
  }
  async prepare(operation: Operation): Promise<MutationResult<void>> {
    if (this.removed) return rejected('unsafe_state');
    const before = await this.inspect(operation);
    if (!before.ok) return unknown(before.reason);
    if (before.status === 200) {
      if (!this.matches(before.body)) return rejected('conflict');
      // Only our issued create can recover an existing volume without a container.
      if (!this.claimed || this.seen) return rejected('unsafe_state');
      this.seen = true; return ready();
    }
    if (before.status !== 404) return unknown('unavailable');
    if (this.claimed || this.seen) return unknown('unsafe_state');
    return this.create(operation);
  }
  private async create(operation: Operation): Promise<MutationResult<void>> {
    this.claimed = true;
    const created = await this.request({...operation, method: 'POST', path: '/v1.47/volumes/create',
      body: {Name: this.name, Driver: 'local', DriverOpts: this.options, Labels: this.labels}});
    if (!created.ok) return created.dispatched ? unknown(created.reason) : rejected(created.reason);
    if (created.status !== 201) return unknown('unavailable');
    return this.verify(operation);
  }
  /** Recovery adoption requires an already matched container, enforced by the backend. */
  async verify(operation: Operation): Promise<MutationResult<void>> {
    if (this.removed) return rejected('unsafe_state');
    const reply = await this.inspect(operation);
    if (!reply.ok) return unknown(reply.reason);
    if (reply.status !== 200) return unknown('unavailable');
    if (!this.matches(reply.body)) return rejected('conflict');
    this.seen = true; return ready();
  }
  restoreAssociation(token:object):void{requireRuntimeAssociationResume(token,this);this.seen=true;}
  /** Caller has stopped/removed its container and drained all archive originals. */
  remove(operation: Operation): Promise<MutationResult<void>> { return this.removeOwned(operation, false); }
  /** A cold missing container cannot establish association from a matching volume name. */
  removeRetired(operation: Operation): Promise<MutationResult<void>> { return this.removeOwned(operation, true); }
  private async removeOwned(operation: Operation, requireAssociation: boolean): Promise<MutationResult<void>> {
    if (this.removed) return ready();
    const before = await this.inspect(operation);
    if (!before.ok) return unknown(before.reason);
    if (before.status === 404) {this.removed = true; return ready();}
    if (before.status !== 200) return unknown('unavailable');
    if (!this.matches(before.body)) return rejected('conflict');
    if (requireAssociation && !this.seen) return rejected('cleanup_guard');
    const reply = await this.request({...operation, method: 'DELETE', path: `/v1.47/volumes/${this.name}?force=false`});
    if (!reply.ok) return unknown(reply.reason);
    if (![204, 404].includes(reply.status)) return unknown('unavailable');
    return this.confirmRemoved(operation);
  }
  private async confirmRemoved(operation: Operation): Promise<MutationResult<void>> {
    const after = await this.inspect(operation);
    if (!after.ok) return unknown(after.reason);
    if (after.status !== 404) return unknown('unavailable');
    this.removed = true; return ready();
  }
  private matches(input: unknown): boolean {
    const value = record(input);
    return !!value && value.Name === this.name && value.Driver === 'local' && value.Scope === 'local'
      && this.exact(value.Labels, this.labels) && this.exact(value.Options, this.options);
  }
  private exact(input: unknown, expected: Readonly<Record<string, string>>): boolean {
    const value = record(input);
    return !!value && Object.keys(value).length === Object.keys(expected).length
      && Object.entries(expected).every(([key, item]) => value[key] === item);
  }
  private inspect(operation: Operation): Promise<DockerReply> {
    return this.request({...operation, method: 'GET', path: `/v1.47/volumes/${this.name}`});
  }
  private async request(input: Parameters<DockerTransport['request']>[0]): Promise<DockerReply> {
    if (input.signal?.aborted) return {ok: false, reason: 'aborted', dispatched: false};
    if (performance.now() >= input.deadline) return {ok: false, reason: 'deadline', dispatched: false};
    try {
      const reply = await this.transport.request(input);
      if (input.signal?.aborted) return {ok: false, reason: 'aborted', dispatched: true};
      if (performance.now() >= input.deadline) return {ok: false, reason: 'deadline', dispatched: true};
      if (reply.ok) encodeJson(reply.body, 65536);
      return reply;
    } catch {return {ok: false, reason: 'unavailable', dispatched: true};}
  }
}

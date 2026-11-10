import type { CapacitySource, RuntimeObservation } from '../ports/runtime.js';
import type { RunnerGateway } from '../ports/runner.js';
import type { DeliveryRuntime } from '../ports/delivery.js';
import type { Metadata } from '../adapters/outbound/sqlite/index.js';
import { startDeliveryRuntime } from '../adapters/outbound/runner/index.js';
import { startRuntimePoller } from './runtime-poller.js';
import type { RuntimeFailureReason, RuntimePoller, RuntimePollerState } from './runtime-poller.js';
import { createRuntimePublisher } from './runtime-publication.js';
import type { RuntimePublisher } from './runtime-poller.js';
import { throwCloseFailures } from './application-close.js';

export interface AgentRuntime {
  state(): RuntimePollerState;
  close(): Promise<void>;
}
interface OwnerOptions {
  readonly source: CapacitySource;
  readonly gateway: RunnerGateway;
  readonly metadata: Pick<Metadata, 'dispatch' | 'runs' | 'updateRuntime'>;
}

function stop(close: () => Promise<void> | undefined): Promise<void> {
  try { return Promise.resolve(close()); } catch (error) { return Promise.reject(error); }
}

/** Owns the shared connection and the two loops, never metadata itself. */
class AgentOwners implements AgentRuntime {
  private poller: RuntimePoller | undefined;
  private delivery: DeliveryRuntime | undefined;
  private readonly publish: RuntimePublisher;
  private readonly closeSource: CapacitySource['close'];
  private readonly closeGateway: RunnerGateway['close'];
  private closed = false;
  private deliveryFailed = false;
  private producerFailure: RuntimeFailureReason | undefined;
  private deliveryDrain: Promise<PromiseSettledResult<void>[]> | undefined;
  private revocation: Promise<void> | undefined;
  private closing: Promise<void> | undefined;
  constructor(private readonly options: OwnerOptions) {
    this.publish = createRuntimePublisher(options.metadata);
    this.closeSource = options.source.close.bind(options.source);
    this.closeGateway = options.gateway.close.bind(options.gateway);
  }
  start(): void {
    this.poller = startRuntimePoller({ source: this.options.source,
      publish: observation => this.publishCapacity(observation), onFailure: reason => this.failProducer(reason) });
    this.delivery = startDeliveryRuntime({ store: this.options.metadata.dispatch,
      runs: this.options.metadata.runs, gateway: this.options.gateway,
      onFailure: () => this.failDelivery() });
  }
  private publishCapacity(observation: RuntimeObservation | null): Promise<boolean> {
    if (observation !== null && (this.deliveryFailed || this.producerFailure || this.closed)) return Promise.resolve(false);
    return this.publish(observation);
  }
  private failProducer(reason: RuntimeFailureReason): undefined {
    this.producerFailure ??= reason;
    // Do not await delivery from its producer: its failure callback may drain us.
    void this.stopDelivery();
    return undefined;
  }
  private stopDelivery(): Promise<PromiseSettledResult<void>[]> {
    this.deliveryDrain ??= Promise.allSettled([stop(() => this.delivery?.close())]);
    return this.deliveryDrain;
  }
  private failDelivery(): Promise<void> {
    // Fence before awaiting anything: an issued publication must drain before null.
    this.deliveryFailed = true;
    this.revocation ??= this.revokeAfterDrain();
    return this.revocation;
  }
  private async revokeAfterDrain(): Promise<void> {
    const stopped = await Promise.allSettled([Promise.resolve().then(() => this.poller?.close())]);
    const revoked = await Promise.allSettled([Promise.resolve().then(async () => {
      if (await this.publish(null) !== true) throw new Error('Runtime revocation refused');
    })]);
    throwCloseFailures([...stopped, ...revoked]);
  }
  state(): RuntimePollerState {
    const state = this.poller?.state() ?? { status: 'unknown' as const, sampling: false, reason: 'unavailable' as const };
    if (this.closed) return Object.freeze({ ...state, status: 'closed' });
    if (this.producerFailure) return Object.freeze({ ...state, status: 'failed', reason: this.producerFailure });
    if (this.deliveryFailed) return Object.freeze({ ...state, status: 'failed', reason: 'dispatch_failure' });
    return state;
  }
  close(): Promise<void> {
    if (this.closing) return this.closing;
    this.closed = true;
    // Initiate both stops together; shared I/O remains owned through both drains.
    const delivery = this.stopDelivery();
    const poller = Promise.allSettled([stop(() => this.poller ? this.poller.close() : this.closeSource())]);
    this.closing = Promise.resolve().then(async () => {
      const [delivered, sampled] = await Promise.all([delivery, poller]);
      const connection = await Promise.allSettled([Promise.resolve().then(this.closeGateway)]);
      throwCloseFailures([...delivered, ...sampled, ...connection]);
    });
    return this.closing;
  }
}

/** Once called, this factory owns source/gateway even when startup fails. */
export async function openAgentOwners(options: OwnerOptions): Promise<AgentRuntime> {
  const source = options.source; const gateway = options.gateway; const metadata = options.metadata;
  const closeSource = source.close.bind(source); const closeGateway = gateway.close.bind(gateway);
  let owner: AgentOwners | undefined;
  try {
    owner = new AgentOwners({ source, gateway, metadata }); owner.start();
    const current = owner;
    return Object.freeze({ state: () => current.state(), close: () => current.close() });
  }
  catch (error) {
    let results: PromiseSettledResult<unknown>[];
    if (owner) { const current = owner; results = await Promise.allSettled([stop(() => current.close())]); }
    else {
      const sourceResult = await Promise.allSettled([stop(closeSource)]);
      const gatewayResult = await Promise.allSettled([stop(closeGateway)]);
      results = [...sourceResult, ...gatewayResult];
    }
    throwCloseFailures([{ status: 'rejected', reason: error }, ...results]);
    throw error;
  }
}

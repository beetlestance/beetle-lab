import type { OutputByteStore } from '../ports/output-bytes.js';
import type { CapacitySource, RuntimeObservation } from '../ports/runtime.js';
import type { RunnerGateway } from '../ports/runner.js';
import type { DeliveryRuntime } from '../ports/delivery.js';
import type { OutputRuntime } from '../ports/output-runtime.js';
import type { DeliveryMetadata } from './output-parent/capture.js';
import { captureDeliveryMetadata, captureGateway } from './output-parent/capture.js';
import { startDeliveryRuntime } from '../adapters/outbound/runner/index.js';
import { startRuntimePoller } from './runtime-poller.js';
import type { RuntimeFailureReason, RuntimePoller, RuntimePollerState } from './runtime-poller.js';
import { createRuntimePublisher } from './runtime-publication.js';
import type { RuntimePublisher } from './runtime-poller.js';
import { throwCloseFailures } from './application-close.js';

export interface AgentRuntime {
  readonly publishedBytes?: Pick<OutputByteStore, 'read'>;
  state(): RuntimePollerState;
  close(): Promise<void>;
}
interface OwnerOptions {
  readonly source: CapacitySource;
  readonly gateway: RunnerGateway;
  readonly metadata: DeliveryMetadata;
  readonly openOutputs?: (onFailure: (error: unknown) => Promise<void>) => Promise<OutputRuntime>;
}

function stop(close: () => Promise<void> | undefined): Promise<void> {
  try { return Promise.resolve(close()); } catch (error) { return Promise.reject(error); }
}

/** Owns the shared connection and its loops, never metadata itself. */
class AgentOwners implements AgentRuntime {
  private poller: RuntimePoller | undefined;
  private delivery: DeliveryRuntime | undefined;
  private closeOutputs: OutputRuntime['close'] | undefined;
  private closeDelivery: DeliveryRuntime['close'] | undefined;
  private readonly publish: RuntimePublisher;
  private readonly closeSource: CapacitySource['close'];
  private readonly closeGateway: RunnerGateway['close'];
  private closed = false;
  private deliveryFailed = false;
  private outputFailure: { error: unknown } | undefined;
  private producerFailure: RuntimeFailureReason | undefined;
  private deliveryDrain: Promise<PromiseSettledResult<void>[]> | undefined;
  private outputDrain: Promise<PromiseSettledResult<void>[]> | undefined;
  private revocation: Promise<void> | undefined;
  private closing: Promise<void> | undefined;
  constructor(private readonly options: OwnerOptions) {
    this.publish = createRuntimePublisher(options.metadata);
    this.closeSource = options.source.close.bind(options.source);
    this.closeGateway = options.gateway.close.bind(options.gateway);
  }
  async start(): Promise<void> {
    if (this.options.openOutputs) {
      const outputs = await this.options.openOutputs(error => this.failOutputs(error));
      this.closeOutputs = outputs.close.bind(outputs);
      if (this.outputFailure) throw this.outputFailure.error;
    }
    this.poller = startRuntimePoller({ source: this.options.source,
      publish: observation => this.publishCapacity(observation), onFailure: reason => this.failProducer(reason) });
    this.delivery = startDeliveryRuntime({ store: this.options.metadata.dispatch,
      events: this.options.metadata.events, runs: this.options.metadata.runs, gateway: this.options.gateway,
      onFailure: () => this.failDelivery() });
    this.closeDelivery = this.delivery.close.bind(this.delivery);
    if (this.deliveryFailed || this.outputFailure) void this.stopDelivery();
  }
  handle(): AgentRuntime {
    if (this.outputFailure) throw this.outputFailure.error;
    return Object.freeze({ state: () => this.state(), close: () => this.close() });
  }
  private publishCapacity(observation: RuntimeObservation | null): Promise<boolean> {
    if (observation !== null && (this.deliveryFailed || this.outputFailure || this.producerFailure || this.closed)) return Promise.resolve(false);
    return this.publish(observation);
  }
  private failProducer(reason: RuntimeFailureReason): undefined {
    this.producerFailure ??= reason;
    // Do not await delivery from its producer: its failure callback may drain us.
    void this.stopDelivery();
    void this.stopOutputs();
    return undefined;
  }
  private stopDelivery(): Promise<PromiseSettledResult<void>[]> {
    if (!this.closeDelivery) return Promise.resolve([]);
    this.deliveryDrain ??= Promise.allSettled([stop(this.closeDelivery)]);
    return this.deliveryDrain;
  }
  private stopOutputs(): Promise<PromiseSettledResult<void>[]> {
    if (!this.closeOutputs) return Promise.resolve([]);
    this.outputDrain ??= Promise.allSettled([stop(this.closeOutputs)]);
    return this.outputDrain;
  }
  private failDelivery(): Promise<void> {
    // Fence before awaiting anything: an issued publication must drain before null.
    this.deliveryFailed = true;
    void this.stopOutputs();
    this.revocation ??= this.revokeAfterDrain();
    return this.revocation;
  }
  private failOutputs(error: unknown): Promise<void> {
    this.outputFailure ??= { error };
    // Callbacks only await capacity: awaiting either peer can form a cycle.
    void this.stopDelivery();
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
    if (this.outputFailure) return Object.freeze({ ...state, status: 'failed', reason: 'output_failure' });
    if (this.deliveryFailed) return Object.freeze({ ...state, status: 'failed', reason: 'dispatch_failure' });
    return state;
  }
  close(): Promise<void> {
    if (this.closing) return this.closing;
    this.closed = true;
    // Fence every loop synchronously; shared I/O remains owned through all drains.
    const delivery = this.stopDelivery();
    const output = this.stopOutputs();
    const poller = Promise.allSettled([stop(() => this.poller ? this.poller.close() : this.closeSource())]);
    this.closing = Promise.resolve().then(async () => {
      const [delivered, sampled, outputs] = await Promise.all([delivery, poller, output]);
      const revoked = await Promise.allSettled([this.revocation]);
      const connection = await Promise.allSettled([Promise.resolve().then(this.closeGateway)]);
      const failure: PromiseSettledResult<unknown>[] = this.outputFailure ? [{ status: 'rejected', reason: this.outputFailure.error }] : [];
      throwCloseFailures([...failure, ...delivered, ...sampled, ...outputs, ...revoked, ...connection]);
    });
    return this.closing;
  }
}

/** Once called, this factory owns source/gateway even when startup fails. */
export async function openAgentOwners(options: OwnerOptions): Promise<AgentRuntime> {
  const source = options.source; const gateway = options.gateway; const metadata = options.metadata;
  const openOutputs = options.openOutputs;
  const closeSource = source.close.bind(source); const closeGateway = gateway.close.bind(gateway);
  let owner: AgentOwners | undefined;
  try {
    const capturedSource = { sample: source.sample.bind(source), close: closeSource };
    const capturedMetadata = captureDeliveryMetadata(metadata);
    owner = new AgentOwners({ source: capturedSource, gateway: captureGateway(gateway), metadata: capturedMetadata,
      ...(openOutputs ? { openOutputs } : {}) });
    await owner.start();
    return owner.handle();
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

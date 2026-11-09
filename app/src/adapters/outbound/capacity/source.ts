import type { CapacitySource, CapacitySourceOptions, RuntimeObservation } from '../../../ports/runtime.js';
import type { AgentConnectionConfiguration, RunnerGateway } from '../../../ports/runner.js';
import { captureCapabilities, captureConfiguration, ceilings, checkFrame, requireCapacity } from './capabilities.js';
import { CapacityError, pinDisk } from './disk.js';
import type { BackendDisk, DiskPort } from './disk.js';
import { CapacityLease } from './lease.js';

class Source implements CapacitySource {
  private active: { promise: Promise<RuntimeObservation | null>; abort: AbortController } | undefined;
  private closed = false;
  private closing: Promise<void> | undefined;
  constructor(private readonly disk: BackendDisk, private readonly configuration: AgentConnectionConfiguration,
    private readonly gateway: RunnerGateway, private readonly lease: CapacityLease) {}
  sample(signal?: AbortSignal): Promise<RuntimeObservation | null> {
    if (this.closed || this.active !== undefined) return Promise.resolve(null);
    const abort = new AbortController();
    const cancel = () => { this.lease.revoke(); abort.abort(); };
    signal?.addEventListener('abort', cancel, { once: true });
    if (signal?.aborted) cancel();
    const promise = Promise.resolve().then(() => this.read(abort.signal)).finally(() => {
      signal?.removeEventListener('abort', cancel); this.active = undefined;
    });
    this.active = { promise, abort }; return promise;
  }
  private async read(signal: AbortSignal): Promise<RuntimeObservation | null> {
    const check = () => { if (this.closed || signal.aborted) throw new CapacityError(); };
    let source = -1;
    try {
      check(); const started = this.lease.time();
      const reply = await this.gateway.capabilities(signal); check();
      requireCapacity(reply.ok);
      const { frame, fingerprint } = captureCapabilities(reply.value);
      checkFrame(frame, this.configuration, this.lease.time());
      source = frame.observation.sampleStartedAtMs;
      const disk = await this.disk.sample(check);
      const now = this.lease.time(); checkFrame(frame, this.configuration, now); check();
      requireCapacity(disk.available > this.configuration.freeSpaceReserveBytes);
      const observedAtMs = Math.min(started, frame.observation.sampleStartedAtMs);
      const expiresAtMs = Math.min(frame.observation.expiresAtMs, observedAtMs + 1000);
      requireCapacity(now < expiresAtMs);
      return this.lease.accept(frame.observation.sampleStartedAtMs, fingerprint,
        { journalAuthority: frame.journalAuthority, ceilings: ceilings(frame, this.configuration, disk.total), observedAtMs, expiresAtMs,
          execution: { stagingBytes: frame.observation.pool.stagingBytes, perRunStagingBytes: frame.observation.perRunStagingBytes } });
    } catch { return this.lease.revoke(source); }
  }
  close(): Promise<void> {
    if (this.closing) return this.closing;
    this.closed = true; this.lease.revoke();
    const active = this.active;
    this.closing = Promise.resolve().then(async () => {
      await active?.promise; await this.disk.close();
    });
    active?.abort.abort(); return this.closing;
  }
}
/** Internal constructor accepts controlled native and clock seams for boundary tests. */
export async function openSource(options: CapacitySourceOptions, disk: DiskPort, wall: () => number): Promise<CapacitySource> {
  try {
    const configuration = captureConfiguration(options.configuration);
    return new Source(await pinDisk(options.dataRoot, disk), configuration, options.gateway, new CapacityLease(wall));
  } catch { throw new CapacityError(); }
}

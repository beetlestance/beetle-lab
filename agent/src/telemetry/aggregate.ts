import type { ResourceReading } from '../backends/docker/index.js';
import type { SupervisorInput } from '../journal/index.js';

export type ResourceSummary = Extract<SupervisorInput['event'], { kind: 'resource.summary' }>['payload'];
const increment = (value: number, count: number) => Math.min(Number.MAX_SAFE_INTEGER, value + count);
const maximum = (before: number | null, value: number | null) => value === null ? before : Math.max(before ?? 0, value);
function valid(value: number | null): boolean { return value === null || Number.isSafeInteger(value) && value >= 0; }

/** Constant-space sampled container aggregate, never a kernel lifetime peak. */
export class ResourceAggregate {
  private cpu: number | null = null;
  private memory: number | null = null;
  private pids: number | null = null;
  private lastSampleAt: string | null = null;
  private samples = 0;
  private missedSamples = 0;
  private reason: ResourceSummary['reason'] = 'unavailable';
  private previousCpu: number | null = null;
  private discontinuity: ResourceSummary['reason'] = null;
  constructor(private readonly controls: ResourceSummary['enforcedControls']) {}
  restarted(): void { this.discontinuity = 'restarted'; this.reason = 'restarted'; }
  miss(count = 1, reason: ResourceSummary['reason'] = 'unavailable'): void {
    this.missedSamples = increment(this.missedSamples, count); this.reason = reason;
  }
  observe(reading: ResourceReading, wall: number): void {
    if (![reading.cpuMillis, reading.memoryBytes, reading.pids].every(valid)) { this.miss(1, 'invalid'); return; }
    if (!Number.isSafeInteger(wall) || wall < 0 || wall > 8_640_000_000_000_000) { this.miss(1, 'clock'); return; }
    if ([reading.cpuMillis, reading.memoryBytes, reading.pids].every(value => value === null)) {
      this.miss(1, reading.reason ?? 'unavailable'); return;
    }
    this.captureCpu(reading.cpuMillis);
    if (reading.reason === 'counter_reset') this.discontinuity = 'counter_reset';
    this.memory = maximum(this.memory, reading.memoryBytes); this.pids = maximum(this.pids, reading.pids);
    this.samples = increment(this.samples, 1); this.lastSampleAt = new Date(wall).toISOString();
    this.reason = this.discontinuity ?? reading.reason;
  }
  private captureCpu(value: number | null): void {
    this.cpu = value;
    if (value !== null && this.previousCpu !== null && value < this.previousCpu) {
      this.discontinuity = 'counter_reset'; this.cpu = null;
    }
    this.previousCpu = value ?? this.previousCpu;
  }
  summary(): ResourceSummary {
    return { scope: 'container', source: 'docker-stats', cpuMillis: this.cpu, peakMemoryBytes: this.memory,
      peakPids: this.pids, outputBytes: null, enforcedControls: [...this.controls], lastSampleAt: this.lastSampleAt,
      samples: this.samples, missedSamples: this.missedSamples, reason: this.reason };
  }
}

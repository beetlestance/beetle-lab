import { encodeCanonicalJson, jsonNodeCount } from '@beetle/contracts';
import { LIVE_HISTORY_BYTES } from '@beetle/contracts/api';
import type { LiveMetricHistorySample } from '@beetle/contracts/api';
import { OutputFailure } from '../output/index.js';
interface Entry {
  value: LiveMetricHistorySample;
  bytes: number;
  nodes: number;
}
/** Compact actual selected windows; never synthesize percentile averages or lose endpoints. */
export class HistorySamples {
  private entries: Entry[] = [];
  private bytes = 65536;
  private nodes: number;
  constructor(metadata: unknown) {
    this.nodes = jsonNodeCount(metadata);
  }
  add(value: LiveMetricHistorySample): void {
    const entry = {
      value,
      bytes: Buffer.byteLength(encodeCanonicalJson(value, 65536)) + 1,
      nodes: jsonNodeCount(value),
    };
    while (
      this.entries.length >= 900 ||
      this.bytes + entry.bytes > LIVE_HISTORY_BYTES ||
      this.nodes + entry.nodes > 65536
    )
      this.compact();
    this.entries.push(entry);
    this.bytes += entry.bytes;
    this.nodes += entry.nodes;
  }
  private compact(): void {
    if (this.entries.length <= 1) throw new OutputFailure('output_limit');
    this.entries = this.entries.filter((entry, index) => {
      if (index % 2 === 0) return true;
      this.bytes -= entry.bytes;
      this.nodes -= entry.nodes;
      return false;
    });
  }
  values(): LiveMetricHistorySample[] {
    return this.entries.map((entry) => entry.value);
  }
}

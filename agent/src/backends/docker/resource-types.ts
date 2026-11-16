/** Raw Docker container values; null means unavailable, never measured zero. */
export interface ResourceReading {
  readonly cpuMillis: number | null;
  readonly memoryBytes: number | null;
  readonly pids: number | null;
  readonly reason: null | 'unavailable' | 'unsupported' | 'invalid' | 'counter_reset';
}

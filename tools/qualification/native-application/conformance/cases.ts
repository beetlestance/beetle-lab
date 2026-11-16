export function sourceCases(kind: string) {
 if (kind === 'long-stream') return [{id: 'long-stream', script: 'soak/run.ts', args: [] as string[], timeoutMs: 2160000}];
 if (kind !== 'conformance') throw Error('Unknown native source profile');
 return [
  ...['executors', 'thresholds', 'failures'].map(profile => ({id: 'engine-' + profile, script: 'parity/run.ts', args: ['default', profile], timeoutMs: 600000})),
  {id: 'requests-data', script: 'requests/run.ts', args: [] as string[], timeoutMs: 600000},
  ...['shared', 'isolated'].map(profile => ({id: 'parallel-' + profile, script: 'parallel/run.ts', args: ['default', profile], timeoutMs: 600000})),
 ];
}

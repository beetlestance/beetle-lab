import { performance } from 'node:perf_hooks';
import { ProvisionError } from './types.js';
import type { ProvisionRequest } from './types.js';
import { canonical, capture, fields } from './src/capture.js';
import { starterPolicy } from './starter/policy.js';

/** Explicit deployment inputs; policy values in the returned request remain editable. */
export interface StarterOptions {
  readonly root: string;
  readonly uid: number;
  readonly gid: number;
  readonly externalOrigin: string;
  readonly agentOrigin: string;
  readonly dockerSocket: string;
  readonly agentContainer: string;
  readonly agentImage: string;
  readonly engineImage: string;
  readonly targetNetwork: string;
}

/** Pure construction and existing provisioner validation; no inspection or IO. */
export function createStarterRequest(options: StarterOptions): ProvisionRequest {
  try {
    const capturedOptions = JSON.parse(canonical(options)) as StarterOptions;
    fields(capturedOptions, ['root', 'uid', 'gid', 'externalOrigin', 'agentOrigin', 'dockerSocket',
      'agentContainer', 'agentImage', 'engineImage', 'targetNetwork']);
    const request = { ...capturedOptions, ...starterPolicy() };
    // Capture owns scalar validation and bounded, detached JSON. This capability is
    // never used: only the provisioning entrypoint performs daemon inspection.
    return capture(request, {
      signal: new AbortController().signal, deadline: performance.now() + 30_000,
      agentWorkerUrl: new URL(import.meta.url), backendWorkerUrl: new URL(import.meta.url),
      docker: { request: async () => { throw new Error('Starter has no Docker capability'); } },
    }).request;
  } catch (cause) { throw new ProvisionError('invalid_input', { cause }); }
}

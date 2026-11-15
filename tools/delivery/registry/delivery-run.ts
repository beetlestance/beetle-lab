import {captureRun, captureJobs, captureArtifact} from '../trust.js';
import {readRunMetadata} from '../github.js';
import {object} from './descriptors.js';
import type {RegistryPlan} from './value.js';
const prefix = 'delivery/qualified-candidates / ';
const gates = [prefix + 'delivery/publish', ...['amd64', 'arm64'].map(arch => prefix + `delivery/anonymous-native (${arch})`)];
export function captureDeliveryRun(metadata: Awaited<ReturnType<typeof readRunMetadata>>, runId: number, revision: string, plan: RegistryPlan) {
  const run = captureRun(metadata.run, {runId, revision, workflowId: metadata.workflowId});
  captureJobs(metadata.jobs, run, gates);
  const page = object(metadata.artifacts);
  if (!Array.isArray(page.artifacts) || page.artifacts.length > 100 || page.total_count !== page.artifacts.length) throw Error('Incomplete delivery artifacts');
  const rows = page.artifacts.map(object);
  const names = [`rewrite-published-${plan.revision}-${plan.sourceRunId}`,
    ...['amd64', 'arm64'].map(arch => `rewrite-anonymous-${arch}-${plan.revision}-${plan.sourceRunId}`)];
  const artifacts = names.map(name => {
    const matches = rows.filter(row => row.name === name);
    if (matches.length !== 1) throw Error('Missing or duplicate anonymous delivery artifact');
    return captureArtifact(matches[0]!, run, name, 65536);
  });
  if (new Set(artifacts.map(row => row.id)).size !== 3) throw Error('Repeated delivery artifact ID');
  return artifacts;
}
export async function readDeliveryRun(runId: number, revision: string, plan: RegistryPlan) {
  return captureDeliveryRun(await readRunMetadata(runId, revision), runId, revision, plan);
}

import { createHash } from 'node:crypto';
import { encodeJson } from '@beetle/contracts';

/** Exact existing original-to-runtime mapping, shared by adapter and durable namespace. */
export function runtimeName(input: { installationId: string; organizationId: string;
  workspaceId: string; attemptId: string; generation: number }): string {
  const identity = [input.installationId, input.organizationId, input.workspaceId, input.attemptId]
    .map(value => value.toLowerCase());
  return `beetle-${createHash('sha256').update(encodeJson([...identity, input.generation], 65_536)).digest('hex')}`;
}


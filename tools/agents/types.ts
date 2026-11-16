export const models = ['gpt-6.1-sol', 'gpt-6-luna', 'gpt-6-astra', 'inherit'] as const;
export type AgentModel = typeof models[number];
export interface TaskPacket {
  packetVersion: 1;
  taskId: string;
  worktree: string;
  baseCommit: string;
  contractCommit: string;
  branch: string;
  model: AgentModel;
  role: 'worker' | 'reviewer';
  requiredTools: string[];
  locks: string[];
  allowedWrites: string[];
  requiredReads: { path: string; sha256: string }[];
  dependencyCommits: string[];
  acceptanceIds: string[];
  purpose: string;
  reportPath: string;
  packetHash: string;
}
export interface DispatchState {
  head: string;
  branch: string;
  acceptedCommits: ReadonlySet<string>;
  availableModels: readonly string[];
  dirtyPaths: readonly string[];
  /** Exact coordinator-approved review correction packets; never dependency acceptance. */
  correctionPackets?: ReadonlySet<string>;
}

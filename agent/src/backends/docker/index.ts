export { DockerBackend } from './backend.js';
export { prepareRuntime, runtimeName, RuntimePlan } from './prepare.js';
export { UnixDockerTransport, TRANSPORT_LIMITS } from './transport.js';
export type { RequestFactory } from './transport.js';
export type { CleanupEvidence, DockerReply, DockerRequest, DockerTransport, EffectiveImage, EntryPoint,
  InstallationProfile, InspectEvidence, MutationResult, Observation, Operation,
  PrepareInput, Result, StagedRoots } from './types.js';

export type FailureReason = 'invalid_input' | 'unsupported' | 'conflict' | 'unavailable'
  | 'deadline' | 'aborted' | 'request_limit' | 'response_limit' | 'malformed'
  | 'overflow' | 'start_fenced' | 'unsafe_state' | 'cleanup_guard' | 'rejected';
export interface Failure { readonly ok: false; readonly reason: FailureReason }
export type Result<T> = { readonly ok: true; readonly value: T } | Failure;
export const failure = (reason: FailureReason): Failure => ({ ok: false, reason });

export interface Operation { readonly deadline: number; readonly signal?: AbortSignal }
export interface DockerRequest extends Operation {
  readonly method: 'GET' | 'POST' | 'DELETE';
  readonly path: string;
  readonly body?: unknown;
}
export type DockerReply = { readonly ok: true; readonly status: number; readonly body: unknown }
  | (Failure & { readonly dispatched: boolean });
export interface MailboxArchiveRequest extends Operation {readonly containerId: string}
export type MailboxArchiveReply = {readonly ok: true; readonly status: number; readonly image: Uint8Array | null}
  | (Failure & {readonly dispatched: boolean});
export interface DockerTransport {
  request(input: DockerRequest): Promise<DockerReply>;
  readMailboxArchive?(input: MailboxArchiveRequest): Promise<MailboxArchiveReply>;
}
export interface EntryPoint { readonly executable: string; readonly arguments: readonly string[] }
export interface EffectiveImage {
  readonly imageDigest: string;
  readonly environment: readonly string[];
  readonly defaultRuntime: string;
}
export interface InstallationProfile {
  readonly installationId: string;
  readonly imageDigest: string;
  readonly effectiveImage: EffectiveImage;
  readonly entrypoint: EntryPoint;
  readonly user: string;
  readonly stagingRoot: string;
  readonly network: { readonly profile: 'none' | 'target-egress'; readonly name: string };
  readonly tmpfsBytes: number;
  /** Trusted image-install opt-in; never derived from an Offer or browser config. */
  readonly liveMetricMailbox?: boolean;
  readonly maximumBudget: Readonly<Record<'cpuMillis' | 'memoryBytes' | 'pids' | 'timeoutMs' | 'outputBytes', number>>;
}
/** Private trusted staging output: directories must match <stagingRoot>/<runtime name>/{input,output,secrets}. */
export interface StagedRoots { readonly input: string; readonly output: string; readonly secrets?: string }
export interface PrepareInput {
  readonly offer: unknown;
  readonly manifest: unknown;
  readonly profile: InstallationProfile;
  readonly generation: number;
  readonly staged: StagedRoots;
  readonly requireHardOutputQuota?: boolean;
}
export interface DockerMount {
  readonly Type: 'bind'; readonly Source: string; readonly Target: string;
  readonly ReadOnly: boolean;
  readonly BindOptions: { readonly Propagation: 'rprivate'; readonly NonRecursive: false;
    readonly CreateMountpoint: false; readonly ReadOnlyNonRecursive: false; readonly ReadOnlyForceRecursive: boolean };
}
export interface CreateSpec {
  readonly Image: string; readonly User: string; readonly Entrypoint: readonly string[];
  readonly Cmd: readonly string[]; readonly Env: readonly string[];
  readonly Healthcheck: { readonly Test: readonly ['NONE'] };
  readonly StopSignal: 'SIGTERM';
  readonly Labels: Readonly<Record<string, string>>;
  readonly WorkingDir: '/beetle/input'; readonly NetworkDisabled: boolean;
  readonly HostConfig: {
    readonly NanoCpus: number; readonly Memory: number; readonly MemorySwap: number;
    readonly PidsLimit: number; readonly ReadonlyRootfs: true; readonly Privileged: false;
    readonly Runtime: string; readonly OomKillDisable: false; readonly Init: false;
    readonly ShmSize: number;
    readonly CapDrop: readonly ['ALL']; readonly CapAdd: readonly [];
    readonly SecurityOpt: readonly ['no-new-privileges:true'];
    readonly PidMode: ''; readonly IpcMode: 'private'; readonly UTSMode: ''; readonly CgroupnsMode: 'private';
    readonly UsernsMode: ''; readonly GroupAdd: readonly []; readonly DeviceCgroupRules: readonly [];
    readonly Links: readonly []; readonly ExtraHosts: readonly []; readonly Dns: readonly [];
    readonly DnsOptions: readonly []; readonly DnsSearch: readonly [];
    readonly Sysctls: Readonly<Record<string, never>>; readonly StorageOpt: Readonly<Record<string, never>>;
    readonly ReadonlyPaths: readonly string[]; readonly MaskedPaths: readonly string[];
    readonly PublishAllPorts: false; readonly PortBindings: Readonly<Record<string, never>>;
    readonly Devices: readonly []; readonly DeviceRequests: readonly []; readonly Binds: readonly []; readonly VolumesFrom: readonly [];
    readonly NetworkMode: string; readonly RestartPolicy: { readonly Name: 'no'; readonly MaximumRetryCount: 0 };
    readonly AutoRemove: false; readonly Mounts: readonly DockerMount[];
    readonly Tmpfs: Readonly<Record<string, string>>;
    readonly LogConfig: { readonly Type: 'none'; readonly Config: Readonly<Record<string, string>> };
  };
}
export interface CleanupEvidence { readonly sealed: true; readonly applicationAcknowledged: true }
export interface InspectEvidence {
  readonly id: string;
  readonly state: 'created' | 'running' | 'exited' | 'restarting' | 'unknown';
  readonly exitCode: number | null;
  readonly oomKilled: boolean;
}
export type Observation = InspectEvidence | { readonly state: 'missing' }
  | { readonly state: 'unknown'; readonly reason: FailureReason };
export type MutationResult<T> = { readonly outcome: 'known'; readonly value: T }
  | { readonly outcome: 'unknown'; readonly reason: FailureReason }
  | { readonly outcome: 'rejected'; readonly reason: FailureReason };

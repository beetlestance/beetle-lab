import type { DockerVolumeMount, InstallationProfile } from './types.js';
const liveBytes = 131072;
export function validTemporaryProfile(profile: InstallationProfile): boolean {
  if (!Number.isSafeInteger(profile.tmpfsBytes) || profile.tmpfsBytes < 4096 || profile.tmpfsBytes > 67108864) return false;
  if (profile.liveMetricMailbox === undefined || profile.liveMetricMailbox === false) return true;
  return profile.liveMetricMailbox === true && profile.tmpfsBytes >= liveBytes + 4096;
}
/** Split an existing allowance; never grant additional temporary storage or memory. */
export function temporaryMounts(profile: InstallationProfile): Readonly<Record<string, string>> {
  const bytes = profile.tmpfsBytes - (profile.liveMetricMailbox ? liveBytes : 0);
  return {'/tmp': `rw,noexec,nosuid,nodev,size=${bytes},mode=1777`};
}
export function mailboxMount(profile: InstallationProfile, name: string): DockerVolumeMount[] {
  return profile.liveMetricMailbox ? [{Type: 'volume', Source: `${name}-live`, Target: '/beetle/live',
    ReadOnly: false, VolumeOptions: {NoCopy: true}}] : [];
}
export function mailboxOptions(user: string): Readonly<Record<string, string>> {
  const [uid, gid] = user.split(':');
  return {type: 'tmpfs', device: 'tmpfs',
    o: `rw,noexec,nosuid,nodev,size=${liveBytes},nr_inodes=4,uid=${uid},gid=${gid},mode=0700`};
}

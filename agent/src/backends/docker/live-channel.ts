import type { InstallationProfile } from './types.js';
const liveBytes = 131072;
export function validTemporaryProfile(profile: InstallationProfile): boolean {
  if (!Number.isSafeInteger(profile.tmpfsBytes) || profile.tmpfsBytes < 4096 || profile.tmpfsBytes > 67108864) return false;
  if (profile.liveMetricMailbox === undefined || profile.liveMetricMailbox === false) return true;
  return profile.liveMetricMailbox === true && profile.tmpfsBytes >= liveBytes + 4096;
}
/** Split an existing allowance; never grant additional temporary storage or memory. */
export function temporaryMounts(profile: InstallationProfile): Readonly<Record<string, string>> {
  if (!profile.liveMetricMailbox) return {'/tmp': `rw,noexec,nosuid,nodev,size=${profile.tmpfsBytes},mode=1777`};
  const [uid, gid] = profile.user.split(':');
  return {'/tmp': `rw,noexec,nosuid,nodev,size=${profile.tmpfsBytes - liveBytes},mode=1777`,
    '/beetle/live': `rw,noexec,nosuid,nodev,size=${liveBytes},nr_inodes=4,uid=${uid},gid=${gid},mode=0700`};
}

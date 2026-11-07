import type { InstallationProfile } from './types.js';

function validEnvironment(environment: readonly string[]): boolean {
  if (!Array.isArray(environment) || environment.length > 64) return false;
  const keys = new Set<string>();
  let bytes = 0;
  return environment.every(entry => {
    if (typeof entry !== 'string' || entry.length > 4096) return false;
    bytes += Buffer.byteLength(entry);
    const separator = entry.indexOf('=');
    const key = entry.slice(0, separator);
    if (separator < 1 || !/^[A-Za-z_][A-Za-z0-9_]{0,127}$/u.test(key) || keys.has(key)) return false;
    if (Array.from(entry).some(character => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127)) return false;
    keys.add(key);
    return bytes <= 16_384;
  });
}

/** Trusted install-time image inspection baseline, never derived from Offer.config or secret resolution. */
export function validImageBaseline(profile: InstallationProfile): boolean {
  const baseline = profile.effectiveImage;
  if (!baseline || baseline.imageDigest !== profile.imageDigest) return false;
  if (typeof baseline.defaultRuntime !== 'string' || !/^[a-z][a-z0-9_.-]{0,63}$/u.test(baseline.defaultRuntime)) return false;
  return validEnvironment(baseline.environment);
}

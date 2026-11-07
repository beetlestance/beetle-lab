import { fail } from './failure.js';
export function hasControl(value: string, maximum = 31): boolean {
  return [...value].some(char => char.charCodeAt(0) <= maximum || char.charCodeAt(0) === 127);
}
function validTargetParts(url: URL): boolean {
  return ['http:', 'https:'].includes(url.protocol) && !!url.hostname && !url.username
    && !url.password && !url.hash && !url.search;
}
/** Base URLs preserve a path prefix; all request paths append under that prefix. */
export function compileTarget(value: string): string {
  if (value.length > 4096 || /[\s\\?#]/.test(value) || hasControl(value)) fail('target', '/target');
  let url: URL;
  try { url = new URL(value); } catch { return fail('target', '/target'); }
  if (!validTargetParts(url)) fail('target', '/target');
  return url.href.replace(/\/$/, '');
}
function invalidPathCharacters(value: string): boolean {
  return /[\\?#]/.test(value) || hasControl(value, 32);
}
export function safeRelativePath(value: string): boolean {
  if (!value.startsWith('/') || value.startsWith('//') || invalidPathCharacters(value)) return false;
  let decoded: string;
  try { decoded = decodeURIComponent(value); } catch { return false; }
  return !invalidPathCharacters(decoded) && !decoded.startsWith('//')
    && !decoded.split('/').some(segment => segment === '.' || segment === '..');
}
export function safeHeaderName(value: string): boolean {
  return /^[!#$%&'*+.^_`|~0-9A-Za-z-]{1,128}$/.test(value);
}

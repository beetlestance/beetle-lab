import type { InputContentRange } from '../../../../ports/input-bytes.js';

function bounds(first: string, last: string, size: number): InputContentRange | false {
  if (first === '') {
    const suffix = Number(last);
    return suffix > 0 ? { start: Math.max(0, size - suffix), endExclusive: size } : false;
  }
  const start = Number(first);
  const endExclusive = last === '' ? size : Math.min(size, Number(last) + 1);
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(endExclusive) || start >= endExclusive || start >= size) return false;
  return { start, endExclusive };
}
export function selectRange(text: string | undefined, size: number): InputContentRange | undefined | false {
  if (text === undefined) return undefined;
  const match = /^bytes=([0-9]*)-([0-9]*)$/.exec(text);
  if (!match || !size) return false;
  return bounds(match[1]!, match[2]!, size);
}

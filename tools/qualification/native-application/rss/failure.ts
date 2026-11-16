import {shortFailure} from '../load/failure.js';
/** Fixed source coordinates only; never expose raw Docker command/output text. */
export function rssFailure(error: unknown) {
 const known = shortFailure(error); if (!(error instanceof Error)) return known;
 const match = /native-application\/rss\/(capture|observe|run)\.(?:ts|js):(\d{1,4}):(\d{1,4})\b/.exec(error.stack ?? '');
 return {...known, site: match ? {file: 'rss-' + match[1]!, line: Number(match[2]), column: Number(match[3])} : known.site};
}

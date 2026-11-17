import { createHash } from 'node:crypto';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Astro hashes the scripts it bundles, but not Starlight's `is:inline` scripts.
// After the build, add a hash for every inline script to that page's CSP meta tag,
// so the policy can stay hash-based instead of allowing 'unsafe-inline'.
const META = /(<meta http-equiv="content-security-policy" content="[^"]*?script-src )([^;"]*)/;
const INLINE = /<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g;

const sha = (body) => `'sha256-${createHash('sha256').update(body).digest('base64')}'`;

export function addInlineHashes(html) {
  const match = html.match(META);
  if (!match) throw new Error('page has no CSP meta tag with script-src');
  const sources = new Set(match[2].trim().split(/\s+/));
  for (const [, body] of html.matchAll(INLINE)) sources.add(sha(body));
  return html.replace(META, `$1${[...sources].join(' ')}`);
}

async function* pages(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) yield* pages(path);
    else if (entry.name.endsWith('.html')) yield path;
  }
}

export function cspInlineHashes() {
  return {
    name: 'csp-inline-hashes',
    hooks: {
      'astro:build:done': async ({ dir, logger }) => {
        let count = 0;
        for await (const file of pages(fileURLToPath(dir))) {
          await writeFile(file, addInlineHashes(await readFile(file, 'utf8')));
          count += 1;
        }
        logger.info(`hashed inline scripts in ${count} pages`);
      },
    },
  };
}

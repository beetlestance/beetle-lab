// Builds dist/gallery/index.html: every baseline next to the Penpot board it should match.
// Usage: node web/visual/gallery.mjs [<directory of board PNG exports named by slug>]
// Board slugs come from the Board column of CASES.md ("Run result / Failed" → run-result-failed).
import { copyFile, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { basename, join, relative } from 'node:path';
import process from 'node:process';
import { URL } from 'node:url';

const here = new URL('.', import.meta.url).pathname;
const boards = process.argv[2];
const out = join(here, 'dist/gallery');
const slug = (name) =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

async function walk(dir) {
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
  const nested = await Promise.all(
    entries.map((e) => (e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)])),
  );
  return nested.flat();
}

/** case id → { section, board, status, note } from CASES.md lines `- [x] id — Board — note — viewports`. */
async function cases() {
  const map = new Map();
  let section = '';
  for (const line of (await readFile(join(here, 'CASES.md'), 'utf8')).split('\n')) {
    if (line.startsWith('## ')) section = line.slice(3).replace(/ — .*/, '');
    const match = /^- \[(.)\] (\S+) — (.*?) — (.*)$/.exec(line);
    if (match) map.set(match[2], { section, status: match[1], board: match[3].trim(), note: match[4] });
  }
  return map;
}

/** Exact case id, else the longest listed id the snapshot name starts with (extras, "a / -b" rows). */
function findCase(map, name) {
  const id = name.replace(/-(desktop|phone|tablet|ultrawide)$/, '');
  if (map.has(id)) return { id, ...map.get(id) };
  const prefix = [...map.keys()].filter((key) => id.startsWith(`${key}-`)).sort((a, b) => b.length - a.length)[0];
  return prefix ? { id, ...map.get(prefix) } : { id, section: 'Unlisted', status: '?', board: '—', note: '' };
}

/**
 * Board export for a case: the Board column, or for "Group / …" rows the group plus the case's variant suffix.
 * Phone, tablet and ultrawide shots prefer their device board ("Phone / Overview") when one exists.
 */
function boardFor(info, viewport) {
  if (!boards || info.board === '—') return '';
  const board = info.board.split(' + ')[0];
  const base = board.includes('…')
    ? [`${slug(board.replace('…', ''))}-${info.id.split('-').slice(-1)[0]}`, slug(board.replace('…', ''))]
    : [slug(board)];
  const device = viewport === 'desktop' ? [] : base.map((c) => `${viewport}-${c}`);
  return [...device, ...base].map((c) => join(boards, `${c}.png`)).find((f) => existsSync(f)) ?? '';
}

const escape = (text) => text.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

async function main() {
  await rm(out, { recursive: true, force: true });
  await mkdir(join(out, 'img'), { recursive: true });
  const map = await cases();
  const shots = (await walk(join(here, 'baselines'))).filter((f) => f.endsWith('.png')).sort();
  const rows = [];
  for (const file of shots) {
    const [skin] = relative(join(here, 'baselines'), file).split('/');
    const name = basename(file, '.png');
    const info = findCase(map, name);
    const target = `img/${skin}-${name}.png`;
    await copyFile(file, join(out, target));
    let board = '';
    const boardFile = boardFor(info, /-(phone|tablet|ultrawide)$/.exec(name)?.[1] ?? 'desktop');
    if (boardFile) {
      board = `img/board-${basename(boardFile)}`;
      await copyFile(boardFile, join(out, board));
    }
    rows.push({ ...info, skin, name, target, boardImage: board });
  }
  await writeFile(join(out, 'index.html'), page(rows));
  process.stdout.write(`${rows.length} screenshots → ${join(out, 'index.html')}\n`);
}

function page(rows) {
  const sections = [...new Set(rows.map((r) => r.section))].sort();
  const body = sections
    .map((section) => {
      const items = rows
        .filter((r) => r.section === section)
        .map(
          (
            r,
          ) => `<article data-skin="${r.skin}"><h3>${escape(r.name)} <small>${r.skin} · [${escape(r.status)}] · ${escape(r.board)}</small></h3>
<p>${escape(r.note)}</p><div class="pair"><figure><figcaption>App</figcaption><a href="${r.target}"><img loading="lazy" src="${r.target}"></a></figure>
${r.boardImage ? `<figure><figcaption>Penpot</figcaption><a href="${r.boardImage}"><img loading="lazy" src="${r.boardImage}"></a></figure>` : ''}</div></article>`,
        )
        .join('\n');
      return `<section><h2>${escape(section)}</h2>${items}</section>`;
    })
    .join('\n');
  return `<!doctype html><meta charset="utf-8"><title>Beetle screenshots</title>
<style>body{font:14px system-ui;background:#111;color:#ddd;margin:16px}h2{border-bottom:1px solid #444}
article{margin:24px 0}.pair{display:grid;grid-template-columns:1fr 1fr;gap:12px}img{width:100%;border:1px solid #333}
small{color:#999;font-weight:normal}label{margin-right:12px}body.dark article[data-skin=scarab],body.light article[data-skin=darkroom]{display:none}</style>
<p><label><input type="radio" name="s" onclick="document.body.className='dark'" checked> Darkroom</label>
<label><input type="radio" name="s" onclick="document.body.className='light'"> Scarab</label>
<label><input type="radio" name="s" onclick="document.body.className=''"> Both</label></p>
<script>document.body.className='dark'</script>${body}`;
}

await main();

import { readFile } from 'node:fs/promises';
import { expect, it } from 'vitest';
import { skinDriftIssues, skinTokens } from './site-skins.js';

const app = skinTokens(`
:root,
:root[data-theme='darkroom'] { color-scheme: dark; --bg: #161412; --ink: #ECE4D6; --history-ink: #8fb8de; }
:root[data-theme='scarab'] { --bg: #0e1513; --ink: #e2ebe5; }
:root { --s-4: 4px; }
`);

it('reads skin blocks and ignores comments, other selectors and case', () => {
  expect([...app.darkroom]).toEqual([
    ['--bg', '#161412'],
    ['--ink', '#ece4d6'],
    ['--history-ink', '#8fb8de'],
  ]);
  expect(app.scarab.get('--bg')).toBe('#0e1513');
  expect(skinTokens(":root { /* :root[data-theme='scarab'] { */ --bg: #000; }").scarab.size).toBe(0);
});

it('accepts equal values, docs-only tokens and app tokens that Scarab does not redefine', () => {
  const docs = skinTokens(`
:root, :root[data-theme='darkroom'] { --bg: #161412; --history-ink: #8fb8de; --doc-code: #e9c68f; }
:root[data-theme='scarab'] { --bg: #0e1513; --doc-code: #a9dcc0; }`);
  expect(skinDriftIssues(app, docs)).toEqual([]);
});

it('reports drifted, unknown and missing Scarab tokens', () => {
  const docs = skinTokens(`
:root[data-theme='darkroom'] { --bg: #161413; --panel: #211e1a; --ink: #ece4d6; --doc-code: #e9c68f; }
:root[data-theme='scarab'] { --bg: #0e1513; }`);
  expect(skinDriftIssues(app, docs)).toEqual([
    'darkroom: --bg is #161413 in the docs but #161412 in the app',
    'darkroom: --panel is not an app token; name docs-only tokens --doc-*',
    'scarab: --ink is missing, so Scarab would show the Darkroom value',
    'scarab: --doc-code is missing, so Scarab would show the Darkroom value',
  ]);
  expect(skinDriftIssues(app, skinTokens(''))).toEqual(['darkroom: the docs declare no skin tokens']);
});

it('keeps the docs site skins equal to the app tokens', async () => {
  const appCss = await readFile('web/src/styles/tokens.css', 'utf8');
  const docsCss = await readFile('site/src/styles/skins.css', 'utf8');
  expect(skinDriftIssues(skinTokens(appCss), skinTokens(docsCss))).toEqual([]);
});

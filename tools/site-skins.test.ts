import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { skinDriftIssues, skinTokens, contrastIssues, contrastRatio, undefinedTokenIssues } from './site-skins.js';

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

describe('docs text contrast and token references', () => {
  const skins = (darkroom: Record<string, string>, scarab: Record<string, string> = {}) => ({
    darkroom: new Map(Object.entries(darkroom)),
    scarab: new Map(Object.entries(scarab)),
  });
  const passing = {
    '--ink': '#ece4d6',
    '--bg': '#161412',
    '--panel': '#211e1a',
    '--mute': '#a99f90',
    '--on-amber': '#1d1408',
    '--amber': '#f2a541',
    '--doc-code': '#e9c68f',
    '--green': '#9fcf8a',
    '--red': '#ff7f6b',
    '--info': '#8db4e8',
  };

  it('accepts AA pairs and names a pair under 4.5:1 per skin', () => {
    expect(contrastIssues(skins(passing))).toEqual([]);
    expect(contrastIssues(skins(passing, { '--on-amber': '#ffffff', '--amber': '#5ee0a0' }))).toEqual([
      expect.stringMatching(/^scarab: --on-amber on --amber is 1\.\d\d:1, under 4\.5:1$/),
    ]);
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21);
  });

  it('names var() references nothing declares, ignoring fallbacks and Starlight tokens', () => {
    const sources = new Map([
      ['a.astro', '.x { color: var(--bl-accent-ink); background: var(--sl-color-accent); border: var(--y, red); }'],
      ['b.css', ':root { --z: 1px; } .y { width: var(--z); }'],
    ]);
    expect(undefinedTokenIssues(sources)).toEqual(['a.astro: --bl-accent-ink is used but never declared']);
  });
});

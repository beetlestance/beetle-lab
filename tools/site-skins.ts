/** Keeps the docs site's skin colours (site/src/styles/skins.css) equal to the app's (web/src/styles/tokens.css). */
export const SKINS = ['darkroom', 'scarab'] as const;
export type Skin = (typeof SKINS)[number];
export type SkinTokens = Record<Skin, Map<string, string>>;

/** Prefix for docs-only tokens, which have no app counterpart. */
export const DOCS_ONLY = '--doc-';

function skinOf(selector: string): Skin | undefined {
  return SKINS.find((skin) => selector.includes(`data-theme='${skin}']`));
}

/** Custom properties declared in rule blocks whose selector names a skin; later declarations win. */
export function skinTokens(css: string): SkinTokens {
  const tokens: SkinTokens = { darkroom: new Map(), scarab: new Map() };
  const source = css.replace(/\/\*[\s\S]*?\*\//g, '');
  for (const [, selector, body] of source.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const skin = skinOf(selector!);
    if (!skin) continue;
    for (const [, name, value] of body!.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g))
      tokens[skin].set(name!, value!.trim().replace(/\s+/g, ' ').toLowerCase());
  }
  return tokens;
}

function skinIssues(skin: Skin, app: SkinTokens, docs: SkinTokens): string[] {
  const issues: string[] = [];
  for (const [name, value] of docs[skin]) {
    if (name.startsWith(DOCS_ONLY)) continue;
    const expected = app[skin].get(name);
    if (expected === undefined)
      issues.push(`${skin}: ${name} is not an app token; name docs-only tokens ${DOCS_ONLY}*`);
    else if (expected !== value) issues.push(`${skin}: ${name} is ${value} in the docs but ${expected} in the app`);
  }
  return issues;
}

/** Returns one message per drift; an empty list means the docs skins match the app. */
export function skinDriftIssues(app: SkinTokens, docs: SkinTokens): string[] {
  const issues = SKINS.flatMap((skin) => skinIssues(skin, app, docs));
  if (!docs.darkroom.size) issues.push('darkroom: the docs declare no skin tokens');
  // A Darkroom token the app redefines for Scarab must be redefined in the docs too, or Scarab shows Darkroom's value.
  for (const name of docs.darkroom.keys()) {
    const needed = name.startsWith(DOCS_ONLY) || app.scarab.has(name);
    if (needed && !docs.scarab.has(name))
      issues.push(`scarab: ${name} is missing, so Scarab would show the Darkroom value`);
  }
  return issues;
}

/** Foreground/background token pairs the docs use for text; each must reach WCAG AA (4.5:1). */
export const TEXT_PAIRS: readonly (readonly [string, string])[] = [
  ['--ink', '--bg'],
  ['--ink', '--panel'],
  ['--mute', '--bg'],
  ['--mute', '--panel'],
  ['--on-amber', '--amber'],
  ['--amber', '--panel'],
  ['--doc-code', '--panel'],
  ['--green', '--panel'],
  ['--red', '--panel'],
  ['--info', '--panel'],
];

function luminance(hex: string): number {
  const channel = (offset: number) => {
    const value = parseInt(hex.slice(offset, offset + 2), 16) / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
}
export function contrastRatio(foreground: string, background: string): number {
  const [high, low] = [luminance(foreground), luminance(background)].sort((a, b) => b - a);
  return (high! + 0.05) / (low! + 0.05);
}

/** One message per text pair under 4.5:1 in a skin; Scarab falls back to Darkroom values. */
export function contrastIssues(docs: SkinTokens): string[] {
  const issues: string[] = [];
  for (const skin of SKINS)
    for (const [fg, bg] of TEXT_PAIRS) {
      const value = (name: string) => docs[skin].get(name) ?? docs.darkroom.get(name);
      const [foreground, background] = [value(fg), value(bg)];
      if (!foreground?.match(/^#[0-9a-f]{6}$/) || !background?.match(/^#[0-9a-f]{6}$/)) {
        issues.push(`${skin}: ${fg} on ${bg} needs two #rrggbb tokens`);
        continue;
      }
      const ratio = contrastRatio(foreground, background);
      if (ratio < 4.5) issues.push(`${skin}: ${fg} on ${bg} is ${ratio.toFixed(2)}:1, under 4.5:1`);
    }
  return issues;
}

/** `var(--x)` references without a fallback whose property no site stylesheet or component declares. */
export function undefinedTokenIssues(sources: ReadonlyMap<string, string>, external = /^--sl-/): string[] {
  const declared = new Set<string>();
  for (const text of sources.values()) for (const [, name] of text.matchAll(/(--[\w-]+)\s*:/g)) declared.add(name!);
  const issues: string[] = [];
  for (const [file, text] of sources)
    for (const [, name] of text.matchAll(/var\((--[\w-]+)\s*\)/g))
      if (!declared.has(name!) && !external.test(name!)) issues.push(`${file}: ${name} is used but never declared`);
  return [...new Set(issues)];
}

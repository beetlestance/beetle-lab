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

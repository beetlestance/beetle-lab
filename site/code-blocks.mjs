import { readFileSync } from 'node:fs';
import { ExpressiveCodeTheme } from '@astrojs/starlight/expressive-code';
import { h } from '@astrojs/starlight/expressive-code/hast';

// Code blocks as in the Penpot "Docs" boards: a bar with the language and a Copy
// button above the code, and syntax colours taken from the skin tokens, so each
// skin gets its own highlighting theme (Darkroom is the base, Scarab is scoped to
// [data-theme='scarab']).

/** Skin tokens from skins.css, by skin; check:site-docs keeps them equal to the app's. */
function skinColours() {
  const css = readFileSync(new URL('./src/styles/skins.css', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  const skins = { darkroom: {}, scarab: {} };
  for (const [, selector, body] of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const skin = Object.keys(skins).find((name) => selector.includes(`data-theme='${name}'`));
    if (skin) for (const [, name, value] of body.matchAll(/--([\w-]+)\s*:\s*(#[0-9a-f]{6})\s*;/gi)) skins[skin][name] = value;
  }
  return skins;
}

function codeTheme(name, c) {
  const rule = (scope, foreground) => ({ scope, settings: { foreground } });
  return new ExpressiveCodeTheme({
    name,
    type: 'dark',
    colors: { 'editor.background': c.panel, 'editor.foreground': c.ink },
    tokenColors: [
      rule(['comment', 'punctuation.definition.comment'], c.mute),
      rule(['string', 'punctuation.definition.string', 'variable', 'variable.other'], c.amber),
      rule(['constant.other.option', 'variable.parameter', 'punctuation', 'keyword.operator'], c.mute),
      rule(['constant.numeric', 'constant.language'], c['doc-code']),
      rule(['support.type.property-name', 'entity.name', 'support.function', 'keyword', 'meta.embedded'], c.ink),
      // Bare shell words (subcommands, paths) read as plain text, as on the boards.
      rule(['string.unquoted.argument', 'string.unquoted.heredoc'], c.ink),
    ],
  });
}

export const skins = skinColours();
export const codeThemes = [codeTheme('darkroom', skins.darkroom), codeTheme('scarab', skins.scarab)];

/** Writes the block's language into the frame header, which the theme shows as a bar. */
export const languageLabel = {
  name: 'Beetle language label',
  hooks: {
    postprocessRenderedBlock: ({ codeBlock, renderData }) => {
      const header = findHeader(renderData.blockAst);
      if (header && codeBlock.language) header.children.unshift(h('span', { className: ['bl-lang'] }, codeBlock.language));
    },
  },
};

function findHeader(node) {
  if (node.type === 'element' && node.tagName === 'figcaption') return node;
  for (const child of node.children ?? []) {
    const found = findHeader(child);
    if (found) return found;
  }
  return undefined;
}

import process from 'node:process';
import { defineConfig } from 'astro/config';
import { unified } from '@astrojs/markdown-remark';
import starlight from '@astrojs/starlight';
import starlightLinksValidator from 'starlight-links-validator';
import { cspInlineHashes } from './csp-inline-hashes.mjs';
import { remarkBaseLinks } from './remark-base-links.mjs';

// In the app the docs are served under /docs; the public build sets DOCS_SITE and DOCS_BASE.
const base = process.env.DOCS_BASE ?? '/docs';

export default defineConfig({
  site: process.env.DOCS_SITE,
  base,
  trailingSlash: 'always',
  // Every page gets a CSP meta tag hashing its inline scripts (see csp-inline-hashes.mjs);
  // nginx sends the remaining directives as a header.
  security: {
    csp: {
      scriptDirective: { resources: ["'self'", "'wasm-unsafe-eval'"] },
      styleDirective: { resources: ["'self'", "'unsafe-inline'"] },
    },
  },
  // Never inline assets as data: URLs; the CSP allows fonts and images from 'self' only.
  vite: { build: { assetsInlineLimit: 0 } },
  markdown: { processor: unified({ remarkPlugins: [remarkBaseLinks(base)] }) },
  integrations: [
    starlight({
      title: 'Beetle Lab',
      logo: { light: './src/assets/logo-light.svg', dark: './src/assets/logo.svg', alt: '' },
      customCss: ['./src/styles/theme.css', './src/styles/custom.css'],
      expressiveCode: {
        themes: ['vitesse-dark', 'vitesse-light'],
        styleOverrides: {
          borderRadius: '10px',
          borderColor: 'transparent',
          codeFontFamily: 'var(--sl-font-mono)',
          codeFontSize: '0.8125rem',
          codeBackground: 'var(--bl-surface)',
          uiFontFamily: 'var(--sl-font)',
          frames: {
            editorTabBarBackground: 'var(--bl-zebra)',
            terminalTitlebarBackground: 'var(--bl-zebra)',
            terminalBackground: 'var(--bl-surface)',
            frameBoxShadowCssValue: 'none',
          },
        },
      },
      description: 'Self-hosted k6 performance testing with isolated execution and trustworthy results.',
      social: [{ icon: 'github', label: 'GitHub', href: 'https://github.com/beetlestance/beetle-lab' }],
      plugins: [starlightLinksValidator({ errorOnLocalLinks: false, errorOnRelativeLinks: false })],
      sidebar: [
        { label: 'Start', items: [{ autogenerate: { directory: 'start' } }] },
        { label: 'Concepts', items: [{ autogenerate: { directory: 'concepts' } }] },
        { label: 'Guides', items: [{ autogenerate: { directory: 'guides' } }] },
        { label: 'Reference', items: [{ autogenerate: { directory: 'reference' } }] },
      ],
      lastUpdated: false,
      pagination: true,
    }),
    cspInlineHashes(),
  ],
});

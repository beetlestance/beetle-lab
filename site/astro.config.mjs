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
  markdown: { processor: unified({ remarkPlugins: [remarkBaseLinks(base)] }) },
  integrations: [
    starlight({
      title: 'Beetle Lab',
      customCss: ['./src/styles/custom.css'],
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

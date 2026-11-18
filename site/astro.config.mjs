import process from 'node:process';
import { defineConfig } from 'astro/config';
import { unified } from '@astrojs/markdown-remark';
import starlight from '@astrojs/starlight';
import starlightLinksValidator from 'starlight-links-validator';
import { codeThemes, languageLabel } from './code-blocks.mjs';
import { cspInlineHashes } from './csp-inline-hashes.mjs';
import { remarkBaseLinks } from './remark-base-links.mjs';

// In the app the docs are served under /docs; the public build sets DOCS_SITE and DOCS_BASE.
// An empty DOCS_BASE (a site at the root of its domain) means '/'.
const base = process.env.DOCS_BASE === undefined ? '/docs' : process.env.DOCS_BASE || '/';
// "Open the app" in the header: the app root when the docs ship inside the app, and
// DOCS_APP_URL on the public build (no link when it is unset).
const appUrl = process.env.DOCS_APP_URL ?? (process.env.DOCS_BASE === undefined ? '/' : '');

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
  vite: { build: { assetsInlineLimit: 0 }, define: { 'import.meta.env.DOCS_APP_URL': JSON.stringify(appUrl) } },
  markdown: { processor: unified({ remarkPlugins: [remarkBaseLinks(base)] }) },
  integrations: [
    starlight({
      title: 'Beetle Lab',
      customCss: [
        './src/styles/skins.css',
        './src/styles/theme.css',
        './src/styles/header.css',
        './src/styles/navigation.css',
        './src/styles/chrome.css',
        './src/styles/custom.css',
        './src/styles/diagrams.css',
      ],
      // Board chrome: section tabs, Darkroom/Scarab switch, flat sidebar, phone page bar.
      components: {
        Header: './src/components/chrome/Header.astro',
        SiteTitle: './src/components/chrome/SiteTitle.astro',
        ThemeProvider: './src/components/chrome/ThemeProvider.astro',
        ThemeSelect: './src/components/chrome/Empty.astro',
        SocialIcons: './src/components/chrome/Empty.astro',
        PageFrame: './src/components/chrome/PageFrame.astro',
        MobileMenuToggle: './src/components/chrome/MobileMenuToggle.astro',
        MobileMenuFooter: './src/components/chrome/MobileMenuFooter.astro',
        Sidebar: './src/components/chrome/Sidebar.astro',
        TwoColumnContent: './src/components/chrome/TwoColumnContent.astro',
        PageSidebar: './src/components/chrome/PageSidebar.astro',
        PageTitle: './src/components/chrome/PageTitle.astro',
        Pagination: './src/components/chrome/Pagination.astro',
        Hero: './src/components/chrome/Hero.astro',
      },
      expressiveCode: {
        themes: codeThemes,
        useStarlightDarkModeSwitch: false,
        useStarlightUiThemeColors: false,
        minSyntaxHighlightingColorContrast: 0,
        plugins: [languageLabel],
        // A bar with the language and Copy above plain code; no window chrome.
        defaultProps: { frame: 'code' },
        styleOverrides: {
          borderRadius: '10px',
          borderColor: 'transparent',
          borderWidth: '0px',
          codeFontFamily: 'var(--font-mono)',
          codeFontSize: '13px',
          codeLineHeight: '1.6',
          codePaddingBlock: '14px 16px',
          codePaddingInline: '16px',
          codeBackground: 'var(--panel)',
          uiFontFamily: 'var(--font-sans)',
          frames: {
            editorTabBarBackground: 'var(--zebra)',
            editorTabBarBorderBottomColor: 'transparent',
            editorActiveTabIndicatorTopColor: 'transparent',
            frameBoxShadowCssValue: 'none',
            inlineButtonBackground: 'transparent',
            inlineButtonForeground: 'var(--mute)',
            inlineButtonBorder: 'transparent',
            inlineButtonBackgroundIdleOpacity: '0',
            inlineButtonBackgroundHoverOrFocusOpacity: '0',
            inlineButtonBackgroundActiveOpacity: '0',
          },
        },
      },
      description: 'Self-hosted k6 performance testing with isolated execution and trustworthy results.',
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

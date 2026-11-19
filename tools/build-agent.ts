import { build } from 'tsup';
import type { Plugin } from 'esbuild';

/** Keeps the runtime out of the small container.js entry, so the entry parses first. */
const separateRuntime: Plugin = {
  name: 'separate-container-main',
  setup(builder) {
    builder.onResolve({ filter: /^\.\/container-main\.js$/ }, (args) =>
      args.importer.endsWith('container-entry.ts') ? { path: './container-main.js', external: true } : undefined,
    );
  },
};

await build({
  entry: {
    health: 'agent/src/bootstrap/health-check.ts',
    main: 'agent/src/bootstrap/main.ts',
    // container.js is a small entry that catches early stops, then loads container-main.js.
    container: 'agent/src/bootstrap/container-entry.ts',
    'container-main': 'agent/src/bootstrap/container-main.ts',
    worker: 'agent/src/journal/worker.ts',
  },
  outDir: 'agent/dist',
  format: ['esm'],
  platform: 'node',
  target: 'node24',
  bundle: true,
  noExternal: [/.*/],
  shims: true,
  removeNodeProtocol: false,
  splitting: false,
  clean: false,
  esbuildPlugins: [separateRuntime],
  banner: {
    js: "import { createRequire as createNodeRequire } from 'node:module'; const require = createNodeRequire(import.meta.url);",
  },
});

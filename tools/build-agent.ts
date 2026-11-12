import { build } from 'tsup';

await build({ entry: { main: 'agent/src/bootstrap/main.ts', container:'agent/src/bootstrap/container.ts', worker: 'agent/src/journal/worker.ts' },
  outDir: 'agent/dist', format: ['esm'], platform: 'node', target: 'node24', bundle: true,
  noExternal: [/.*/], shims: true, removeNodeProtocol: false, splitting: false, clean: false,
  banner: { js: "import { createRequire as createNodeRequire } from 'node:module'; const require = createNodeRequire(import.meta.url);" } });

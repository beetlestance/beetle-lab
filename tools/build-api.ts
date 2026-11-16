import { build } from 'tsup';
await build({ entry: { main: 'app/src/bootstrap/main.ts', worker: 'app/src/adapters/outbound/sqlite/worker.ts',
  automation: 'app/src/client/cli/main.ts' },
  outDir: 'app/dist', format: ['esm'], platform: 'node', target: 'node24', bundle: true,
  noExternal: [/.*/], shims: true, removeNodeProtocol: false, splitting: false, clean: false,
  banner: { js: "import { createRequire as createNodeRequire } from 'node:module'; const require = createNodeRequire(import.meta.url);" } });

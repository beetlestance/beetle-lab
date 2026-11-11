import { build } from 'tsup';

await build({ entry: {
  main: 'tools/install/cli.ts',
  starter: 'tools/install/starter-cli.ts',
  'agent-worker': 'agent/src/journal/worker.ts',
  'backend-worker': 'app/src/adapters/outbound/sqlite/worker.ts',
}, outDir: 'tools/install/dist', format: ['esm'], platform: 'node', target: 'node24', bundle: true,
noExternal: [/.*/], shims: true, removeNodeProtocol: false, splitting: false, clean: false,
banner: { js: "import { createRequire as createNodeRequire } from 'node:module'; const require = createNodeRequire(import.meta.url);" } });

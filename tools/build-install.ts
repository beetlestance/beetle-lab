import { build } from 'tsup';

await build({ entry: {
  main: 'tools/install/cli.ts',
  recovery: 'tools/recovery/cli.ts',
  history: 'tools/recovery/history-container.ts',
  'recovery-container': 'tools/recovery/container.ts',
  starter: 'tools/install/starter-cli.ts',
  local: 'tools/install/local-cli.ts',
  compose:'tools/install/compose/index.ts',
  'agent-worker': 'agent/src/journal/worker.ts',
  'backend-worker': 'app/src/adapters/outbound/sqlite/worker.ts',
}, outDir: 'tools/install/dist', format: ['esm'], platform: 'node', target: 'node24', bundle: true,
noExternal: [/.*/], shims: true, removeNodeProtocol: false, splitting: false, clean: false,
banner: { js: "import { createRequire as createNodeRequire } from 'node:module'; const require = createNodeRequire(import.meta.url);" } });

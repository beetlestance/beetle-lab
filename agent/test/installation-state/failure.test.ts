import { execFileSync } from 'node:child_process';
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
it.each(['file','directory','database'])('retains %s close-then-throw custody until the process ends', mode => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'beetle-agent-close-')));
  try {
    const output = execFileSync(process.execPath, ['--max-old-space-size=128', '--import', 'tsx',
      'agent/test/installation-state/failure.child.ts', mode, join(root, 'control.sqlite')],
    {cwd: process.cwd(), encoding: 'utf8', timeout: 10000, maxBuffer: 8192});
    expect(output.trim()).toBe('retained-originals');
  } finally {rmSync(root, {recursive: true, force: true});}
});

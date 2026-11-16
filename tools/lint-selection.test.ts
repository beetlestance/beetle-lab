import { ESLint } from 'eslint';
import { expect, it } from 'vitest';

it('retains nested TS/TSX and generated source checks while ignoring legacy/build/dependency paths', async () => {
  const eslint = new ESLint();
  for (const filePath of ['app/src/domain/nested/value.ts', 'web/src/features/runs/screen.tsx', 'contracts/generated/value.ts']) {
    expect(await eslint.isPathIgnored(filePath)).toBe(false);
    const results = await eslint.lintText('export const value: any = 1;', { filePath });
    expect(results.flatMap(result => result.messages.map(message => message.ruleId)))
      .toContain('@typescript-eslint/no-explicit-any');
  }
  for (const path of ['public/js/run.js', 'node_modules/fixture/index.ts', 'web/dist/output.js', '.agent-work/input.ts']) {
    expect(await eslint.isPathIgnored(path)).toBe(true);
  }
});

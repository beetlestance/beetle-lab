import { defineConfig } from "vitest/config";
// Functional files share real disk I/O. Explicit races still overlap within each test.
export default defineConfig({ test: { include: ["{app,agent,contracts,web,tools,engines/k6}/**/*.test.{ts,tsx}"], exclude: ["**/node_modules/**", "**/dist/**"], maxWorkers: 1, testTimeout: 10000, hookTimeout: 10000 } });

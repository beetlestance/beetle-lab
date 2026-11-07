import { defineConfig } from "vitest/config";
export default defineConfig({ test: { include: ["{app,agent,contracts,web,tools,engines/k6}/**/*.test.{ts,tsx}"], exclude: ["**/node_modules/**", "**/dist/**"], maxWorkers: 2, testTimeout: 10000, hookTimeout: 10000 } });

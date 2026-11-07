import { readdir } from "node:fs/promises";
import { spawnSync } from "node:child_process";

async function walk(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = await Promise.all(entries.map((entry) => {
    const path = `${dir}/${entry.name}`;
    return entry.isDirectory() ? walk(path) : /\.(?:m?js)$/.test(path) ? [path] : [];
  }));
  return files.flat();
}
const files = ["server.js", "runner.js", "loadtest.js", ...await walk("public/js"), ...await walk("scripts"), ...await walk("test")];
for (const file of files) {
  const result = spawnSync(process.execPath, ["--check", file], { stdio: "inherit" });
  if (result.status !== 0) process.exit(result.status || 1);
}
console.log(`Syntax checked ${files.length} JavaScript files.`);

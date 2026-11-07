import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, cp, symlink, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { once } from "node:events";

const root = fileURLToPath(new URL("../", import.meta.url));
test("HTTP API manages isolated configs and serves the renamed skill", { timeout: 20000 }, async (t) => {
  const dir = await mkdtemp(path.join(tmpdir(), "beetle-lab-test-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  for (const file of ["server.js", "runner.js", "loadtest.js", "package.json", "public"]) {
    await cp(path.join(root, file), path.join(dir, file), { recursive: true });
  }
  await symlink(path.join(root, "node_modules"), path.join(dir, "node_modules"), "dir");
  const child = spawn(process.execPath, ["server.js"], { cwd: dir, env: { ...process.env, PORT: "0" }, stdio: ["ignore", "pipe", "pipe"] });
  let output = "";
  child.stderr.on("data", (chunk) => { output += chunk; });
  t.after(async () => {
    if (child.exitCode === null && child.signalCode === null) {
      const exited = once(child, "exit");
      child.kill("SIGTERM");
      await exited;
    }
  });
  const port = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Server startup timed out: ${output}`)), 10000);
    child.once("error", (error) => { clearTimeout(timer); reject(error); });
    child.once("exit", (code) => { clearTimeout(timer); reject(new Error(`Server exited ${code}: ${output}`)); });
    child.stdout.on("data", (chunk) => {
      output += chunk;
      const match = /running at http:\/\/localhost:(\d+)/.exec(output);
      if (match) { clearTimeout(timer); resolve(Number(match[1])); }
    });
  });
  const url = `http://127.0.0.1:${port}`;
  const request = (route, method = "GET", body) => fetch(url + route, {
    method, headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body),
  });
  assert.deepEqual(await (await request("/api/folders")).json(), []);
  const create = await request("/api/folders", "POST", { name: "smoke" });
  assert.equal(create.status, 200);
  assert.equal((await request("/api/folders", "POST", { name: "smoke" })).status, 409);
  const config = { endpoints: [{ name: "health", path: "/health" }] };
  const upload = await request("/api/folders/smoke/files", "POST", { files: [
    { path: "nested/smoke.json", content: JSON.stringify(config) },
    { path: "runs/do-not-write.json", content: "{}" },
  ] });
  assert.deepEqual(await upload.json(), { added: 1, skipped: 1 });
  assert.deepEqual(await (await request("/api/folders/smoke/files/nested/smoke.json")).json(), config);
  const folders = await (await request("/api/folders")).json();
  assert.equal(folders[0].configs[0].path, "nested/smoke.json");
  assert.equal((await request("/api/runs", "POST", {})).status, 400);
  assert.equal((await request("/api/runs", "POST", { folder: "smoke", config: "missing.json" })).status, 404);
  const skill = await (await request("/integrations/beetle-lab.skill.md")).text();
  assert.match(skill, /^# beetle-lab/);
  assert.equal(await (await request("/integrations/k6-studio.skill.md")).text(), skill);
  assert.match(await (await request("/")).text(), /beetle-lab · Dashboard/);
  assert.equal((await request("/api/folders/smoke", "DELETE")).status, 200);
  assert.deepEqual(await (await request("/api/folders")).json(), []);
});

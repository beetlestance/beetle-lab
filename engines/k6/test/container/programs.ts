/** Static trusted fixture programs, passed as argv without a shell. No Docker socket. */
export const stage = `
const fs = require('node:fs');
const raw = fs.readFileSync(0, 'utf8'); if (Buffer.byteLength(raw) > 2097152) throw Error('fixture cap');
const files = JSON.parse(raw);
if (Object.keys(files).sort().join(',') !== 'manifest.json,offer.json,staging.json') throw Error('fixture names');
for (const [name, content] of Object.entries(files)) {
  if (typeof content !== 'string' || Buffer.byteLength(content) > 1048576) throw Error('fixture cap');
  const path = '/beetle/input/' + name;
  fs.writeFileSync(path, content, { mode: 0o400, flag: 'wx' }); fs.chownSync(path, 1000, 1000);
}
for (const name of ['input', 'secrets', 'output']) {
  fs.chownSync('/beetle/' + name, 1000, 1000); fs.chmodSync('/beetle/' + name, name === 'output' ? 0o700 : 0o500);
}
`;
export const target = `
const http = require('node:http'); const counts = { ready: 0, work: 0 };
http.createServer((req, res) => {
  if (req.url === '/ready') { counts.ready++; res.writeHead(200); res.end('ready'); }
  else if (req.url === '/work') { counts.work++; res.writeHead(Number(process.env.WORK_STATUS)); res.end('ok'); }
  else if (req.url === '/counts') { res.writeHead(200); res.end(JSON.stringify(counts)); }
  else { res.writeHead(404); res.end(); }
}).listen(8080, '0.0.0.0');
`;
export const read = `
const fs = require('node:fs'); const crypto = require('node:crypto'); const files = {};
for (const name of ['beetle-evidence.json', 'numeric-final.json', 'engine-result.json', 'control.ndjson']) {
  const path = '/beetle/output/' + name; const stat = fs.lstatSync(path, { bigint: true });
  if (!stat.isFile() || stat.nlink !== 1n || stat.uid !== 1000n || (stat.mode & 0o777n) !== 0o600n
    || stat.size < 1n || stat.size > 1048576n) throw Error('artifact custody');
  const bytes = fs.readFileSync(path);
  if (BigInt(bytes.length) !== stat.size) throw Error('artifact size');
  files[name] = { bytes: bytes.length, sha256: crypto.createHash('sha256').update(bytes).digest('hex'), text: bytes.toString('utf8') };
}
console.log(JSON.stringify({ node: process.version, platform: process.platform, arch: process.arch, uid: process.getuid(), files }));
`;
export const kernel = `
const fs = require('node:fs'); const controls = {};
for (const name of ['cpu.max', 'memory.max', 'memory.swap.max', 'pids.max']) controls[name] = fs.readFileSync('/sys/fs/cgroup/' + name, 'utf8').trim();
console.log(JSON.stringify({ node: process.version, arch: process.arch, uid: process.getuid(), esbuild: require('esbuild').version, controls }));
`;

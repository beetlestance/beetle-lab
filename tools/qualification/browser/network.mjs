import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { chmod, mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { ownedOrigin } from '../native-application/public-api.ts';

/** Decision 032 network profile: one hostname, served only through a TLS proxy on the ingress network. */
export const hostname = 'beetle.test';
const browserImage = 'mcr.microsoft.com/playwright:v1.65.1-noble';

/** @param {number} port */
function proxyConfiguration(port) {
  return `worker_processes 1;
pid /tmp/nginx.pid;
error_log /dev/stderr warn;
events { worker_connections 256; }
http {
    access_log off;
    client_max_body_size 2m;
    client_body_temp_path /tmp/client_temp;
    proxy_temp_path /tmp/proxy_temp;
    fastcgi_temp_path /tmp/fastcgi_temp;
    uwsgi_temp_path /tmp/uwsgi_temp;
    scgi_temp_path /tmp/scgi_temp;
    resolver 127.0.0.11 valid=5s ipv6=off;
    server {
        listen ${port} ssl;
        server_name ${hostname};
        ssl_certificate /etc/beetle-proxy/cert.pem;
        ssl_certificate_key /etc/beetle-proxy/key.pem;
        location / {
            set $frontend http://frontend:8080;
            proxy_pass $frontend$request_uri;
            proxy_http_version 1.1;
            proxy_set_header Host $http_host;
            proxy_set_header Connection "";
            proxy_buffering off;
            proxy_request_buffering off;
            proxy_read_timeout 60s;
        }
    }
}
`;
}

/** Self-signed certificate for the qualification hostname only; never trusted by the host. @param {string} directory */
async function certificate(directory) {
  execFileSync(
    'openssl',
    [
      'req',
      '-x509',
      '-newkey',
      'ec',
      '-pkeyopt',
      'ec_paramgen_curve:prime256v1',
      '-nodes',
      '-days',
      '1',
      '-subj',
      `/CN=${hostname}`,
      '-addext',
      `subjectAltName=DNS:${hostname}`,
      '-keyout',
      join(directory, 'key.pem'),
      '-out',
      join(directory, 'cert.pem'),
    ],
    { stdio: 'ignore' },
  );
  // The proxy runs as UID 101 inside the container; the directory holds only this throwaway pair.
  await chmod(join(directory, 'key.pem'), 0o644);
  return readFile(join(directory, 'cert.pem'), 'utf8');
}

/**
 * Rewrites the owned fixture before `compose up`: network access with an HTTPS origin served by a
 * TLS proxy (alias `beetle.test` on ingress, published on loopback for the Node-side client), the
 * frontend moved to another loopback port, and a Playwright run-server on the same network.
 * @param {{ root: string, origin: string, images: { frontend?: string | undefined } }} f
 */
export async function prepareNetwork(f) {
  const proxyPort = Number(new URL(f.origin).port);
  const frontendPort = Number(new URL(await ownedOrigin()).port);
  const browserPort = Number(new URL(await ownedOrigin()).port);
  const origin = `https://${hostname}:${proxyPort}`;
  const directory = join(f.root, 'network-proxy');
  await mkdir(directory, { mode: 0o755 });
  const ca = await certificate(directory);
  await writeFile(join(directory, 'nginx.conf'), proxyConfiguration(proxyPort), { mode: 0o644 });
  const envFile = join(f.root, 'compose.env');
  const env = (await readFile(envFile, 'utf8')).replace(/^BEETLE_PORT='\d+'$/m, `BEETLE_PORT='${frontendPort}'`);
  await writeFile(envFile, `${env}BEETLE_ACCESS='network'\nBEETLE_ORIGIN='${origin}'\n`, { mode: 0o600 });
  const token = randomBytes(18).toString('base64url');
  const playwright = await realpath(resolve('tools/qualification/browser/node_modules/playwright-core'));
  const override = join(f.root, 'target.json');
  const services = JSON.parse(await readFile(override, 'utf8'));
  services.services['network-proxy'] = {
    image: f.images.frontend,
    entrypoint: ['nginx', '-c', '/etc/beetle-proxy/nginx.conf', '-g', 'daemon off;'],
    user: '101:101',
    read_only: true,
    tmpfs: ['/tmp'],
    cap_drop: ['ALL'],
    security_opt: ['no-new-privileges:true'],
    volumes: [`${directory}:/etc/beetle-proxy:ro`],
    networks: { ingress: { aliases: [hostname] } },
    ports: [`127.0.0.1:${proxyPort}:${proxyPort}`],
    depends_on: { frontend: { condition: 'service_started' } },
  };
  services.services['network-browser'] = {
    image: browserImage,
    init: true,
    user: 'pwuser',
    volumes: [`${playwright}:/opt/playwright-core:ro`],
    entrypoint: ['node', '/opt/playwright-core/cli.js', 'run-server', '--host', '0.0.0.0'],
    command: ['--port', String(browserPort), '--path', `/${token}`],
    networks: ['ingress'],
    ports: [`127.0.0.1:${browserPort}:${browserPort}`],
  };
  await writeFile(override, JSON.stringify(services), { mode: 0o600 });
  return {
    origin,
    ca,
    proxyPort,
    frontendOrigin: `http://127.0.0.1:${frontendPort}`,
    endpoint: `ws://127.0.0.1:${browserPort}/${token}`,
  };
}

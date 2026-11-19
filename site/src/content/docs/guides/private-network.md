---
title: Open it over a private network
description: Reach an installation from your own computers over a VPN, a tailnet or a LAN, through a TLS reverse proxy.
sidebar:
  order: 7.5
---

If you are the only person who uses the installation and you reach the server over
a network you control, such as a VPN, a Tailscale tailnet or your home LAN, you can
open the UI there through a TLS reverse proxy instead of an
[SSH tunnel](/guides/self-hosting/#open-the-ui-through-a-tunnel).

:::caution[One administrator, private network only]
There is no password. Anyone who can reach the address gets full administrator
access, so the private network is your only access control. Never expose the
address to the internet, and do not share it with other people.
:::

An installation keeps the address it serves: starting it with a different
`BEETLE_ORIGIN` stops setup with `binding_changed external_origin`. To move an
existing installation to a new address, follow
[Change the address](#change-the-address-of-an-existing-installation) instead of
the steps below.

1. Pick one hostname for this installation, such as `beetle.example.internal`, and
   get a certificate your browsers trust for it. Tailscale can issue one with
   `tailscale cert`; Caddy can use its internal certificate authority.
2. Start the installation with network access and that address:

   ```sh
   export BEETLE_ACCESS=network
   export BEETLE_ORIGIN=https://beetle.example.internal
   docker compose up --build -d
   ```

   The UI port stays on the server's loopback, where a proxy on the same server
   reaches it. If the proxy runs on another machine, also set `BEETLE_BIND` to the
   server's private IPv4 address, never `0.0.0.0` on a machine with a public address.
3. Point the proxy at `127.0.0.1:4567` (or `BEETLE_BIND:BEETLE_PORT`).

The address must start with `https://`. Browsers only allow the cryptography the UI
relies on in a secure context, and a VPN does not make a plain `http://` address
secure in the browser's eyes.

The proxy must:

- pass the browser's `Host` header through unchanged, so it matches `BEETLE_ORIGIN`;
- not buffer responses, because live run metrics stream over server-sent events;
- accept request bodies of at least 2 MiB, the size of an uploaded input file;
- keep idle connections open for at least 35 seconds;
- serve one hostname per installation, at the root path, not under a sub-path.

With Caddy:

```text
beetle.example.internal {
	reverse_proxy 127.0.0.1:4567 {
		flush_interval -1
	}
	request_body {
		max_size 2MB
	}
}
```

With nginx:

```nginx
server {
    listen 443 ssl;
    server_name beetle.example.internal;
    ssl_certificate     /etc/ssl/beetle.crt;
    ssl_certificate_key /etc/ssl/beetle.key;
    client_max_body_size 2m;

    location / {
        proxy_pass http://127.0.0.1:4567;
        proxy_set_header Host $http_host;
        proxy_http_version 1.1;
        proxy_buffering off;
        proxy_request_buffering off;
        proxy_read_timeout 60s;
    }
}
```

If the browser shows *Forbidden* on every action, the address in the browser
differs from `BEETLE_ORIGIN`, often by the port, or the proxy rewrote `Host`.

| Variable | Default | Purpose |
| --- | --- | --- |
| `BEETLE_ACCESS` | `local` | `network` allows an address or bind on another host |
| `BEETLE_ORIGIN` | `http://127.0.0.1:PORT` | The `https://` address your browser opens |
| `BEETLE_BIND` | `127.0.0.1` | Server IPv4 address the UI port is published on |

Setup refuses an address or bind on another host without `BEETLE_ACCESS=network`
(`network_access_required`). The local launcher and the
[history viewer](/guides/backup-and-restore/) stay on loopback.

## Change the address of an existing installation

Suites, runs, credentials and resource settings stay as they are. Set up the new
hostname, certificate and proxy first, then:

1. Stop the services and finish any upgrade or resource change:
   `docker compose down`.
2. Pick an operation ID and keep it until the change is done: `uuidgen`.
3. Run the change with the new address in `BEETLE_ORIGIN` and the address the
   installation serves now in `--from` (`http://127.0.0.1:4567` if you never set one):

   ```sh
   export BEETLE_ACCESS=network
   export BEETLE_ORIGIN=https://beetle.example.internal
   docker compose run --rm setup origin \
     --from http://127.0.0.1:4567 --operation-id <operation ID>
   ```

4. Start it with the same variables: `docker compose up -d`.

If the command is interrupted, run it again with the same ID; a finished change
prints `unchanged`. Browsers keep the session per address, so the new address
starts a new one by itself. To go back to loopback, run the command with
`BEETLE_ORIGIN` unset, a new ID and the HTTPS address as `--from`.

Releases older than this command cannot start an installation whose address was
changed; they stop with `recovery_required` instead of serving the wrong address.
That protects the installation but does not roll it back: before running an older
release, change the address back to the one it was first set up with.

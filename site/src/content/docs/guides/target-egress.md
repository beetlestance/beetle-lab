---
title: Limit what runs can reach
description: Optionally stop engine containers from reaching the cloud metadata endpoint, the host and private address ranges.
sidebar:
  order: 7.6
---

Engine containers join one Docker bridge network, `beetle-<instance>-targets`
(`beetle-lab-targets` by default). Beetle Lab does not filter that network: a run can
reach anything the server itself can reach, which is usually what a load test
needs. On a cloud VM or a shared LAN that also includes addresses you may not want
a suite to touch:

- the cloud **metadata endpoint**, `169.254.169.254`, which can hand out the
  instance's credentials;
- **private ranges** such as `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16` and
  `100.64.0.0/10` (also used by Tailscale);
- the **server itself**, including services that listen only on its private
  addresses.

Docker has no per-network egress setting, so blocking is done on the host. This is
optional and only matters if people other than you write suites, or you load test
from a machine that holds cloud credentials.

:::note[Linux with Docker's iptables backend]
The rules below use Docker's `DOCKER-USER` chain, which exists on Linux when Docker
manages iptables (the default). Docker Desktop on macOS and Windows does not expose
it; there, use your cloud provider's controls below or a firewall outside the
machine.
:::

## Find the network's interface

Start the installation once so the network exists, then:

```sh
NET=beetle-lab-targets
IF=br-$(docker network inspect -f '{{.Id}}' "$NET" | cut -c1-12)
echo "$IF"
```

`docker compose down` removes the network. A new one has a new interface name, so
apply the rules again after the next start.

## Block the metadata endpoint

```sh
sudo iptables -I DOCKER-USER 1 -i "$IF" -d 169.254.169.254 -j REJECT
```

On AWS, also require IMDSv2 tokens with a hop limit of 1. Containers on a bridge are
one hop further away, so they cannot obtain a token:

```sh
aws ec2 modify-instance-metadata-options --instance-id <instance-id> \
  --http-tokens required --http-put-response-hop-limit 1
```

Google Cloud and Azure require a metadata header instead, but a suite can send any
header, so the header does not protect you. Use the `iptables` rule.

## Block private ranges, except your targets

Insert the `REJECT` rules first, then the exceptions **above** them, because the
first matching rule wins:

```sh
for range in 10.0.0.0/8 172.16.0.0/12 192.168.0.0/16 100.64.0.0/10 169.254.0.0/16; do
  sudo iptables -I DOCKER-USER 1 -i "$IF" -d "$range" -j REJECT
done
# Exceptions: each service you test, and your DNS resolver if it has a private address.
sudo iptables -I DOCKER-USER 1 -i "$IF" -d 10.0.4.20 -j ACCEPT
sudo iptables -I DOCKER-USER 1 -i "$IF" -d 192.168.1.1 -p udp --dport 53 -j ACCEPT
sudo iptables -I DOCKER-USER 1 -i "$IF" -m conntrack --ctstate RELATED,ESTABLISHED -j ACCEPT
```

Replace the example addresses with your own. Without the resolver exception, runs
fail with name-resolution errors when your DNS server is on a private address.

## Block the server itself

Traffic from a container to the server's own addresses does not pass through
`DOCKER-USER`. Block it in the `INPUT` chain, allowing only ports you test:

```sh
sudo iptables -I INPUT 1 -i "$IF" -j REJECT
sudo iptables -I INPUT 1 -i "$IF" -p tcp --dport 8080 -j ACCEPT   # a service you test
sudo iptables -I INPUT 1 -i "$IF" -m conntrack --ctstate RELATED,ESTABLISHED -j ACCEPT
```

## Check and keep the rules

List them with `sudo iptables -S DOCKER-USER` and `sudo iptables -S INPUT`. Run a
short suite against a blocked address, such as `http://169.254.169.254/`: its
requests should fail to connect, while a suite against an allowed target passes.

Docker keeps `DOCKER-USER` across restarts of the Docker service, but nothing keeps
these rules across a reboot. Save them with your distribution's tool, such as
`iptables-persistent` on Debian and Ubuntu, and reapply them whenever the network is
recreated. If the targets network has IPv6 enabled, add the same rules with
`ip6tables`.

These rules limit where runs connect. They do not change what a run can do inside
its container; see [Security](/concepts/security/#engine-containers).

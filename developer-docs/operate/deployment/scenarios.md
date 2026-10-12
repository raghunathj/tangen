---
title: Deployment scenarios on one machine
description: "Three ways developers run development, staging and production, and a hosts-file simulation that makes one laptop feel like a laptop plus one or two servers."
audience: operator
type: guide
status: stable
lastVerified: 2026-09-04
verification: executable
verifiedBy: test/browser/deployment.browser.ts + scripts/verify-migrations-pg.ts
---

# Deployment scenarios on one machine

Tangen has three deployment roles (development, staging, production) and each
is a deployment of its own: one process, one database, one `.env`. This
guide sets up every common arrangement on ONE machine, with hostnames from
your hosts file standing in for servers, so you can rehearse a deployment
before you rent one.

The whole simulation is: three hostnames, one small reverse proxy, one folder
per "server", and the same Tangen commands you would run on a real host.

## The building blocks

Four facts decide everything below. They are the platform's rules, not the
simulation's.

- **One process holds one database.** `DATABASE_URL` is the database; there
  is no second one, and no request can name another. Two deployments are two
  processes with two URLs and nothing in common but the code.
- **The role is the process's.** `TANGEN_DEPLOYMENT_ROLE` decides the safety
  policy (a production role refuses destructive pushes, purges and seeds,
  requires `JWT_SECRET`, sends secure cookies). It never selects data.
- **`tangen dev` is the laptop, `tangen start` is the server.** `tangen dev`
  runs the API plus the Vite Admin dev server. `tangen start` runs the API
  only; the Admin is the static `dist/admin` folder that `tangen build`
  produced, served by any web server or reverse proxy. A static Admin needs
  no port of its own.
- **The Admin shows the role, not a switcher.** Each deployment has its own
  Admin URL and its own accounts; the top bar names the role the process
  runs under.

Variables read by every deployment (in its `.env`, or exported in the shell;
the shell wins):

| variable | meaning |
|---|---|
| `DATABASE_URL` | the one database this process holds |
| `TANGEN_DEPLOYMENT_ROLE` | `development`, `staging` or `production` (derived from `NODE_ENV` when unset) |
| `PORT` | the API port (bind it to loopback behind a proxy) |
| `ADMIN_URL`, `SERVER_URL`, `FRONTEND_URL` | the public URLs of this deployment; CORS and the generated links read them |
| `JWT_SECRET` | signs member sessions; one per process |

## Step 0: the machine

### Hostnames

Add one line to `/etc/hosts` (`sudo nano /etc/hosts` on macOS or Linux;
`C:\Windows\System32\drivers\etc\hosts` on Windows). `.test` is reserved for
exactly this and never resolves on the public internet.

```text
127.0.0.1 dev.tangen.test staging.tangen.test tangen.test
```

Check it:

```bash
ping -c 1 staging.tangen.test    # answers from 127.0.0.1
```

### Databases

Create one database per deployment:

```bash
createdb tangen_dev
createdb tangen_staging
createdb tangen_prod
```

### The reverse proxy

A real server puts nginx or Caddy in front of Tangen; here a 50-line Bun
script does the same job: it reads the `Host` header, sends `/api/*` and
`/media/*` to that deployment's API port, and serves that deployment's Admin
(Vite for development, the static build for the others). Save it as
`proxy.ts` in your project and run `bun proxy.ts`.

```ts
import { existsSync, statSync, readFileSync } from 'node:fs'
import { join, extname } from 'node:path'

const PORT = Number(process.env.PROXY_PORT ?? 8080)
// Each "server" serves its own dist/admin; point these at the right folders.
const ROUTES: Record<string, { api: number; admin: number | string }> = {
  'dev.tangen.test': { api: 3000, admin: 3001 },                                   // tangen dev: Vite
  'staging.tangen.test': { api: 3002, admin: join(import.meta.dir, 'dist', 'admin') }, // static build
  'tangen.test': { api: 3004, admin: join(import.meta.dir, 'dist', 'admin') },         // static build
}
const MIME: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.json': 'application/json', '.woff2': 'font/woff2', '.png': 'image/png' }

async function forward(req: Request, port: number): Promise<Response> {
  const u = new URL(req.url)
  const headers = new Headers(req.headers)
  headers.delete('host')
  const body = req.method === 'GET' || req.method === 'HEAD' ? undefined : await req.arrayBuffer()
  let res: Response | undefined
  let lastError: unknown
  for (const host of ['127.0.0.1', '[::1]']) { // the API binds IPv4 loopback, Vite binds localhost (often IPv6)
    try { res = await fetch(`http://${host}:${port}${u.pathname}${u.search}`, { method: req.method, headers, body, redirect: 'manual' }); break } catch (e) { lastError = e }
  }
  if (!res) throw new Error(`nothing answers on :${port} (${lastError instanceof Error ? lastError.message : String(lastError)})`)
  const out = new Headers(res.headers); out.delete('content-encoding'); out.delete('content-length')
  return new Response(res.body, { status: res.status, headers: out })
}

Bun.serve({
  port: PORT,
  async fetch(req) {
    const host = (req.headers.get('host') ?? '').split(':')[0]
    const route = ROUTES[host]
    if (!route) return new Response(`no deployment for host "${host}"`, { status: 404 })
    const u = new URL(req.url)
    if (u.pathname === '/api' || u.pathname.startsWith('/api/') || u.pathname.startsWith('/media/') || u.pathname.startsWith('/embed/')) {
      return forward(req, route.api).catch((e) => new Response(`api down: ${e.message}`, { status: 502 }))
    }
    if (typeof route.admin === 'number') return forward(req, route.admin).catch((e) => new Response(`admin down: ${e.message}`, { status: 502 }))
    const file = join(route.admin, u.pathname)
    if (u.pathname !== '/' && existsSync(file) && statSync(file).isFile()) return new Response(Bun.file(file), { headers: { 'content-type': MIME[extname(file)] ?? 'application/octet-stream' } })
    if (!existsSync(join(route.admin, 'index.html'))) return new Response('run `tangen build` first', { status: 503 })
    return new Response(readFileSync(join(route.admin, 'index.html')), { headers: { 'content-type': 'text/html; charset=utf-8' } })
  },
})
console.log(`proxy on :${PORT} for ${Object.keys(ROUTES).join(', ')}`)
```

The Admin behind this proxy is same-origin with its API, so the static build
needs no configuration at all: an Admin with an empty `tangen:config` calls
`/api` on its own origin. Only a split-domain deployment (Admin on one host,
API on another) rewrites the `tangen:config` meta tag in `dist/admin/index.html`,
as `tangen build` prints.

One limit of the sample proxy: it does not forward WebSockets, so Vite's hot
reload does not work through `dev.tangen.test`. Develop at
`http://localhost:3001` as usual and use the hostname to check the
deployment's Admin and its role badge.

## Mindset 1: laptop, then a staging server, then a production server

You develop locally and push the codebase to two other machines. In the
simulation each machine is a folder with its own `.env`.

```text
~/sim/laptop/       tangen dev            dev.tangen.test      → :3000 + Vite :3001
~/sim/staging/      tangen start          staging.tangen.test  → :3002 + dist/admin
~/sim/production/   tangen start          tangen.test          → :3004 + dist/admin
```

Set up:

```bash
git clone <your project> ~/sim/laptop
git clone <your project> ~/sim/staging       # on a real server: git pull + bun install
git clone <your project> ~/sim/production
```

Each folder gets a `.env` that holds ONLY what that machine needs:

```bash
# ~/sim/laptop/.env
DATABASE_URL=postgres://localhost/tangen_dev
PORT=3000
ADMIN_PORT=3001
JWT_SECRET=<laptop secret>

# ~/sim/staging/.env
TANGEN_DEPLOYMENT_ROLE=staging
DATABASE_URL=postgres://localhost/tangen_staging
PORT=3002
JWT_SECRET=<staging secret>
ADMIN_URL=http://staging.tangen.test:8080
SERVER_URL=http://staging.tangen.test:8080
FRONTEND_URL=http://staging.tangen.test:8080

# ~/sim/production/.env
TANGEN_DEPLOYMENT_ROLE=production
DATABASE_URL=postgres://localhost/tangen_prod
PORT=3004
JWT_SECRET=<production secret>
ADMIN_URL=http://tangen.test:8080
SERVER_URL=http://tangen.test:8080
FRONTEND_URL=http://tangen.test:8080
```

A server's `.env` names its own database and nothing else. A deployed
process with no `DATABASE_URL` refuses to start.

Run (four terminals, or a process manager):

```bash
cd ~/sim/laptop      && tangen dev
cd ~/sim/staging     && tangen bootstrap && tangen push && tangen build && tangen start
cd ~/sim/production  && tangen bootstrap && tangen push && tangen build && tangen start
cd ~/sim/laptop      && bun proxy.ts      # with ROUTES pointing at ~/sim/staging/dist/admin and ~/sim/production/dist/admin
```

Then open `http://dev.tangen.test:8080`, `http://staging.tangen.test:8080` and
`http://tangen.test:8080`. Sign in to each: they are separate deployments
with separate sessions and separate accounts, as three servers would be. The
top bar of each names its role.

## Mindset 2: laptop with a local staging, then a production server

You keep staging on your own machine to review work before it goes out, and
only production is remote.

```text
~/sim/laptop/       tangen dev                                   dev.tangen.test
~/sim/laptop/       bun --env-file=.env.staging tangen start     staging.tangen.test   (same folder, second process)
~/sim/production/   tangen start                                 tangen.test
```

Because a process reads the `.env` you hand it, one folder serves two
deployments:

```bash
# ~/sim/laptop/.env          the development deployment, as in Mindset 1
# ~/sim/laptop/.env.staging  TANGEN_DEPLOYMENT_ROLE=staging, DATABASE_URL=postgres://localhost/tangen_staging, PORT=3002, its own JWT_SECRET and URLs
cd ~/sim/laptop && tangen dev                                          # holds tangen_dev
cd ~/sim/laptop && bun --env-file=.env.staging x tangen push           # staging's schema
cd ~/sim/laptop && bun --env-file=.env.staging x tangen start          # holds tangen_staging
```

Build the static Admin once (`tangen build`) and let the proxy serve
`~/sim/laptop/dist/admin` for `staging.tangen.test`. Production is exactly
the Mindset 1 production folder.

## Mindset 3: laptop, then one server that hosts staging and production

One rented machine runs both remote deployments. On a real server they are
two processes behind one nginx; here they are two processes in one folder
behind the sample proxy.

```text
~/sim/laptop/       tangen dev                                          dev.tangen.test
~/sim/server/       bun --env-file=.env.staging    tangen start         staging.tangen.test
~/sim/server/       bun --env-file=.env.production tangen start        tangen.test
```

One checkout, two `.env` files, and the process manager (systemd unit, pm2
ecosystem, Docker environment) picks which one each process gets:

```bash
# ~/sim/server/.env.staging
TANGEN_DEPLOYMENT_ROLE=staging
DATABASE_URL=postgres://localhost/tangen_staging
PORT=3002
ADMIN_URL=http://staging.tangen.test:8080
SERVER_URL=http://staging.tangen.test:8080
# JWT_SECRET from the process manager, not from this file

# ~/sim/server/.env.production
TANGEN_DEPLOYMENT_ROLE=production
DATABASE_URL=postgres://localhost/tangen_prod
PORT=3004
ADMIN_URL=http://tangen.test:8080
SERVER_URL=http://tangen.test:8080
```

```bash
cd ~/sim/server && bun --env-file=.env.staging    x tangen push && bun --env-file=.env.production x tangen push && tangen build
cd ~/sim/server && JWT_SECRET=<staging secret>    bun --env-file=.env.staging    x tangen start
cd ~/sim/server && JWT_SECRET=<production secret> bun --env-file=.env.production x tangen start
```

Both hostnames serve the same `dist/admin` (one build, any deployment) and
each forwards `/api` to its own process. A member signed in to staging is not
signed in to production: different process, different secret, different
database. Were the two behind ONE host name on two ports, set
`TANGEN_COOKIE_NAME` per process, because browsers key cookies by host and
ignore the port.

## Proving it

Every arrangement above can be checked without a browser.

```bash
# The deployment as boot sees it: role, database, URLs, every key with its
# provenance, secrets as references. Run in the folder that deploys it.
bun --env-file=.env.staging x tangen doctor --deployment

# Each hostname answers from its own process
for h in dev.tangen.test staging.tangen.test tangen.test; do
  curl -s http://$h:8080/api/health; echo "  $h"
done

# Isolation: a staging API key does not exist on production, and production
# holds no staging content. The answer is 401, never staging data.
curl -s -H "Authorization: Bearer <staging API key>" \
  "http://tangen.test:8080/api/v1/objects/page"
```

And in the browser: sign in at one hostname and read the role badge in the
top bar; the other two hostnames are other deployments with their own
sign-in.

## Choosing

| you want | mindset |
|---|---|
| the shape you will actually ship | 1 or 3 |
| to review work before it leaves your machine | 2 |
| the least to run while learning | 2, without the production folder |

Whatever you pick, the code, the schema and `app/config` are identical on
every machine. Only `.env` differs, and Porter moves the content.

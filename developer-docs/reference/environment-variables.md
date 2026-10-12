---
title: Environment variables
description: Every environment variable Tangen reads, whether it is required, its default, and whether it is a secret.
audience: operator
type: reference
status: stable
lastVerified: 2026-09-01
verification: source
verifiedBy: developer-docs/.generated/platform-facts.json
---

# Environment variables

Configuration files are committed; secrets are not. Everything below is read
from the process environment.

**A test fails if the platform starts reading a variable this page does not
name**, so the list cannot drift from the code.

Columns: **when** is `boot` (read once at startup, changing it needs a restart)
or `live` (read per request).

## Required

| variable | default | secret | when | purpose |
|---|---|---|---|---|
| `DATABASE_URL` | - | **yes** | boot | PostgreSQL connection string: the one database this deployment holds |
| `JWT_SECRET` | a generated dev secret in `.tangen/dev-jwt-secret` | **yes** | boot | Signs member JWTs, and derives the site-session key and the at-rest key for stored SSO tokens. **Required when `NODE_ENV` is `production` or `staging`** - the server refuses to boot without it. Rotating it invalidates sessions and stored SSO tokens |

## Core

| variable | default | secret | when | purpose |
|---|---|---|---|---|
| `NODE_ENV` | unset, treated as development | no | boot | `production` or `staging` requires `JWT_SECRET`, keeps exception text out of 500 responses, makes the refresh cookie `Secure`, and switches to JSON logs |
| `PORT` | `3000` | no | boot | HTTP port |
| `REDIS_URL` | unset: reported as missing; Postgres queue, cache and fan-out | **yes** | boot | Redis for the queue, cache and realtime fan-out. `rediss://` for TLS |
| `REDIS_ENABLED` | `true` | no | boot | `false` switches Redis off on purpose; `redis.enabled: false` in the workspace config does the same |
| `TANGEN_REPLICAS` | `1` | no | boot | how many API processes serve this deployment, as the operator knows it. Production on local media refuses above 1 |
| `REALTIME_FANOUT` | `auto` | no | boot | `redis`, `postgres` or `local`. Several processes without Redis **must** set `postgres` |
| `TANGEN_WORKSPACE_ID` | `wsp_default` | no | boot | the workspace this deployment serves |
| `TANGEN_WORKSPACE_DIR` | `process.cwd()` | no | boot | the project root holding `app/` and the generated files |
| `SERVER_URL`, `ADMIN_URL`, `FRONTEND_URL`, `FRONTEND_PREVIEW_URL` | localhost from `PORT` / `ADMIN_PORT` / `FRONTEND_PORT` | no | boot | the **development** API, Admin, frontend and preview URLs, read by the resolver (`server.url`, `admin.url`, `frontend.url`, `frontend.previewUrl`) |
| `TANGEN_DEPLOYMENT_ROLE` | derived from `NODE_ENV`: `production`, `staging`, else `development` | no | boot | `development`, `staging` or `production`: the safety policy of this process (secure cookies, `JWT_SECRET` strictness, CORS strictness, error redaction, schema writes from the Admin, destructive push, purge, seed, developer tooling). Any other value refuses the boot |
| `MAIL_FROM`, `SMTP_HOST`, `SMTP_PORT` | config `fromEmail`; `localhost`; `587` | no | boot | the sender and the SMTP transport of this deployment |
| `SMTP_USER`, `SMTP_PASS`, `RESEND_API_KEY`, `SENDGRID_API_KEY` | - | **yes** | use | mail credentials, by reference (`mail.apiKey` names the provider variable) |
| `AWS_S3_BUCKET`, `AWS_S3_REGION`, `AWS_S3_ENDPOINT`, `MEDIA_PUBLIC_BASE_URL` | - | no | boot | the s3 adapter's bucket and public base |
| `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` | - | **yes** | use | the s3 credentials; `storage.accessKeyId` / `storage.secretAccessKey` may name other variables |
| provider keys (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, ...), `GOOGLE_TRANSLATE_API_KEY`, `EMBEDDINGS_API_KEY` | - | **yes** | use | AI, translation and embedding keys, by reference; `ai.apiKey.<provider>` and `knowledge.embeddings.apiKey` may rename them per environment |
| `MEDIA_DIR` | `<project-root>/public/media` | no | boot | local media directory. **A persistent volume in production** |
| `TANGEN_SITE_JWT_SECRET` | derived from `JWT_SECRET` | **yes** | boot | a separate key for site-auth sessions |
| `TANGEN_SKIP_MIGRATE` | unset | no | boot | `1` skips boot-time system migrations and the SSO re-encryption, for operators who run `db:migrate` themselves |

## Database tuning

| variable | default | when | purpose |
|---|---|---|---|
| `TANGEN_DB_PREPARE` | `true` | boot | prepared statements. Set `false` for poolers that cannot carry them |
| `TANGEN_DB_POOL_MAX` | `10` | boot | pool size **per process** |
| `TANGEN_DB_IDLE_TIMEOUT` | never | boot | seconds before an idle connection closes |
| `TANGEN_DB_CONNECT_TIMEOUT` | driver default | boot | seconds to wait for a connection |

## Search

| variable | default | when | purpose |
|---|---|---|---|
| `TANGEN_SEARCH_FUZZY` | `false` | boot | typo tolerance via `pg_trgm`. Only the exact string `true` enables it |
| `TANGEN_SEARCH_MAX_CONCURRENT` | `4` | boot | concurrent searches per process |
| `TANGEN_SEARCH_MAX_PER_WORKSPACE` | `2` | boot | concurrent searches per workspace |
| `TANGEN_SEARCH_TIMEOUT_MS` | `2000` | boot | `statement_timeout` for one search |
| `TANGEN_SEARCH_MAX_RESULTS` | `100` | boot | ceiling on rows one search returns |
| `TANGEN_SEARCH_MAX_OFFSET` | `1000` | boot | deepest page a caller may request |

## Per-deployment values

Every deployment sets its own `DATABASE_URL`, `TANGEN_DEPLOYMENT_ROLE`, `JWT_SECRET` and URLs in its own `.env`; a laptop's file never names a server's database. There are no per-environment variable suffixes: `SERVER_URL_<ENV>`, `DATABASE_URL_<ENV>`, `TANGEN_ACTIVE_ENV` and `TANGEN_ENV_ID` went with the Environment model (September 2026, migration 0051), together with `TANGEN_KEEP_ENVIRONMENT` which only that migration reads. See [Deployments](/reference/deployments).

## Services

| variable | required when | secret | purpose |
|---|---|---|---|
| `SMTP_HOST` `SMTP_PORT` `SMTP_USER` `SMTP_PASS` `SMTP_FROM` | the mail service is `smtp` | `SMTP_PASS` **yes** | the SMTP transport |
| `AWS_ACCESS_KEY_ID` `AWS_SECRET_ACCESS_KEY` | the `s3` storage adapter omits explicit credentials | **yes** | picked up by the S3 adapter (AWS, R2, Spaces, MinIO) |
| `GOOGLE_TRANSLATE_API_KEY` `GOOGLE_TRANSLATE_REFERER` | machine translation is on | key **yes** | machine translation |
| `EMBEDDINGS_API_KEY` | knowledge uses an OpenAI-compatible endpoint without `apiKey` in config | **yes** | bearer key for the embeddings endpoint |

## Behaviour switches

| variable | default | when | purpose |
|---|---|---|---|
| `TANGEN_CORS_MODE` | `enforce` | live | `enforce` (the default) refuses origins no workspace declared; `observe` restores the old process-wide union and only logs the divergences, as a migration window. An unrecognised value enforces |
| `TANGEN_ACCESS_LOG` | errors only | live | `1` logs every request, `0` none |
| `TANGEN_LOG_LEVEL` | `debug` in development, `info` in production | boot | the lowest level written: `debug`, `info`, `warn`, `error`. `warn` quiets a development boot |
| `TANGEN_QUERY_MONITOR` | on in development | live | forces the **Performance Monitor** on (`1`) or off (`0`). The Admin toggle wins. The variable keeps the older name; the product is Performance Monitor |
| `TANGEN_TELEMETRY` | follows `TANGEN_QUERY_MONITOR`'s default | live | collects recent operational events in memory (`1`) or not (`0`). Off keeps nothing subscribed - no ring, no metrics, no timer. **Nothing is ever sent anywhere** |
| `TANGEN_JOBS_INLINE` | unset | live | `1` runs queued tasks inline in the request process, for single-process deployments and tests |
| `TANGEN_COOKIE_SECURE` | `Secure` when `NODE_ENV` is production or staging | live | overrides the refresh cookie's `Secure` flag in either direction |
| `TANGEN_COOKIE_NAME` | `refresh_token_<PORT>` on a development deployment; `refresh_token` otherwise | live | the refresh cookie's name. Browsers key cookies by host and ignore the port, so two deployed processes behind one host name need a name each |
| `NO_COLOR` | unset | boot | disables ANSI colour |

## Development and tooling

| variable | read by | purpose |
|---|---|---|
| `TANGEN_DEV_SECRET_FILE` | api | where the generated development JWT secret is kept |
| `TANGEN_SKIP_DB_CHECK` | cli | `1` skips `tangen dev`'s database reachability check |
| `ADMIN_PORT`, `TANGEN_DEV_API_URL` | admin dev server | the Vite dev server's port and API proxy target |
| `TANGEN_APP_ROOT` | admin dev server | the project root the Vite dev server loads `.env` from. Defaults to two levels above `@tangen/admin`; set it when the Admin runs outside a standard project layout |
| `TANGEN_API_URL`, `TANGEN_API_KEY` | cli (`tangen mcp`) | the MCP stdio bridge's target and key |
| `API_UPSTREAM` | admin (Docker) | where the Admin container's nginx proxies `/api`, `/media` and `/embed`. The Admin needs no API variable of its own - it resolves one at runtime from `window.__TANGEN_CONFIG__`, a `tangen:config` meta tag, or its own origin |
| `POSTGRES_PASSWORD` | Docker Compose | the bundled Postgres password |

## Production checklist

- `JWT_SECRET` set, and not the development file.
- `NODE_ENV=production`.
- `MEDIA_DIR` on a persistent volume, or an S3-compatible adapter configured.
- `REALTIME_FANOUT=postgres` if you run several processes without Redis.
- Every secret above supplied by your platform's secret store, not a `.env`
  file in the image.

## Related

- [Configuration](/reference/configuration) · [Deployments](/reference/deployments)

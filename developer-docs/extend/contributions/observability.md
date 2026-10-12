---
title: Observability
description: "Logging from an extension with ctx.log, and how that differs from audit, telemetry and the Performance Monitor - which is which, and what you may write to."
audience: extension-developer
type: guide
status: stable
lastVerified: 2026-09-02
verification: source
verifiedBy: packages/types/src/extension.ts
---

# Observability

Four different things, often confused. Only one of them is yours to write to.

| | what it is | yours? |
|---|---|---|
| **Logging** | lines your extension writes | **yes**, `ctx.log` |
| **Audit** | the platform's durable, complete record of who did what | no - it records you |
| **Telemetry** | recent operational events kept **in memory**, per process | no public extension API |
| **Performance Monitor** | a per-request developer tool in the Admin's Devspace | no - you benefit from it |

## Logging

```ts
handler: async (req, ctx) => {
  ctx.log(`sync requested (request ${req.requestId})`)
}
```

Include `req.requestId` - it is the platform's correlation id, echoed to the
client as `X-Tangen-Request-Id`, so a user's report and your log line can be
joined.

**Never log** a secret, a credential from a provider's error, a request body, or
content. Log what happened and which request it was.

## Audit is authoritative

`audit_log` and workspace activity are durable, complete and unsampled. They are
the platform's record, and they already capture the actions your routes perform
through the content client.

Do not build your own audit trail for content changes - it will disagree with
the real one, and the real one is the one people trust.

## Telemetry is not an extension surface

Telemetry is a **Core capability with no persistence**: a per-process, bounded,
ephemeral ring of recent operational events plus a small aggregate. It writes no
table, exports nowhere, and is off unless enabled.

There is **no `ext:telemetry`**, and no public API for an extension to emit
into it. Do not design around one.

It is also **lossy by construction** - bounded means old events are dropped -
so nothing that matters should depend on it. That is exactly why audit exists
separately.

## Performance Monitor

The Admin's Devspace tool: per-request SQL with real execution and pool-queue
time, duplicate and N+1 detection, page vitals.

Your extension's queries appear in it like anything else, which makes it the
right way to find out that your panel does forty queries. Nothing to integrate.

The product name is **Performance Monitor**. The environment variable
`TANGEN_QUERY_MONITOR` and the flag `queryMonitorEnabled` keep the older name;
those are the identifiers, and the product is not called that.

## Errors

A thrown error is reported to the client under the request's correlation id
**without your exception text**. Keep that property in what you return: no stack
traces, no driver messages, no rejected values.

## Related

- [Server routes](/extend/contributions/routes) ·
  [Permissions and security](/extend/contributions/permissions) ·
  [Performance](/build/performance)

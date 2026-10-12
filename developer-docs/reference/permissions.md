---
title: Permissions
description: Roles, API key scopes and actions, extension permissions, and why a capability is not a permission.
audience: site-developer
type: reference
status: stable
lastVerified: 2026-09-06
verification: source
verifiedBy: developer-docs/.generated/platform-facts.json
---

# Permissions

Four different questions, often confused:

| question | answered by |
|---|---|
| Who are you? | **authentication** |
| What kind of account is this? | **role** (members) or **scope + action** (API keys) |
| May you do this specific thing? | **permission** |
| Does this deployment even have that feature? | **capability** |

## Capability is not permission

A capability is `on`, `off` or `unavailable` for a whole deployment. A
permission is about *you*.

- `search` being **`off`** means nobody can search here, whatever their role.
- `search` being **`unavailable`** means it cannot run here at all - a
  dependency or credential is missing - and an operator fixes that, not an
  admin.
- Having no `search: read` action means **you** cannot search, while everyone
  else can.

They produce different errors, and code that treats them alike will tell a user
something false about their own account. An unavailable capability is not a
`403`.

## Member roles

Four, for people who use the Admin:

| role | can |
|---|---|
| `owner` | everything, including workspace deletion and billing-level settings |
| `admin` | everything operational: schema, members, keys, settings |
| `editor` | create, edit and publish content |
| `viewer` | read |

Field-level access rules can narrow what a role sees or edits per content type.

## API keys

A key grants **actions within scopes**. Anything not granted is refused.

| scope | actions |
|---|---|
| `objects` | `read`, `read_draft`, `write`, `publish`, `delete` |
| `media` | `read`, `write`, `delete` |
| `globals` | `read`, `write` |
| `search` | `read` |
| `tables` | `read` |
| `forms` | `read`, `submit` |
| `webhooks` | `read`, `write`, `delete` |
| `schema` | `push`, `pull` |

### The permission document

A key's permissions are an object keyed by scope. Each built-in scope takes
`{ actions: [...] }` - a bare array is refused with a `422` naming the field:

```json
{
  "label": "Website",
  "permissions": {
    "objects": { "actions": ["read"] },
    "media":   { "actions": ["read"] },
    "globals": { "actions": ["read"] }
  }
}
```

Per-type overrides go beside `actions` and win over it:

```json
{ "objects": { "actions": ["read"], "types": { "invoice": [] } } }
```

Two things worth stating plainly:

- **`read` does not include drafts.** A key with `objects: read` sees published
  content only. Reading drafts is the separate `read_draft` action, and it is
  the one that turns a public key into a preview key.
- **A key can be narrowed to specific types.** A per-type override wins over
  the global action list.

Knowledge retrieval has its own audiences, `public` and `internal`, granted per
key under `search.audiences`. **`search: read` on its own retrieves nothing from
content**: every hit is filtered against the same read grants a direct query
would need, so a Knowledge key wants `objects: read` too. See
[Knowledge](/reference/knowledge).

A key that lacks an action gets **`403 FORBIDDEN`**, never a silent empty
result.

## Extension permissions

An extension declares the capabilities it requires in its manifest. Missing one
makes the extension `unavailable` with a safe reason - it never starts, and it
contributes nothing.

Extensions do not get a private authorisation system: an extension route that
touches content goes through the same object permissions as any other caller.

## Identities: agents and services

A key can also be the **credential of an identity**. An identity is a record of
its own (`kind: 'agent'` for an AI agent, `kind: 'service'` for a deployment's
own automation) that holds both a permission document in the key model
(`permissions`) **and** capabilities in the member model (`capabilities`, from
the same catalogue a role uses). A key minted with `identityId` carries no
grants of its own: a request with it runs as the identity, every row, event and
revision it touches names the identity's id with the `agent` or `service` kind,
and suspending or deleting the identity invalidates every credential of it at
once. A plain key never satisfies a capability; an identity does.

Identities are managed by members holding `manage:apiKeys`, in the Admin under
**AI → Agents (MCP)** or over `GET/POST/PATCH/DELETE /api/v1/admin/identities`.
An agent may name the member it acts for with `X-Tangen-On-Behalf-Of: <memberId>`;
that records the member as the initiator and changes nothing about authority.

## Scope

Every credential is scoped to **one workspace on one deployment**. A key
issued on development does not exist on production, and there is no request
parameter that changes that. Crossing workspaces is a super-admin capability,
not something a key or a role can do.

## Related

- [Authentication](/reference/authentication) · [Errors](/reference/errors) ·
  [Delivery API](/reference/delivery-api) ·
  [Extension manifest](/reference/extension-manifest)

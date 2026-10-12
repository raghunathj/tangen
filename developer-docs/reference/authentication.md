---
title: Authentication
description: The four authentication systems, the Site users extension's options, its REST endpoints, and why there is no SDK auth surface.
audience: site-developer
type: reference
status: stable
package: "@tangen/ext-auth"
lastVerified: 2026-09-13
verification: source
verifiedBy: extensions/auth/src/contract.ts
---

# Authentication

Tangen has **four** independent things called authentication. Confusing them is
the most common mistake in this area.

| system | who | credential | for |
|---|---|---|---|
| **Admin members** | your team | email + password, member JWT | the Admin panel |
| **API keys** | your application's server | `Authorization: Bearer <key>` | reading and writing content |
| **Site users** | your site's end users | site JWT + refresh token | accounts on the site you build |
| **Preview tokens** | an editor previewing | a short-lived token | reading drafts |

This page is about **site users**. API keys are in
[Permissions](/reference/permissions).

Site users is the `@tangen/ext-auth` extension (bundled with `@tangen/cms`,
`tangen extension install auth`). It is the first **site identity provider**
on the platform's seam: a workspace may run a different provider instead,
and everything below that reads "the site user" keeps working.

## `defineAuthOptions`

The extension's options, on its entry in `app/config/extensions.ts`:

```ts app/config/extensions.ts
import { defineExtensions } from '@tangen/cms'
import { defineAuthOptions } from '@tangen/ext-auth'

export default defineExtensions([
  { resolve: '@tangen/ext-auth', options: defineAuthOptions({
    allowRegistration: true,
    allowAnonymous: false,
    roles: ['user', 'moderator', 'admin'],
    otp: { channels: ['email'] },
    providers: [
      { name: 'google', clientId: process.env.GOOGLE_CLIENT_ID!, clientSecret: 'GOOGLE_CLIENT_SECRET' },
    ],
    profileFields: [
      { name: 'bio', label: 'Bio', fieldType: 'textarea', config: { validation: { maxLength: 500 } } },
      { name: 'company', label: 'Company', fieldType: 'text' },
    ],
    token: { accessTtl: '15m', refreshTtl: '30d' },
    ssoRedirectUrl: 'https://example.com/auth/callback',
  }) },
])
```

| option | type | default | means |
|---|---|---|---|
| `providers` | `SsoProviderConfig[]` | none | SSO providers: `google`, `github`, or `oidc` with an `issuer` (any OpenID Connect provider). `clientSecret` is the NAME of the deployment variable, read through `ctx.secrets` only; the built-in hosts are manifest grants and an issuer's host is granted through `network:option(providers.*.issuer)` |
| `profileFields` | `ProfileFieldDef[]` | none | extra columns on the user record. Each becomes a **real column**, added by `tangen push` |
| `roles` | `string[]` | `['user', 'moderator', 'admin']` | the roles this site hands out |
| `allowRegistration` | `boolean` | `true` | may new users sign up with a password |
| `allowAnonymous` | `boolean` | `false` | enable guest sessions |
| `otp.channels` | `('email' \| 'sms')[]` | `['email']` | where a one-time code may go |
| `otp.ttlSeconds` | `number` | `600` | how long a code lives |
| `otp.allowSignup` | `boolean` | `true` | may a code create the account it is for |
| `sms.send` | `(to, message) => Promise<void>` | - | the SMS sender the `sms` channel needs (or an `onOtpSend` hook) |
| `mail` | `{ fromEmail?, fromName?, otpSubject?, resetSubject? }` | - | the mailer's sender and subjects for codes and reset messages |
| `token.accessTtl` | `string` | `'15m'` | access JWT lifetime |
| `token.refreshTtl` | `string` | `'30d'` | refresh token lifetime; refresh tokens always rotate |
| `ssoRedirectUrl` | `string` | - | where to send the browser after SSO, with `?accessToken=…&refreshToken=…` appended |
| `hooks` | `SiteAuthHooks` | - | lifecycle hooks: `onBeforeRegister`, `onAfterRegister`, `onBeforeLogin`, `onAfterLogin`, `onOtpSend`, `onPasswordResetRequest`, `hashPassword`, `verifyPassword`, `buildTokenPayload` |

### Profile fields

A profile field uses the **same shape as a content field** - the same
`fieldType` names and the same `config`. Sections and `component` are the only
exclusions. `adminEditable: false` keeps a field to what the user writes.

Names must be **snake_case**, and this is checked at compile time:
`profileFields: [{ name: 'firstName', … }]` is a type error that names the
offending field, before `tangen push` ever runs.

Each field becomes a real column on the user table, so adding one is a schema
change and needs a push.

## Endpoints

Site authentication is **REST**, under `/api/v1/ext/auth`. Every route wants
the site key (an API key granted **Site users → sessions**), except the SSO
callback the provider's redirect lands on.

| method | path | does |
|---|---|---|
| `POST` | `/api/v1/ext/auth/register` | create an account (201) |
| `POST` | `/api/v1/ext/auth/login` | exchange credentials for tokens |
| `POST` | `/api/v1/ext/auth/logout` | revoke the session (`refreshToken` in the body), or every session |
| `POST` | `/api/v1/ext/auth/refresh` | exchange a refresh token for a new pair |
| `GET` | `/api/v1/ext/auth/me` | the current user, with profile fields and sign-in methods |
| `PATCH` | `/api/v1/ext/auth/me` | update the current user's name and profile |
| `POST` | `/api/v1/ext/auth/otp/send` | send a one-time code to `{ email }` or `{ phone }` |
| `POST` | `/api/v1/ext/auth/otp/verify` | exchange a code for tokens (creates the account on first use) |
| `POST` | `/api/v1/ext/auth/password-reset/request` | start a reset |
| `POST` | `/api/v1/ext/auth/password-reset/confirm` | complete a reset (ends every session) |
| `POST` | `/api/v1/ext/auth/anonymous` | start a guest session |
| `POST` | `/api/v1/ext/auth/anonymous/convert` | turn a guest into a real account |
| `GET` | `/api/v1/ext/auth/sso/:provider` | begin the provider's flow (`?mode=json` answers the URL) |
| `GET` | `/api/v1/ext/auth/sso/:provider/callback` | finish it (public; register it with the provider, `?workspace=` included) |

`/api/v1/admin/ext/auth/*` is the **Admin's** user-management surface, not
part of the site-user API.

## There is no SDK auth surface

`@tangen/sdk` has no `auth` namespace, no `login()`, no `getSession()`. Site
authentication is REST-only in v1: you call the endpoints above with `fetch`,
store the tokens, and send the access token yourself.

This is a real limitation, and it is recorded rather than hidden. Do not expect
an SDK method to appear - if an example shows one, the example is wrong.

```ts app/lib/site-auth.ts
export async function login(email: string, password: string) {
  const res = await fetch(`${process.env.TANGEN_API_URL}/api/v1/ext/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Tangen-Key': process.env.TANGEN_API_KEY! },
    body: JSON.stringify({ email, password }),
  })
  if (!res.ok) throw new Error('login failed')
  return (await res.json()).data   // { accessToken, refreshToken, expiresIn, user }
}
```

## Security notes

- Keep the **API key** on the server. It is not a site-user credential and must
  never reach a browser.
- A site-user access token is short-lived by default (15 minutes) and refresh
  tokens rotate. Store the refresh token where your framework stores sessions.
- The access token carries `aud: tangen:site` and is signed with
  `TANGEN_SITE_JWT_SECRET` (else a key derived from `JWT_SECRET`), so it never
  verifies as an Admin member. Set `TANGEN_SITE_JWT_SECRET` in production.
- `allowAnonymous` creates real user rows with `isAnonymous: true`. Treat them
  as untrusted until converted.
- Enabling a provider requires its client id and secret; put the secret in the
  deployment's variables and name it in the config, never paste it.
- Blocking a user, changing their password, or revoking a session ends the
  session at once: the access token stops verifying on the next request.

## Related

- [Permissions](/reference/permissions) · [Configuration](/reference/configuration)
  · [Errors](/reference/errors) · [SDK](/reference/sdk)

---
title: Site authentication
description: Accounts for your site's users through the Site users extension, and calling its REST endpoints.
audience: site-developer
type: guide
status: stable
package: "@tangen/ext-auth"
lastVerified: 2026-09-13
verification: executable
verifiedBy: extensions/auth/__tests__/site-routes.test.ts
---

# Site authentication

Accounts for **your site's end users** - not your team's Admin logins, and not
your application's API key. The three are separate systems; see
[Reference → Authentication](/reference/authentication) for the full map.

Site users is a bundled **extension** (`@tangen/ext-auth`, it arrives with
`@tangen/cms`). Its tables exist only where it is installed, and its routes
live under `/api/v1/ext/auth`.

> **This is REST-only in v1.** `@tangen/sdk` has no `auth` namespace. You call
> the endpoints below with `fetch`. That is a real limitation, stated here so
> you do not go looking for an SDK method that does not exist.

## Install and configure

```bash
bun run tangen extension install auth
```

The options go on the extension's entry in `app/config/extensions.ts`:

```ts app/config/extensions.ts
import { defineExtensions } from '@tangen/cms'
import { defineAuthOptions } from '@tangen/ext-auth'

export default defineExtensions([
  { resolve: '@tangen/ext-auth', options: defineAuthOptions({
    allowRegistration: true,
    profileFields: [
      { name: 'display_name', label: 'Display name', fieldType: 'text' },
      { name: 'bio', label: 'Bio', fieldType: 'textarea', config: { validation: { maxLength: 500 } } },
    ],
    token: { accessTtl: '15m', refreshTtl: '30d' },
  }) },
])
```

```bash
bun run tangen push
```

**Profile fields become real columns**, so adding one is a schema change and
needs a push. Their names must be **snake_case**, and that is checked at
compile time - `displayName` is a type error naming the field, before push
runs.

## Sign-in methods

Password, one-time codes by **email or SMS**, single sign-on, and guest
sessions - each on by configuration:

```ts
otp: { channels: ['email', 'sms'] },
sms: { send: async (to, message) => { /* your SMS provider */ } },   // needed for the sms channel
allowAnonymous: true,
providers: [
  { name: 'google', clientId: process.env.GOOGLE_CLIENT_ID!, clientSecret: 'GOOGLE_CLIENT_SECRET' },
  { name: 'github', clientId: process.env.GITHUB_CLIENT_ID!, clientSecret: 'GITHUB_CLIENT_SECRET' },
  { name: 'oidc', id: 'okta', issuer: 'https://acme.okta.com', clientId: '…', clientSecret: 'OKTA_CLIENT_SECRET' },
],
ssoRedirectUrl: 'https://example.com/auth/callback',
```

`clientSecret` is the **name** of the deployment variable holding the secret,
never the secret itself. Send the browser to `/api/v1/ext/auth/sso/google`
(with the site key); Tangen completes the flow and redirects to
`ssoRedirectUrl` with `?accessToken=…&refreshToken=…`. The Admin's
**Sign-in methods** page prints the exact callback URL to register with each
provider. `oidc` covers any OpenID Connect issuer (Okta, Entra, Auth0,
Keycloak).

Codes by email go through the workspace mailer unless an `onOtpSend` hook
delivers them itself.

## Every call carries your site key

The sign-in endpoints are **keyed**, not anonymous. Send `X-Tangen-Key` (or
`Authorization: Bearer tgn_…`) with a key granted **Site users → sessions**:

```jsonc
{ "permissions": { "objects": { "actions": ["read"] }, "extensions": { "auth": { "actions": ["sessions"] } } } }
```

Without the header you get `401 API key required`; with a key that lacks the
grant, `403 This API key cannot sign users in`. These calls therefore belong
on your **server**, where the key lives.

## Register and log in

```ts app/lib/site-auth.ts
const API = process.env.TANGEN_API_URL!
const KEY = process.env.TANGEN_API_KEY!
const headers = { 'Content-Type': 'application/json', 'X-Tangen-Key': KEY }

export async function register(email: string, password: string) {
  const res = await fetch(`${API}/api/v1/ext/auth/register`, {
    method: 'POST', headers, body: JSON.stringify({ email, password }),
  })
  if (!res.ok) throw new Error('register failed')
  return (await res.json()).data          // { id, email, name }
}

export async function login(email: string, password: string) {
  const res = await fetch(`${API}/api/v1/ext/auth/login`, {
    method: 'POST', headers, body: JSON.stringify({ email, password }),
  })
  if (!res.ok) throw new Error('login failed')
  return (await res.json()).data          // { accessToken, refreshToken, expiresIn, user }
}
```

Everything comes back under **`data`**, like the rest of the API. A
validation failure is `422` with `error.fieldErrors` naming each field.

## The current user

```ts
export async function me(accessToken: string) {
  const res = await fetch(`${API}/api/v1/ext/auth/me`, {
    headers: { 'X-Tangen-Key': KEY, Authorization: `Bearer ${accessToken}` },
  })
  return res.ok ? (await res.json()).data : null
}
```

`PATCH /api/v1/ext/auth/me` updates the name and the profile fields you
declared.

## Refreshing

The access token is short-lived - 15 minutes by default. Exchange the refresh
token at `POST /api/v1/ext/auth/refresh` when it expires. Each refresh returns
a **new** refresh token and spends the old one; store it and discard the old
one.

## Protecting a route

Verify on the **server**, on every request that matters:

```ts
const user = await me(getAccessTokenFromSession(request))
if (!user) return redirect('/login')
```

Do not trust a client-side flag. The access token is the credential; a
`loggedIn` boolean in local storage is a suggestion.

A Tangen custom route declaring `auth: 'user'` does this for you:
`ctx.requireAuth()` answers the site user or 401.

## Storing tokens

Put the refresh token where your framework puts sessions - an httpOnly,
`Secure`, `SameSite` cookie, or a server session. Keep it out of
JavaScript-readable storage.

## Other endpoints

One-time codes (`otp/send`, `otp/verify`), password reset
(`password-reset/request`, `password-reset/confirm`), guest sessions
(`anonymous`, `anonymous/convert`), logout, and the SSO pair per provider.
The full list is in [Reference → Authentication](/reference/authentication).

## Site users are not API keys

A signed-in site user does **not** get to read your content directly. Your
server reads content with the API key and decides what that user may see. A
site-user token is not accepted by the content endpoints.

## Common mistakes

- **Looking for `tangen.auth.login()`.** It does not exist.
- **camelCase profile field names.** Compile error, by design.
- **Storing the refresh token in `localStorage`.**
- **Ignoring rotation** and reusing a spent refresh token.
- **Confusing site users with Admin members.**
- **Registering the SSO callback without its `?workspace=` query string.**

## Related

- [Authentication reference](/reference/authentication) - every endpoint and
  every option
- [Permissions](/reference/permissions) · [Errors](/reference/errors)

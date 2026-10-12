/**
 * File Name: methods.tsx
 * Purpose: How people sign in to this site, as the extension's options
 *          declare it: password, one-time codes, single sign-on with the
 *          callback URL each provider must be told, guest sessions, roles,
 *          token lifetimes, profile fields. Read-only here: the options
 *          live in code, on the extension's entry in extensions.ts.
 *
 * Author: Raghunath J
 * License: MIT
 */
import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { IconUsers } from '@tangen/icons'
import { AdminPage, Badge, Callout, CodeBlock, ErrorState, FactGrid, FactRow, FormSection, Skeleton, Text, Table, TableBody, TableCell, TableHead, TableHeaderCell, TableRow } from '@/kit'
import { authApi, type Methods } from '../api'
import { usersTabs } from './users-list'

const on = (v: boolean, yes = 'On', no = 'Off') => <Badge variant={v ? 'success' : 'neutral'}>{v ? yes : no}</Badge>

export function SignInMethodsPage() {
  const { workspaceId } = useParams<{ workspaceId: string }>()
  const base = `/${workspaceId}/extensions/auth`
  const [methods, setMethods] = useState<Methods | null>(null)
  const [error, setError] = useState<string | null>(null)
  const load = () => authApi.methods().then((m) => { setMethods(m); setError(null) }).catch((e) => setError((e as Error).message))
  useEffect(() => { void load() }, [])

  return (
    <AdminPage title="Site users" icon={<IconUsers className="size-4" />} description="The accounts on your site" tabs={usersTabs(base)} access={{ capability: 'auth:read' }}>
      {error ? <ErrorState message={error} retry={load} /> : !methods ? <Skeleton variant="rows" rows={6} /> : (
        <>
          <Callout variant="info" title="Configured in code" className="mb-6">
            These come from the extension's options on its entry in app/config/extensions.ts. Change them there and redeploy.
          </Callout>

          <FormSection title="Ways to sign in" description="What a visitor can use to open an account and come back.">
            <FactGrid className="px-0">
              <div>
                <FactRow label="Password"><span className="inline-flex items-center gap-2">{on(methods.password.enabled)}<Text variant="help" as="span">registration {methods.password.registration ? 'open' : 'closed'}</Text></span></FactRow>
                <FactRow label="One-time codes">
                  <span className="inline-flex flex-wrap items-center gap-1.5">
                    {methods.otp.channels.map((c) => <Badge key={c} variant="neutral">{c === 'sms' ? 'SMS' : 'Email'}</Badge>)}
                    <Text variant="help" as="span" className="ml-1">{methods.otp.delivery === 'hook' ? 'delivered by your hook' : methods.otp.channels.includes('sms') && !methods.otp.smsConfigured ? 'SMS needs a sender' : 'delivered by the mailer'}</Text>
                  </span>
                </FactRow>
                <FactRow label="Guest sessions">{on(methods.anonymous, 'Allowed', 'Off')}</FactRow>
              </div>
              <div>
                <FactRow label="Roles"><span className="inline-flex flex-wrap gap-1.5">{methods.roles.map((r) => <Badge key={r} variant="neutral">{r}</Badge>)}</span></FactRow>
                <FactRow label="Access token">{methods.token.accessTtl}</FactRow>
                <FactRow label="Refresh token">{methods.token.refreshTtl}</FactRow>
              </div>
            </FactGrid>
          </FormSection>

          <FormSection title="Single sign-on" description="Each provider needs its callback URL registered exactly as shown, query string included.">
            {methods.sso.length === 0 ? (
              <Text variant="help" className="py-2">No provider declared. Add `providers` to the options for Google, GitHub or any OpenID Connect issuer.</Text>
            ) : methods.sso.map((p) => (
              <div key={p.id} className="space-y-2 py-2">
                <div className="flex items-center gap-2">
                  <Text variant="strong">{p.label}</Text>
                  <Badge variant="neutral">{p.name === 'oidc' ? 'OpenID Connect' : p.name}</Badge>
                  {p.configured ? <Badge variant="success">Secret found</Badge> : <Badge variant="warning">Secret missing on this deployment</Badge>}
                </div>
                <CodeBlock code={methods.callbackUrls[p.id] ?? ''} />
              </div>
            ))}
            {methods.ssoRedirectUrl && <FactRow label="After sign-in" className="mt-2">{methods.ssoRedirectUrl}</FactRow>}
          </FormSection>

          <FormSection title="Profile fields" description="Real columns on the users table, added by tangen push.">
            {methods.profileFields.length === 0 ? (
              <Text variant="help" className="py-2">None declared. Add `profileFields` to the options and push.</Text>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHead>
                    <TableRow>
                      <TableHeaderCell>Field</TableHeaderCell>
                      <TableHeaderCell>Type</TableHeaderCell>
                      <TableHeaderCell>Required</TableHeaderCell>
                      <TableHeaderCell>Admin may edit</TableHeaderCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {methods.profileFields.map((f) => (
                      <TableRow key={f.name}>
                        <TableCell><span className="text-fg">{f.label}</span> <span className="ml-2 font-mono text-ui-2xs text-fg-subtle">{f.name}</span></TableCell>
                        <TableCell>{f.fieldType}</TableCell>
                        <TableCell>{f.required ? 'Yes' : 'No'}</TableCell>
                        <TableCell>{f.adminEditable === false ? 'No' : 'Yes'}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </FormSection>
        </>
      )}
    </AdminPage>
  )
}

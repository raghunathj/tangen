import { apiUrl } from '@/lib/api-origin'
import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useAuthStore } from '@/lib/auth'

interface SetupCheckResult {
  needsSetup: boolean
  workspaceName: string | null
}

interface EmailCheckResult {
  exists: boolean
  name: string | null
}

interface SetupResult {
  token: string
  member: { id: string; name: string; email: string; role: string }
}

type Step =
  | { type: 'loading' }
  | { type: 'use-session'; name: string; email: string }       // already logged in
  | { type: 'email-entry' }                                    // enter email to continue
  | { type: 'existing-account'; email: string; name: string } // email found → password only
  | { type: 'new-account'; email: string }                    // email not found → full form

export default function WorkspaceSetupPage() {
  const { workspaceId } = useParams<{ workspaceId: string }>()
  const navigate = useNavigate()
  const { accessToken, member, setAuth } = useAuthStore()

  const [workspaceName, setWorkspaceName] = useState<string | null>(null)
  const [step, setStep] = useState<Step>({ type: 'loading' })

  const [email, setEmail] = useState('')
  const [name, setName] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    if (!workspaceId) return
    fetch(apiUrl(`/api/v1/setup/${workspaceId}`))
      .then((r) => r.json() as Promise<SetupCheckResult>)
      .then(async ({ needsSetup, workspaceName: wsName }) => {
        setWorkspaceName(wsName)
        if (!needsSetup) {
          navigate(`/${workspaceId}`, { replace: true })
          return
        }
        if (accessToken && member) {
          // Scenario 1: already signed in — offer to reuse the current account
          setStep({ type: 'use-session', name: (member as any).name ?? member.email, email: member.email })
        } else {
          setStep({ type: 'email-entry' })
        }
      })
      .catch(() => setStep({ type: 'email-entry' }))
  }, [workspaceId, accessToken, member, navigate])

  async function postSetup(body: Record<string, string>) {
    const res = await fetch(apiUrl(`/api/v1/setup/${workspaceId}`), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    const data = await res.json() as { error?: { message?: string } } & SetupResult
    if (!res.ok) throw new Error(data.error?.message ?? 'Setup failed')
    setAuth(data.token, {
      id: data.member.id,
      name: data.member.name,
      email: data.member.email,
      role: data.member.role,
      workspaceId: workspaceId!,
    })
    navigate(`/${workspaceId}`, { replace: true })
  }

  // Scenario 1: already logged in — use current session as proof of identity
  async function handleUseSession() {
    if (!workspaceId || !accessToken || !member) return
    setError(null); setSubmitting(true)
    try { await postSetup({ email: member.email, sessionToken: accessToken }) }
    catch (err) { setError(err instanceof Error ? err.message : 'Setup failed') }
    finally { setSubmitting(false) }
  }

  // Step 1 (scenarios 2 & 3): check whether email already exists
  async function handleEmailContinue(e: React.FormEvent) {
    e.preventDefault()
    const trimmed = email.trim()
    if (!trimmed || !workspaceId) return
    setError(null); setSubmitting(true)
    try {
      const res = await fetch(apiUrl(`/api/v1/setup/${workspaceId}/check-email?email=${encodeURIComponent(trimmed)}`))
      const data = await res.json() as EmailCheckResult
      if (data.exists && data.name) {
        setStep({ type: 'existing-account', email: trimmed, name: data.name })
      } else {
        setStep({ type: 'new-account', email: trimmed })
      }
    } catch { setError('Could not check email. Please try again.') }
    finally { setSubmitting(false) }
  }

  // Scenario 2: email found in another workspace — verify password
  async function handleExistingAccount(e: React.FormEvent) {
    e.preventDefault()
    if (step.type !== 'existing-account') return
    setError(null); setSubmitting(true)
    try { await postSetup({ email: step.email, password }) }
    catch (err) { setError(err instanceof Error ? err.message : 'Incorrect password') }
    finally { setSubmitting(false) }
  }

  // Scenario 3: new email — full registration
  async function handleNewAccount(e: React.FormEvent) {
    e.preventDefault()
    if (step.type !== 'new-account') return
    if (password !== confirmPassword) { setError('Passwords do not match'); return }
    setError(null); setSubmitting(true)
    try { await postSetup({ email: step.email, name, password }) }
    catch (err) { setError(err instanceof Error ? err.message : 'Setup failed') }
    finally { setSubmitting(false) }
  }

  function goBackToEmail() {
    setStep({ type: 'email-entry' })
    setPassword(''); setConfirmPassword(''); setError(null)
  }

  const displayName = workspaceName ?? workspaceId

  if (step.type === 'loading') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-surface-sunken">
        <p className="text-sm text-fg-muted">Loading…</p>
      </div>
    )
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-surface-sunken px-4">
      <div className="w-full max-w-sm">
        <div className="flex flex-col items-center mb-8 gap-2">
          <h1 className="text-xl font-semibold text-fg text-center">
            Complete your workspace setup for &ldquo;{displayName}&rdquo;
          </h1>
          <p className="text-sm text-fg-muted text-center">
            {step.type === 'use-session' && "You're already signed in. Use this account to become the first owner."}
            {step.type === 'email-entry' && 'Enter your email to get started.'}
            {step.type === 'existing-account' && `Welcome back, ${step.name}. Enter your password to join as owner.`}
            {step.type === 'new-account' && 'Create your account to get started.'}
          </p>
        </div>

        <div className="bg-surface border border-border rounded-xl p-6 shadow-sm space-y-4">

          {/* Scenario 1: reuse current session */}
          {step.type === 'use-session' && (
            <>
              <div className="rounded-lg bg-surface-sunken border border-border px-4 py-3">
                <p className="text-sm font-medium text-fg">{step.name}</p>
                <p className="text-xs text-fg-muted mt-0.5">{step.email}</p>
              </div>
              {error && <p className="text-sm text-danger-fg">{error}</p>}
              <Button className="w-full" onClick={handleUseSession} disabled={submitting}>
                {submitting ? 'Setting up…' : 'Use this account'}
              </Button>
              <button
                type="button"
                onClick={() => { setStep({ type: 'email-entry' }); setError(null) }}
                className="w-full text-sm text-fg-muted hover:text-fg text-center"
              >
                Use a different account
              </button>
            </>
          )}

          {/* Step 1: email entry */}
          {step.type === 'email-entry' && (
            <form onSubmit={handleEmailContinue} className="space-y-4">
              <div className="space-y-1">
                <label htmlFor="email" className="text-sm font-medium text-fg">Email</label>
                <Input
                  id="email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  required
                  autoFocus
                />
              </div>
              {error && <p className="text-sm text-danger-fg">{error}</p>}
              <Button type="submit" className="w-full" disabled={submitting}>
                {submitting ? 'Checking…' : 'Continue'}
              </Button>
            </form>
          )}

          {/* Scenario 2: existing account - password only */}
          {step.type === 'existing-account' && (
            <form onSubmit={handleExistingAccount} className="space-y-4">
              <div className="rounded-lg bg-surface-sunken border border-border px-4 py-3">
                <p className="text-sm font-medium text-fg">{step.name}</p>
                <p className="text-xs text-fg-muted mt-0.5">{step.email}</p>
              </div>
              <div className="space-y-1">
                <label htmlFor="password" className="text-sm font-medium text-fg">Password</label>
                <Input
                  id="password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Your password"
                  required
                  autoFocus
                />
              </div>
              {error && <p className="text-sm text-danger-fg">{error}</p>}
              <Button type="submit" className="w-full" disabled={submitting}>
                {submitting ? 'Joining…' : 'Join as owner'}
              </Button>
              <button type="button" onClick={goBackToEmail} className="w-full text-sm text-fg-muted hover:text-fg text-center">
                Use a different email
              </button>
            </form>
          )}

          {/* Scenario 3: new account - full form */}
          {step.type === 'new-account' && (
            <form onSubmit={handleNewAccount} className="space-y-4">
              <div className="rounded-lg bg-surface-sunken border border-border px-4 py-2.5">
                <p className="text-xs text-fg-muted">{step.email}</p>
              </div>
              <div className="space-y-1">
                <label htmlFor="name" className="text-sm font-medium text-fg">Full name</label>
                <Input
                  id="name"
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Your name"
                  required
                  autoFocus
                />
              </div>
              <div className="space-y-1">
                <label htmlFor="password" className="text-sm font-medium text-fg">Password</label>
                <Input
                  id="password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="At least 8 characters"
                  required
                />
              </div>
              <div className="space-y-1">
                <label htmlFor="confirm" className="text-sm font-medium text-fg">Confirm password</label>
                <Input
                  id="confirm"
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="Repeat password"
                  required
                />
              </div>
              {error && <p className="text-sm text-danger-fg">{error}</p>}
              <Button type="submit" className="w-full" disabled={submitting}>
                {submitting ? 'Creating account…' : 'Create owner account'}
              </Button>
              <button type="button" onClick={goBackToEmail} className="w-full text-sm text-fg-muted hover:text-fg text-center">
                Use a different email
              </button>
            </form>
          )}

        </div>
      </div>
    </div>
  )
}

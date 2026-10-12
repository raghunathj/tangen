import { apiUrl } from '@/lib/api-origin'
import { Callout } from '@tangen/ui'
import { useEffect, useState } from 'react'
import { useParams, useNavigate, useLocation } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useAuthStore } from '@/lib/auth'

export default function WorkspaceLoginPage() {
  const { workspaceId } = useParams<{ workspaceId: string }>()
  const navigate = useNavigate()
  const location = useLocation()
  const { setAuth } = useAuthStore()

  // Workspace name may be passed as router state from the switcher (avoids a fetch)
  const [workspaceName, setWorkspaceName] = useState<string>(
    (location.state as any)?.workspaceName ?? ''
  )
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  // Fetch workspace name from the public setup endpoint if not passed as state
  useEffect(() => {
    if (workspaceName || !workspaceId) return
    fetch(apiUrl(`/api/v1/setup/${workspaceId}`))
      .then((r) => r.json() as Promise<{ workspaceName?: string | null }>)
      .then(({ workspaceName: wsName }) => { if (wsName) setWorkspaceName(wsName) })
      .catch(() => {})
  }, [workspaceId, workspaceName])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setLoading(true)
    try {
      const res = await fetch(apiUrl('/api/auth/login'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ email, password, workspaceId }),
      })
      if (!res.ok) {
        const data = await res.json() as { error?: { message?: string } }
        throw new Error(data.error?.message ?? 'Login failed')
      }
      const { accessToken, member } = await res.json() as {
        accessToken: string
        member: { memberId: string; workspaceId: string; role: string; email: string }
      }
      setAuth(accessToken, member)
      navigate(`/${workspaceId}/dashboard`, { replace: true })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed')
    } finally {
      setLoading(false)
    }
  }

  const displayName = workspaceName || workspaceId

  return (
    <div className="min-h-screen flex items-center justify-center bg-surface-sunken px-4">
      <div className="w-full max-w-sm">
        <div className="flex flex-col items-center mb-8 gap-2">
          <h1 className="text-xl font-semibold text-fg text-center">
            Sign in to &ldquo;{displayName}&rdquo;
          </h1>
          <p className="text-sm text-fg-muted text-center">
            Enter your credentials for this workspace.
          </p>
        </div>

        <div className="bg-surface border border-border rounded-xl p-6 shadow-sm">
          <form onSubmit={handleSubmit} className="space-y-4">
            <Input
              id="email"
              type="email"
              label="Email"
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail((e.target as HTMLInputElement).value)}
              autoComplete="email"
              required
              autoFocus
            />
            <Input
              id="password"
              type="password"
              label="Password"
              placeholder="••••••••"
              value={password}
              onChange={(e) => setPassword((e.target as HTMLInputElement).value)}
              autoComplete="current-password"
              required
            />
            {error && (
              <Callout variant="danger">
                <p className="text-sm">{error}</p>
              </Callout>
            )}
            <Button type="submit" isLoading={loading} disabled={loading} className="w-full justify-center mt-1">
              Sign in
            </Button>
          </form>
        </div>

        <p className="text-center text-sm text-fg-muted mt-5">
          <button
            type="button"
            onClick={() => navigate('/workspaces')}
            className="hover:text-fg transition-colors"
          >
            Back to workspace list
          </button>
        </p>
      </div>
    </div>
  )
}

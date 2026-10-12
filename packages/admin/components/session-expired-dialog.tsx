

import { useState } from 'react'
import { Callout } from '@tangen/ui'
import { useAuthStore, loginRequest } from '@/lib/auth'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'

export function SessionExpiredDialog() {
  const { sessionExpired, member, setAuth } = useAuthStore((s) => ({
    sessionExpired: s.sessionExpired,
    member: s.member,
    setAuth: s.setAuth,
  }))

  const [email, setEmail] = useState(member?.email ?? '')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setLoading(true)
    try {
      const { accessToken, member: freshMember } = await loginRequest(email, password)
      setPassword('')
      setAuth(accessToken, freshMember)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed')
    } finally {
      setLoading(false)
    }
  }

  return (
    <Dialog open={sessionExpired}>
      <DialogContent
        showClose={false}
        onEscapeKeyDown={(e) => e.preventDefault()}
        onInteractOutside={(e) => e.preventDefault()}
        className="max-w-sm"
      >
        <DialogHeader>
          <DialogTitle>Session expired</DialogTitle>
          <DialogDescription className="mt-1">
            Your session has expired. Sign in again to continue.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="px-6 py-4 space-y-4">
          <Input
            label="Email"
            type="email"
            placeholder="you@example.com"
            value={email}
            onChange={(e) => setEmail((e.target as HTMLInputElement).value)}
            autoComplete="email"
            autoFocus
          />
          <Input
            label="Password"
            type="password"
            placeholder="••••••••"
            value={password}
            onChange={(e) => setPassword((e.target as HTMLInputElement).value)}
            autoComplete="current-password"
          />

          {error && (
            <Callout variant="danger">
              <p className="text-sm">{error}</p>
            </Callout>
          )}

          <Button
            type="submit"
            isLoading={loading}
            disabled={loading || !email || !password}
            className="w-full justify-center"
          >
            Sign in again
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  )
}

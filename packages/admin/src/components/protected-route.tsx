import { useEffect, useState } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { useAuthStore, refreshRequest } from '@/lib/auth'

export function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { accessToken, setAuth, clearAuth } = useAuthStore()
  const location = useLocation()
  const [checking, setChecking] = useState(!accessToken)

  useEffect(() => {
    if (accessToken) { setChecking(false); return }
    refreshRequest()
      .then((data) => {
        if (data) setAuth(data.accessToken, data.member)
        else clearAuth()
      })
      .catch(() => clearAuth())
      .finally(() => setChecking(false))
  }, [accessToken, setAuth, clearAuth])

  if (checking) return null
  if (!accessToken) return <Navigate to={`/login?from=${encodeURIComponent(location.pathname)}`} replace />
  return <>{children}</>
}

/**
 * File Name: use-sign-out.ts
 * Purpose: The one way out. Settings > Other > Sign out, the narrow sub-nav
 *          and the overview card all call this, so revoking the refresh
 *          token, clearing the session and landing on /login happen the
 *          same way everywhere.
 *
 * Author: Raghunath J
 * License: MIT
 */
import { useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuthStore, logoutRequest } from './auth'

export function useSignOut(): () => Promise<void> {
  const navigate = useNavigate()
  const clearAuth = useAuthStore((s) => s.clearAuth)
  return useCallback(async () => {
    await logoutRequest()
    clearAuth()
    navigate('/login')
  }, [clearAuth, navigate])
}

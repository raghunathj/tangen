/**
 * File Name: use-sign-out.ts
 * Purpose: The one way out. Settings > Other > Sign out, the narrow sub-nav
 *          and the overview card all call this, so revoking the refresh
 *          token, clearing the session and landing on /login happen the
 *          same way everywhere.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: The session itself lives in sessionStorage, so clearAuth
 *          plus the tab's own lifetime already handles it. What this ALSO does
 *          is drop the one piece of local state that holds content: a recents
 *          entry's label is the object's title, taken from document.title.
 *
 *          Signing out is the "I am handing over this machine" signal, which
 *          is why this is the place for it and closing the tab is not. Other
 *          local state is deliberately left alone: theme, scrollbars and the
 *          sidebar's widths and folds are device preferences, and resetting
 *          someone's theme every time they sign back in would be the wrong
 *          trade for state that names nothing. Pins survive for the same
 *          reason plus one more - somebody curated them - and they are scoped
 *          per member, so the next person never reads them either way.
 */
import { useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuthStore, logoutRequest } from './auth'
import { clearRecents } from './sidebar-prefs'

export function useSignOut(): () => Promise<void> {
  const navigate = useNavigate()
  const clearAuth = useAuthStore((s) => s.clearAuth)
  return useCallback(async () => {
    await logoutRequest()
    clearRecents(localStorage)
    clearAuth()
    navigate('/login')
  }, [clearAuth, navigate])
}

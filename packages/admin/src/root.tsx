import { Outlet } from 'react-router-dom'
import { Toaster } from '@/components/ui/toaster'
import { SessionExpiredDialog } from '@/components/session-expired-dialog'
import { TopLoader } from '@/components/layout/top-loader'

export function Root() {
  return (
    <>
      <TopLoader />
      <Outlet />
      <SessionExpiredDialog />
      <Toaster />
    </>
  )
}

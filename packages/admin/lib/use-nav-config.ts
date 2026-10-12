/**
 * File Name: use-nav-config.ts
 * Purpose: The workspace's admin.nav options as the bootstrap read carries
 *          them: the Recent group switch and the Settings tree's "Other" links.
 *
 * Author: Raghunath J
 * License: MIT
 */
import { useParams } from 'react-router-dom'
import { useCapabilities, type NavLinks } from './use-capabilities'

export interface NavConfig { recents: boolean; links: NavLinks; content: boolean }

export function useNavConfig(): NavConfig {
  const params = useParams<{ workspaceId: string }>()
  const { flags } = useCapabilities(params.workspaceId)
  return { recents: flags.recents, links: flags.links ?? {}, content: flags.content }
}

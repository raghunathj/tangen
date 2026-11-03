/**
 * File Name: status-badge.tsx
 * Purpose: ONE content-status pill for the whole Admin.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: There were three hand-built chips for this - two
 *          byte-identical copies in the relation pickers and nothing at all on
 *          the dashboard, where a `status` column printed the bare enum value
 *          ("published", lowercase) because `displayType: 'status'` was
 *          declared in the contract and read by nothing.
 *
 *          The copies also painted raw palette steps - a fixed green fill with
 *          a fixed green text colour - which the design system's Badge
 *          explicitly must not do: a palette step is one colour and a surface
 *          has two themes. The colour decision belongs to the variant.
 */
import { Badge } from '@tangen/ui'
import { statusBadge } from '@/lib/relation-picker'

/** A content status as a pill: `published` reads "Published" in success tone. */
export function StatusBadge({ status, className }: { status: string; className?: string }) {
  const { label, variant } = statusBadge(status)
  return <Badge variant={variant} className={className}>{label}</Badge>
}

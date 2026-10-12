/**
 * File Name: icons.tsx
 * Purpose: The closed icon set for kit.iconList - simple 24x24 line icons
 *          drawn inline so the package needs no icon dependency and a typo
 *          in stored content renders nothing surprising.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: The slugs are CANONICAL per the Studio phase 2
 *          contract: spark | code | check | star | shield | clock | globe |
 *          heart. Stroke follows currentColor so the palette token colours
 *          the icons for free.
 */
import type { ReactNode } from 'react'

type IconProps = { className?: string }

function Icon({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      width="24"
      height="24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  )
}

/** The contract's closed icon set, by slug. */
export const KIT_ICONS: Record<string, (p: IconProps) => ReactNode> = {
  spark: (p) => (
    <Icon {...p}>
      <path d="M12 2 L13.8 8.8 L20 12 L13.8 15.2 L12 22 L10.2 15.2 L4 12 L10.2 8.8 Z" />
    </Icon>
  ),
  code: (p) => (
    <Icon {...p}>
      <path d="M8 6 L2.5 12 L8 18" />
      <path d="M16 6 L21.5 12 L16 18" />
    </Icon>
  ),
  check: (p) => (
    <Icon {...p}>
      <path d="M4 12.5 L9.5 18 L20 6.5" />
    </Icon>
  ),
  star: (p) => (
    <Icon {...p}>
      <path d="M12 3 L14.7 9 L21 9.8 L16.4 14.2 L17.6 20.6 L12 17.5 L6.4 20.6 L7.6 14.2 L3 9.8 L9.3 9 Z" />
    </Icon>
  ),
  shield: (p) => (
    <Icon {...p}>
      <path d="M12 3 L20 6 V12 C20 16.5 16.8 19.9 12 21.5 C7.2 19.9 4 16.5 4 12 V6 Z" />
    </Icon>
  ),
  clock: (p) => (
    <Icon {...p}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7 V12 L15.5 14" />
    </Icon>
  ),
  globe: (p) => (
    <Icon {...p}>
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12 H21" />
      <path d="M12 3 C15 6 15 18 12 21 C9 18 9 6 12 3 Z" />
    </Icon>
  ),
  heart: (p) => (
    <Icon {...p}>
      <path d="M12 20.5 C7 16.5 3.5 13.4 3.5 9.6 C3.5 7 5.5 5 8 5 C9.6 5 11.1 5.9 12 7.2 C12.9 5.9 14.4 5 16 5 C18.5 5 20.5 7 20.5 9.6 C20.5 13.4 17 16.5 12 20.5 Z" />
    </Icon>
  ),
}

/**
 * File Name: media-tile.tsx
 * Purpose: <MediaTile> — the media-grid cell: ratio-reserved image with
 *          object-cover fit, hover affordance, and a top-right badges slot
 *          (cloud/localized chips). Formalizes the media-library card
 *          pattern so custom screens don't hand-roll the classes.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Part of the stable @/kit surface.
 */
import type { ReactNode } from 'react'
import { cx } from '@tangen/ui'

const RATIOS = {
  video: 'aspect-video',
  square: 'aspect-square',
  portrait: 'aspect-[3/4]',
} as const

export interface MediaTileProps {
  src: string
  alt: string
  /** Reserved box shape — prevents layout shift while the image loads. */
  ratio?: keyof typeof RATIOS
  /** Top-right overlay chips (e.g. <Badge variant="neutral">S3</Badge>). */
  badges?: ReactNode
  /** Caption row under the image (filename, size). */
  caption?: ReactNode
  onClick?: () => void
  selected?: boolean
  className?: string
}

export function MediaTile({
  src, alt, ratio = 'square', badges, caption, onClick, selected, className,
}: MediaTileProps) {
  const Tag = onClick ? 'button' : 'div'
  return (
    <Tag
      {...(onClick ? { type: 'button' as const, onClick } : {})}
      className={cx('group block w-full text-left', className)}
    >
      <div
        className={cx(
          'relative overflow-hidden rounded-lg border bg-surface-sunken',
          RATIOS[ratio],
          selected ? 'border-accent ring-2 ring-accent/30' : 'border-border',
          onClick && 'transition-shadow group-hover:shadow-sm',
        )}
      >
        <img
          src={src}
          alt={alt}
          loading="lazy"
          className={cx('h-full w-full object-cover', onClick && 'transition-transform duration-150 group-hover:scale-105')}
        />
        {badges && <div className="absolute top-1.5 right-1.5 flex gap-1">{badges}</div>}
      </div>
      {caption && <div className="mt-1.5 text-xs text-fg-muted truncate">{caption}</div>}
    </Tag>
  )
}

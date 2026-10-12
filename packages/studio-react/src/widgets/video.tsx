'use client'
/**
 * File Name: video.tsx
 * Purpose: kit.video - the client island. YouTube / Vimeo URLs become
 *          privacy-friendly iframe embeds, anything else a plain <video>,
 *          both inside a token-free aspect-ratio box.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: The ONLY 'use client' leaf in the package, per the
 *          phase 2 contract. Props are strictly serializable (url + aspect
 *          strings) so the RSC boundary stays legal. URL parsing lives here
 *          as exported pure functions so it is testable without rendering.
 */

type Aspect = '16:9' | '4:3' | '1:1'

const ASPECT_CLASS: Record<Aspect, string> = {
  '16:9': 'tg-aspect--16-9',
  '4:3': 'tg-aspect--4-3',
  '1:1': 'tg-aspect--1-1',
}

export type VideoEmbed =
  | { kind: 'youtube'; src: string }
  | { kind: 'vimeo'; src: string }
  | { kind: 'file'; src: string }

/**
 * Classifies a video URL. YouTube watch/short/share/embed URLs and Vimeo
 * page URLs map to their embed players; anything else is treated as a
 * directly playable file URL. Unsafe schemes return null.
 */
export function parseVideoUrl(url: string): VideoEmbed | null {
  const trimmed = url.trim()
  if (trimmed === '') return null
  if (/^(javascript|data|vbscript|file):/i.test(trimmed)) return null

  const youtube =
    /(?:youtube\.com\/(?:watch\?(?:.*&)?v=|embed\/|shorts\/)|youtu\.be\/)([A-Za-z0-9_-]{6,20})/.exec(trimmed)
  if (youtube) return { kind: 'youtube', src: `https://www.youtube-nocookie.com/embed/${youtube[1]}` }

  const vimeo = /vimeo\.com\/(?:video\/)?(\d+)/.exec(trimmed)
  if (vimeo) return { kind: 'vimeo', src: `https://player.vimeo.com/video/${vimeo[1]}` }

  return { kind: 'file', src: trimmed }
}

/** The kit.video island. Renders nothing without a usable URL. */
export function VideoBlock({ url, aspect }: { url?: string; aspect?: string }) {
  const embed = url ? parseVideoUrl(url) : null
  if (!embed) return null
  const box: Aspect = aspect === '4:3' || aspect === '1:1' ? aspect : '16:9'
  return (
    <div className={`tg-video ${ASPECT_CLASS[box]}`}>
      {embed.kind === 'file' ? (
        <video className="tg-video__media" src={embed.src} controls preload="metadata" />
      ) : (
        <iframe
          className="tg-video__media"
          src={embed.src}
          title="Embedded video"
          loading="lazy"
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
          allowFullScreen
        />
      )}
    </div>
  )
}

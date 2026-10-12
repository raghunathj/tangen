import Link from 'next/link'
import { listPublished, type Entry } from '@/lib/tangen'
import { LivePosts } from '@/components/LivePosts'

export const dynamic = 'force-dynamic'   // always read fresh for the demo

export default async function Home() {
  const posts = await listPublished('post')
  return (
    // LivePosts subscribes to `objects:post` and refetches this server
    // component when a post is published, unpublished or deleted (Realtime R4).
    <LivePosts>
      <h1 style={{ fontSize: 28, marginTop: 0 }}>Posts</h1>
      {posts.length === 0 ? (
        <p className="empty">No published posts yet — publish one in the Tangen admin, or check
          <code> NEXT_PUBLIC_TANGEN_API_URL</code> / <code>TANGEN_API_KEY</code>.</p>
      ) : (
        <ul className="card-list">
          {/* A post with no slug has no URL to link to - listing it anyway
              produced /posts/null, a link guaranteed to 404. */}
          {posts.filter((p: Entry) => typeof p.slug === 'string' && p.slug).map((p: Entry) => (
            <li key={String(p.id)}>
              <Link href={`/posts/${encodeURIComponent(String(p.slug))}`}>
                <h3>{String(p.title || 'Untitled')}</h3>
                {p.subtitle ? <p>{String(p.subtitle)}</p> : null}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </LivePosts>
  )
}

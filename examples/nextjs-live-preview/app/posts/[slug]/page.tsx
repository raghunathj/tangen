import { notFound } from 'next/navigation'
import { getPublishedBySlug } from '@/lib/tangen'
import { EntryView } from '@/components/EntryView'

export const dynamic = 'force-dynamic'

export default async function PostPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const entry = await getPublishedBySlug('post', decodeURIComponent(slug))
  if (!entry) notFound()
  return <EntryView entry={entry} />
}

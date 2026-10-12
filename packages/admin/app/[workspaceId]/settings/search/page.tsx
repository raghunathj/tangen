import { useParams, useSearchParams } from 'react-router-dom'
import { usePageHeader } from '@/lib/page-header'
import { AnalyticsView } from '@/components/search/analytics-view'
import { SynonymsView } from '@/components/search/synonyms-view'
import { RecommendationsView } from '@/components/search/recommendations-view'

type Tab = 'analytics' | 'synonyms' | 'recommendations'
const TABS = [
  { id: 'analytics' as const, label: 'Analytics' },
  { id: 'synonyms' as const, label: 'Synonyms' },
  { id: 'recommendations' as const, label: 'Recommendations' },
]

export default function SearchSettingsPage() {
  const { workspaceId } = useParams<{ workspaceId: string }>()
  const [params, setParams] = useSearchParams()
  const raw = params.get('tab')
  const tab: Tab = raw === 'synonyms' || raw === 'recommendations' ? raw : 'analytics'
  // Three views of one page (each with its URL through ?tab=), as the
  // header's view tabs; the page stays one page.
  usePageHeader({
    description: 'Search analytics, synonyms, and result curation',
    tabs: TABS,
    activeTab: tab,
    onTabChange: (id) => setParams({ tab: id }, { replace: true }),
  }, [tab])

  return (
    <div className="p-6 max-w-4xl">
      {tab === 'analytics' && <AnalyticsView />}
      {tab === 'synonyms' && <SynonymsView />}
      {tab === 'recommendations' && <RecommendationsView workspaceId={workspaceId!} />}
    </div>
  )
}

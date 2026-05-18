import { useTranslation } from 'react-i18next'
import { BarChart3Icon, DatabaseIcon, GitBranchIcon, LinkIcon } from 'lucide-react'

import Badge from '@/components/ui/Badge'

type PlaceholderKind = 'sources' | 'matching' | 'structured' | 'analytics'

const content: Record<PlaceholderKind, {
  icon: typeof LinkIcon
  titleKey: string
  title: string
  descriptionKey: string
  description: string
  items: Array<{ key: string; fallback: string }>
}> = {
  sources: {
    icon: LinkIcon,
    titleKey: 'answerCatalog.sources.title',
    title: 'Answer Sources',
    descriptionKey: 'answerCatalog.sources.description',
    description: 'Connect text, HTML, markdown, URL, DB, NoSQL, and document sources for answer candidate generation.',
    items: [
      { key: 'answerCatalog.sources.items.connectorRegistry', fallback: 'Connector registry' },
      { key: 'answerCatalog.sources.items.snapshotHistory', fallback: 'Source snapshot history' },
      { key: 'answerCatalog.sources.items.profilingPreview', fallback: 'Profiling and mapping preview' },
      { key: 'answerCatalog.sources.items.draftMaterialization', fallback: 'Answer draft materialization' },
    ],
  },
  matching: {
    icon: GitBranchIcon,
    titleKey: 'answerCatalog.matching.title',
    title: 'Matching Setup',
    descriptionKey: 'answerCatalog.matching.description',
    description: 'Manage keywords, canonical questions, negative terms, KG guidance, and optional LLM suggestions.',
    items: [
      { key: 'answerCatalog.matching.items.guidanceCrud', fallback: 'Guidance CRUD' },
      { key: 'answerCatalog.matching.items.weighting', fallback: 'Keyword/question weighting' },
      { key: 'answerCatalog.matching.items.scoreInspection', fallback: 'Candidate score inspection' },
      { key: 'answerCatalog.matching.items.llmSuggestions', fallback: 'LLM suggestion workflow' },
    ],
  },
  structured: {
    icon: DatabaseIcon,
    titleKey: 'answerCatalog.structured.title',
    title: 'Structured Data',
    descriptionKey: 'answerCatalog.structured.description',
    description: 'Profile DB/NoSQL/table sources and expose safe semantic views for deterministic lookup.',
    items: [
      { key: 'answerCatalog.structured.items.datasetProfiling', fallback: 'Dataset profiling' },
      { key: 'answerCatalog.structured.items.fieldMapping', fallback: 'Field role mapping' },
      { key: 'answerCatalog.structured.items.semanticViews', fallback: 'Semantic view materialization' },
      { key: 'answerCatalog.structured.items.safeSql', fallback: 'Safe SQL preview/execute' },
    ],
  },
  analytics: {
    icon: BarChart3Icon,
    titleKey: 'answerCatalog.analytics.title',
    title: 'Answer Analytics',
    descriptionKey: 'answerCatalog.analytics.description',
    description: 'Review answer usage, no-match queries, ambiguous matches, feedback, and stale answer candidates.',
    items: [
      { key: 'answerCatalog.analytics.items.resolveEvents', fallback: 'Resolve events' },
      { key: 'answerCatalog.analytics.items.topQueries', fallback: 'Top queries' },
      { key: 'answerCatalog.analytics.items.noMatchReview', fallback: 'No-match review' },
      { key: 'answerCatalog.analytics.items.feedbackLoop', fallback: 'Feedback loop' },
    ],
  },
}

export default function AnswerCatalogPlaceholder({ kind }: { kind: PlaceholderKind }) {
  const { t } = useTranslation()
  const data = content[kind]
  const Icon = data.icon

  return (
    <div className="flex h-full flex-col gap-4 p-4">
      <div className="flex items-start gap-3">
        <div className="rounded-md border bg-muted/40 p-2">
          <Icon className="h-5 w-5" />
        </div>
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold">{t(data.titleKey, data.title)}</h1>
            <Badge variant="outline">Phase C+</Badge>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">{t(data.descriptionKey, data.description)}</p>
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        {data.items.map((item) => (
          <div key={item.key} className="rounded-md border p-4">
            <div className="text-sm font-medium">{t(item.key, item.fallback)}</div>
            <p className="mt-2 text-xs leading-5 text-muted-foreground">
              {t('answerCatalog.placeholder.pending', 'This area is reserved so the workspace UX is separated now while implementation continues in the next phase.')}
            </p>
          </div>
        ))}
      </div>
    </div>
  )
}

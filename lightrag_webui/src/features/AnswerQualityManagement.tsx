import { useState } from 'react'
import {
  BarChart3Icon,
  FlaskConicalIcon,
  GaugeIcon,
  NetworkIcon,
  SparklesIcon,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'

import AnswerHelpButton from '@/components/answers/AnswerHelpButton'
import Button from '@/components/ui/Button'
import AnswerAnalytics from '@/features/AnswerAnalytics'
import AnswerDetailedAnalytics from '@/features/AnswerDetailedAnalytics'
import AnswerGraphManagement from '@/features/AnswerGraphManagement'
import AnswerMatching from '@/features/AnswerMatching'
import AnswerTestConsole from '@/features/AnswerTestConsole'

type QualityView = 'test' | 'improve' | 'graph' | 'analytics'
type AnalyticsView = 'overview' | 'detail'

export default function AnswerQualityManagement() {
  const { t } = useTranslation()
  const [view, setView] = useState<QualityView>('test')
  const [analyticsView, setAnalyticsView] = useState<AnalyticsView>('detail')

  return (
    <div className="flex h-full min-h-0 flex-col gap-4 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <div className="rounded-md border bg-muted/40 p-2">
            <GaugeIcon className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-2xl font-bold">
              {t('answerCatalog.quality.title', 'FAQ Quality')}
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {t(
                'answerCatalog.quality.description',
                'Test questions, improve weak FAQ search settings, and review actual usage from one place.'
              )}
            </p>
          </div>
        </div>
        <AnswerHelpButton />
      </div>

      <div className="flex flex-wrap items-center gap-2 border-b pb-3">
        <Button
          type="button"
          variant={view === 'graph' ? 'default' : 'ghost'}
          onClick={() => setView('graph')}
        >
          <NetworkIcon className="h-4 w-4" />
          {t('answerCatalog.quality.graphTab', 'FAQ graph')}
        </Button>
        <Button
          type="button"
          variant={view === 'test' ? 'default' : 'ghost'}
          onClick={() => setView('test')}
        >
          <FlaskConicalIcon className="h-4 w-4" />
          {t('answerCatalog.quality.testTab', 'Test')}
        </Button>
        <Button
          type="button"
          variant={view === 'improve' ? 'default' : 'ghost'}
          onClick={() => setView('improve')}
        >
          <SparklesIcon className="h-4 w-4" />
          {t('answerCatalog.quality.improveTab', 'Needs improvement')}
        </Button>
        <Button
          type="button"
          variant={view === 'analytics' ? 'default' : 'ghost'}
          onClick={() => setView('analytics')}
        >
          <BarChart3Icon className="h-4 w-4" />
          {t('answerCatalog.quality.analyticsTab', 'Usage')}
        </Button>

        {view === 'analytics' && (
          <div className="ml-auto flex items-center rounded-md border p-0.5">
            <Button
              type="button"
              size="sm"
              variant={analyticsView === 'overview' ? 'secondary' : 'ghost'}
              onClick={() => setAnalyticsView('overview')}
            >
              {t('answerCatalog.quality.overview', 'Overview')}
            </Button>
            <Button
              type="button"
              size="sm"
              variant={analyticsView === 'detail' ? 'secondary' : 'ghost'}
              onClick={() => setAnalyticsView('detail')}
            >
              {t('answerCatalog.quality.detail', 'Detailed results')}
            </Button>
          </div>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-hidden">
        {view === 'test' && <AnswerTestConsole embedded />}
        {view === 'improve' && <AnswerMatching embedded />}
        {view === 'graph' && <AnswerGraphManagement />}
        {view === 'analytics' && analyticsView === 'overview' && <AnswerAnalytics embedded />}
        {view === 'analytics' && analyticsView === 'detail' && <AnswerDetailedAnalytics embedded />}
      </div>
    </div>
  )
}

import { useState } from 'react'
import { DatabaseIcon, FilePlus2Icon, HistoryIcon, SparklesIcon } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import AnswerHelpButton from '@/components/answers/AnswerHelpButton'
import Button from '@/components/ui/Button'
import AnswerSources from '@/features/AnswerSources'
import AnswerStructuredData from '@/features/AnswerStructuredData'

type CreationView = 'answers' | 'tables'

export default function AnswerCreation() {
  const { t } = useTranslation()
  const [view, setView] = useState<CreationView>('answers')

  return (
    <div className="flex h-full min-h-0 flex-col gap-4 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <div className="rounded-md border bg-muted/40 p-2">
            <FilePlus2Icon className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-2xl font-bold">
              {t('answerCatalog.creation.title', 'Create FAQ')}
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {t(
                'answerCatalog.creation.description',
                'Write an FAQ directly, create multiple FAQs from source material, or connect tabular data for lookup.'
              )}
            </p>
          </div>
        </div>
        <AnswerHelpButton />
      </div>

      <div className="flex flex-wrap items-center gap-2 border-b pb-3">
        <Button
          type="button"
          variant={view === 'answers' ? 'default' : 'ghost'}
          onClick={() => setView('answers')}
        >
          <SparklesIcon className="h-4 w-4" />
          {t('answerCatalog.creation.faqTab', 'Create FAQ')}
        </Button>
        <Button
          type="button"
          variant={view === 'tables' ? 'default' : 'ghost'}
          onClick={() => setView('tables')}
        >
          <DatabaseIcon className="h-4 w-4" />
          {t('answerCatalog.creation.tableTab', 'Connect table data')}
        </Button>
        <div className="ml-auto hidden items-center gap-2 text-xs text-muted-foreground lg:flex">
          <HistoryIcon className="h-4 w-4" />
          {t(
            'answerCatalog.creation.historyHint',
            'Creation history and reusable source settings are available from the FAQ creation tools.'
          )}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-hidden">
        {view === 'answers' ? (
          <AnswerSources embedded />
        ) : (
          <AnswerStructuredData embedded />
        )}
      </div>
    </div>
  )
}

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import {
  GitBranchIcon,
  Loader2Icon,
  PlusIcon,
  RefreshCwIcon,
  SearchIcon,
  Trash2Icon,
} from 'lucide-react'

import {
  AnswerGuidance,
  AnswerGuidanceType,
  AnswerItem,
  AnswerResolveResponse,
  addAnswerGuidance,
  deleteAnswerGuidance,
  listAnswerGuidance,
  listAnswers,
  resolveAnswer,
} from '@/api/lightrag'
import AnswerHelpButton from '@/components/answers/AnswerHelpButton'
import Badge from '@/components/ui/Badge'
import Button from '@/components/ui/Button'
import Checkbox from '@/components/ui/Checkbox'
import Input from '@/components/ui/Input'
import { Label } from '@/components/ui/Label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/Select'
import { cn, localizedErrorMessage } from '@/lib/utils'

type GuidanceRow = AnswerGuidance & {
  answer?: AnswerItem
}

const guidanceTypes: AnswerGuidanceType[] = ['question', 'keyword', 'synonym', 'negative_keyword', 'note']

const typeClassName = (type: AnswerGuidanceType) => {
  if (type === 'negative_keyword') {
    return 'border-rose-200 bg-rose-50/70 text-rose-700 dark:border-rose-900 dark:bg-rose-950/30 dark:text-rose-200'
  }
  if (type === 'question') {
    return 'border-slate-200 bg-slate-50 text-slate-700 dark:border-slate-800 dark:bg-slate-950/40 dark:text-slate-200'
  }
  if (type === 'synonym') {
    return 'border-slate-200 bg-slate-50 text-slate-700 dark:border-slate-800 dark:bg-slate-950/40 dark:text-slate-200'
  }
  if (type === 'note') {
    return 'border-amber-200 bg-amber-50/70 text-amber-700 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200'
  }
  return 'border-slate-200 bg-slate-50 text-slate-700 dark:border-slate-800 dark:bg-slate-950/40 dark:text-slate-200'
}

const metricCards = [
  'border-slate-200 bg-slate-50/60 text-slate-900 dark:border-slate-800 dark:bg-slate-950/20 dark:text-slate-100',
  'border-slate-200 bg-slate-50/60 text-slate-900 dark:border-slate-800 dark:bg-slate-950/20 dark:text-slate-100',
  'border-slate-200 bg-slate-50/60 text-slate-900 dark:border-slate-800 dark:bg-slate-950/20 dark:text-slate-100',
  'border-rose-100 bg-rose-50/50 text-rose-900 dark:border-rose-950 dark:bg-rose-950/20 dark:text-rose-100',
]

export default function AnswerMatching() {
  const { t } = useTranslation()
  const [answers, setAnswers] = useState<AnswerItem[]>([])
  const [guidanceByAnswer, setGuidanceByAnswer] = useState<Record<string, AnswerGuidance[]>>({})
  const [status, setStatus] = useState('all')
  const [search, setSearch] = useState('')
  const [selectedAnswerId, setSelectedAnswerId] = useState('')
  const [guidanceType, setGuidanceType] = useState<AnswerGuidanceType>('question')
  const [guidanceText, setGuidanceText] = useState('')
  const [weight, setWeight] = useState('1')
  const [filterType, setFilterType] = useState<'all' | AnswerGuidanceType>('all')
  const [onlyUnguided, setOnlyUnguided] = useState(false)
  const [query, setQuery] = useState('')
  const [includeDrafts, setIncludeDrafts] = useState(true)
  const [minScore, setMinScore] = useState('0.18')
  const [result, setResult] = useState<AnswerResolveResponse | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [isTesting, setIsTesting] = useState(false)

  const fetchData = useCallback(async () => {
    setIsLoading(true)
    try {
      const list = await listAnswers({
        status,
        search: search.trim() || undefined,
        page: 1,
        page_size: 100,
      })
      setAnswers(list.answers)
      if (!selectedAnswerId && list.answers[0]) {
        setSelectedAnswerId(list.answers[0].answer_id)
      }

      const entries = await Promise.all(
        list.answers.map(async (answer) => [answer.answer_id, await listAnswerGuidance(answer.answer_id)] as const)
      )
      setGuidanceByAnswer(Object.fromEntries(entries))
    } catch (err) {
      toast.error(localizedErrorMessage(err, t))
    } finally {
      setIsLoading(false)
    }
  }, [search, selectedAnswerId, status])

  useEffect(() => {
    fetchData()
  }, [fetchData])

  const answersById = useMemo(
    () => Object.fromEntries(answers.map((answer) => [answer.answer_id, answer])),
    [answers]
  )
  const selectedAnswer = selectedAnswerId ? answersById[selectedAnswerId] : undefined
  const guidanceRows = useMemo<GuidanceRow[]>(() => {
    const rows = Object.entries(guidanceByAnswer).flatMap(([answerId, guidance]) =>
      guidance.map((item) => ({ ...item, answer: answersById[answerId] }))
    )
    return rows
      .filter((item) => filterType === 'all' || item.guidance_type === filterType)
      .filter((item) => !search.trim() || item.text.toLowerCase().includes(search.trim().toLowerCase()) || item.answer?.title.toLowerCase().includes(search.trim().toLowerCase()))
  }, [answersById, filterType, guidanceByAnswer, search])

  const displayedAnswers = useMemo(() => {
    if (!onlyUnguided) return answers
    return answers.filter((answer) => (guidanceByAnswer[answer.answer_id] || []).length === 0)
  }, [answers, guidanceByAnswer, onlyUnguided])

  const stats = useMemo(() => {
    const all = Object.values(guidanceByAnswer).flat()
    return {
      answers: answers.length,
      guidance: all.length,
      questions: all.filter((item) => item.guidance_type === 'question').length,
      negatives: all.filter((item) => item.guidance_type === 'negative_keyword').length,
    }
  }, [answers.length, guidanceByAnswer])

  const handleAddGuidance = async () => {
    if (!selectedAnswerId || !guidanceText.trim()) {
      toast.error(t('answerCatalog.matching.addRequired', 'Select an answer and enter guidance text.'))
      return
    }
    setIsSaving(true)
    try {
      await addAnswerGuidance(selectedAnswerId, {
        guidance_type: guidanceType,
        text: guidanceText.trim(),
        weight: Number(weight) || 1,
        metadata: {
          created_from: 'matching_management',
        },
      })
      setGuidanceText('')
      toast.success(t('answerCatalog.library.guidanceAdded', 'Guidance added.'))
      fetchData()
    } catch (err) {
      toast.error(localizedErrorMessage(err, t))
    } finally {
      setIsSaving(false)
    }
  }

  const handleDeleteGuidance = async (item: GuidanceRow) => {
    try {
      await deleteAnswerGuidance(item.answer_id, item.guidance_id)
      toast.success(t('answerCatalog.library.guidanceDeleted', 'Guidance deleted.'))
      fetchData()
    } catch (err) {
      toast.error(localizedErrorMessage(err, t))
    }
  }

  const handleResolve = async () => {
    if (!query.trim()) {
      toast.error(t('answerCatalog.test.queryRequired', 'Enter a query to test.'))
      return
    }
    setIsTesting(true)
    setResult(null)
    try {
      const response = await resolveAnswer({
        query: query.trim(),
        top_k: 5,
        min_score: Number(minScore) || 0,
        strategy: 'balanced',
        include_drafts: includeDrafts,
      })
      setResult(response)
    } catch (err) {
      toast.error(localizedErrorMessage(err, t))
    } finally {
      setIsTesting(false)
    }
  }

  return (
    <div className="flex h-full flex-col gap-4 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <div className="rounded-md border bg-muted/40 p-2 text-muted-foreground">
            <GitBranchIcon className="h-5 w-5" />
          </div>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-2xl font-bold">{t('answerCatalog.matching.title', 'Matching Setup')}</h1>
              <Badge variant="outline" className="bg-muted/40">
                Phase 3 MVP
              </Badge>
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              {t('answerCatalog.matching.description', 'Manage keywords, canonical questions, negative terms, KG guidance, and optional LLM suggestions.')}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <AnswerHelpButton />
          <Button
            variant="outline"
            size="sm"
            onClick={fetchData}
            disabled={isLoading}
          >
            <RefreshCwIcon className={isLoading ? 'h-4 w-4 animate-spin' : 'h-4 w-4'} />
            {t('common.refresh', 'Refresh')}
          </Button>
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-4">
        <Metric label={t('answerCatalog.matching.answerCount', 'Answers')} value={stats.answers} className={metricCards[0]} />
        <Metric label={t('answerCatalog.matching.guidanceCount', 'Guidance')} value={stats.guidance} className={metricCards[1]} />
        <Metric label={t('answerCatalog.matching.questionCount', 'Questions')} value={stats.questions} className={metricCards[2]} />
        <Metric label={t('answerCatalog.matching.negativeCount', 'Negative Terms')} value={stats.negatives} className={metricCards[3]} />
      </div>

      <div className="grid min-h-0 flex-1 gap-4 xl:grid-cols-[420px_1fr]">
        <div className="flex min-h-0 flex-col gap-4">
          <div className="rounded-md border bg-card p-4">
            <div className="mb-3 font-semibold">
              {t('answerCatalog.matching.addGuidance', 'Add Matching Guidance')}
            </div>
            <div className="grid gap-3">
              <div className="grid gap-2">
                <Label>{t('answerCatalog.matching.answer', 'Answer')}</Label>
                <Select value={selectedAnswerId} onValueChange={setSelectedAnswerId}>
                  <SelectTrigger>
                    <SelectValue placeholder={t('answerCatalog.matching.selectAnswer', 'Select answer')} />
                  </SelectTrigger>
                  <SelectContent>
                    {answers.map((answer) => (
                      <SelectItem key={answer.answer_id} value={answer.answer_id}>
                        {answer.title}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {selectedAnswer && (
                  <div className="text-xs text-muted-foreground">
                    {selectedAnswer.answer_id} · {t(`answerCatalog.status.${selectedAnswer.status}`, selectedAnswer.status)}
                  </div>
                )}
              </div>
              <div className="grid grid-cols-[1fr_90px] gap-2">
                <div className="grid gap-2">
                  <Label>{t('answerCatalog.library.guidanceType', 'Type')}</Label>
                  <Select value={guidanceType} onValueChange={(value) => setGuidanceType(value as AnswerGuidanceType)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {guidanceTypes.map((type) => (
                        <SelectItem key={type} value={type}>
                          {t(`answerCatalog.guidanceTypes.${type}`, type)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid gap-2">
                  <Label>{t('answerCatalog.library.weight', 'Weight')}</Label>
                  <Input value={weight} type="number" step="0.1" onChange={(event) => setWeight(event.target.value)} />
                </div>
              </div>
              <div className="grid gap-2">
                <Label>{t('answerCatalog.library.guidanceText', 'Guidance Text')}</Label>
                <Input
                  value={guidanceText}
                  onChange={(event) => setGuidanceText(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') handleAddGuidance()
                  }}
                  placeholder={t('answerCatalog.matching.guidancePlaceholder', 'Example: refund deadline, how to cancel order')}
                />
              </div>
              <Button
                onClick={handleAddGuidance}
                disabled={isSaving || !selectedAnswerId}
              >
                {isSaving ? <Loader2Icon className="h-4 w-4 animate-spin" /> : <PlusIcon className="h-4 w-4" />}
                {t('answerCatalog.matching.add', 'Add Guidance')}
              </Button>
            </div>
          </div>

          <div className="rounded-md border bg-card p-4">
            <div className="mb-3 font-semibold">
              {t('answerCatalog.matching.quickTest', 'Quick Match Test')}
            </div>
            <div className="grid gap-3">
              <div className="grid gap-2">
                <Label>{t('answerCatalog.test.query', 'User Query')}</Label>
                <Input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') handleResolve()
                  }}
                  placeholder={t('answerCatalog.test.placeholder', 'Example: How do I get a refund?')}
                />
              </div>
              <div className="grid grid-cols-[1fr_auto] gap-2">
                <div className="grid gap-2">
                  <Label>{t('answerCatalog.test.minScore', 'Min Score')}</Label>
                  <Input value={minScore} onChange={(event) => setMinScore(event.target.value)} />
                </div>
                <label className="mt-7 flex items-center gap-2 text-sm text-muted-foreground">
                  <Checkbox checked={includeDrafts} onCheckedChange={(checked) => setIncludeDrafts(Boolean(checked))} />
                  {t('answerCatalog.test.includeDrafts', 'Include draft answers')}
                </label>
              </div>
              <Button
                onClick={handleResolve}
                disabled={isTesting}
              >
                {isTesting ? <Loader2Icon className="h-4 w-4 animate-spin" /> : <SearchIcon className="h-4 w-4" />}
                {t('answerCatalog.test.run', 'Resolve')}
              </Button>
              {result && (
                <div className="rounded-md border bg-muted/30 p-3 text-sm">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{t('answerCatalog.test.selected', 'Selected Answer')}</span>
                    <Badge
                      variant="outline"
                      className={result.selected_answer
                        ? 'border-emerald-200 bg-emerald-50/70 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-200'
                        : 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200'}
                    >
                      {Math.round(result.confidence * 100)}%
                    </Badge>
                  </div>
                  <div className="mt-2 text-foreground">
                    {result.selected_answer ? result.selected_answer.title : result.rationale}
                  </div>
                  {result.candidates.length > 0 && (
                    <div className="mt-3 space-y-2">
                      {result.candidates.map((candidate) => (
                        <div key={candidate.answer.answer_id} className="rounded-md border bg-background p-2">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="text-xs font-medium">{candidate.answer.title}</span>
                            <Badge variant="outline" className="bg-muted/40">
                              {candidate.score}
                            </Badge>
                          </div>
                          <div className="mt-1 text-xs text-muted-foreground">{candidate.reason}</div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="flex min-h-0 flex-col gap-3 rounded-md border bg-card p-4">
          <div className="flex flex-wrap items-center gap-2">
            <Input
              className="min-w-56 flex-1"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder={t('answerCatalog.matching.search', 'Search answer or guidance...')}
            />
            <Select value={status} onValueChange={setStatus}>
              <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t('common.all', 'All')}</SelectItem>
                <SelectItem value="draft">{t('answerCatalog.status.draft', 'Draft')}</SelectItem>
                <SelectItem value="published">{t('answerCatalog.status.published', 'Published')}</SelectItem>
                <SelectItem value="archived">{t('answerCatalog.status.archived', 'Archived')}</SelectItem>
              </SelectContent>
            </Select>
            <Select value={filterType} onValueChange={(value) => setFilterType(value as 'all' | AnswerGuidanceType)}>
              <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t('answerCatalog.matching.allTypes', 'All Types')}</SelectItem>
                {guidanceTypes.map((type) => (
                  <SelectItem key={type} value={type}>
                    {t(`answerCatalog.guidanceTypes.${type}`, type)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <label className="flex items-center gap-2 text-sm text-muted-foreground">
              <Checkbox checked={onlyUnguided} onCheckedChange={(checked) => setOnlyUnguided(Boolean(checked))} />
              {t('answerCatalog.matching.onlyUnguided', 'No guidance')}
            </label>
          </div>

          {onlyUnguided ? (
            <div className="min-h-0 overflow-auto rounded-md border bg-background">
              <div className="border-b bg-muted/30 p-3 text-sm font-medium">
                {t('answerCatalog.matching.unguidedAnswers', 'Answers without guidance')}
              </div>
              {displayedAnswers.length === 0 ? (
                <div className="p-4 text-sm text-muted-foreground">
                  {t('answerCatalog.matching.noUnguided', 'No unguided answers.')}
                </div>
              ) : (
                <div className="divide-y">
                  {displayedAnswers.map((answer) => (
                    <button
                      key={answer.answer_id}
                      className="block w-full p-3 text-left hover:bg-muted/50"
                      onClick={() => setSelectedAnswerId(answer.answer_id)}
                    >
                      <div className="font-medium">{answer.title}</div>
                      <div className="mt-1 font-mono text-xs text-muted-foreground">{answer.answer_id}</div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <div className="min-h-0 overflow-auto rounded-md border bg-background">
              <div className="grid border-b bg-muted/30 p-3 text-xs font-medium text-muted-foreground md:grid-cols-[1fr_140px_90px_48px]">
                <div>{t('answerCatalog.matching.rule', 'Rule')}</div>
                <div>{t('answerCatalog.matching.type', 'Type')}</div>
                <div>{t('answerCatalog.library.weight', 'Weight')}</div>
                <div />
              </div>
              {isLoading ? (
                <div className="flex items-center justify-center gap-2 p-8 text-sm text-muted-foreground">
                  <Loader2Icon className="h-4 w-4 animate-spin" />
                  {t('common.loading', 'Loading...')}
                </div>
              ) : guidanceRows.length === 0 ? (
                <div className="p-4 text-sm text-muted-foreground">
                  {t('answerCatalog.library.noGuidance', 'No guidance is registered.')}
                </div>
              ) : (
                <div className="divide-y">
                  {guidanceRows.map((item) => (
                    <div key={item.guidance_id} className="grid gap-2 p-3 hover:bg-muted/50 md:grid-cols-[1fr_140px_90px_48px] md:items-center">
                      <div className="min-w-0">
                        <div className="truncate text-sm font-medium">{item.text}</div>
                        <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                          <span className="truncate">{item.answer?.title || item.answer_id}</span>
                          <span className="font-mono">{item.answer_id}</span>
                        </div>
                      </div>
                      <Badge variant="outline" className={typeClassName(item.guidance_type)}>
                        {t(`answerCatalog.guidanceTypes.${item.guidance_type}`, item.guidance_type)}
                      </Badge>
                      <div className="text-sm">{item.weight}</div>
                      <Button
                        size="icon"
                        variant="ghost"
                        onClick={() => handleDeleteGuidance(item)}
                        className="text-rose-500 hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-950/30"
                      >
                        <Trash2Icon className="h-4 w-4" />
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function Metric({ label, value, className }: { label: string; value: number; className?: string }) {
  return (
    <div className={cn('rounded-md border p-3 shadow-sm', className)}>
      <div className="text-xs opacity-70">{label}</div>
      <div className="mt-1 text-2xl font-semibold">{value}</div>
    </div>
  )
}

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import {
  CheckIcon,
  ChevronDownIcon,
  ChevronUpIcon,
  GitBranchIcon,
  DatabaseIcon,
  LanguagesIcon,
  Loader2Icon,
  PlusIcon,
  RefreshCwIcon,
  SearchIcon,
  SparklesIcon,
  Trash2Icon,
  XIcon,
} from 'lucide-react'

import {
  AnswerGuidance,
  AnswerGuidanceType,
  AnswerAliasGroup,
  AnswerItem,
  AnswerResolveResponse,
  AnswerTermCandidate,
  AnswerTermCandidateStatus,
  addAnswerGuidance,
  analyzeAnswerTerms,
  approveAnswerTermCandidate,
  createAnswerAlias,
  deleteAnswerGuidance,
  deleteAnswerAlias,
  listAnswerAliases,
  listAnswerGuidance,
  listAnswerTermCandidates,
  listAnswers,
  rebuildAnswerVectors,
  rejectAnswerTermCandidate,
  resolveAnswer,
  suggestAnswerGuidance,
} from '@/api/lightrag'
import AnswerContentPreview from '@/components/answers/AnswerContentPreview'
import AnswerAssetGallery from '@/components/answers/AnswerAssetGallery'
import AnswerHelpButton from '@/components/answers/AnswerHelpButton'
import TaskProgressPanel from '@/components/documents/TaskProgressPanel'
import Badge from '@/components/ui/Badge'
import Button from '@/components/ui/Button'
import Checkbox from '@/components/ui/Checkbox'
import Input from '@/components/ui/Input'
import PaginationControls from '@/components/ui/PaginationControls'
import { Label } from '@/components/ui/Label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/Select'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/Tabs'
import { cn, localizedErrorMessage } from '@/lib/utils'
import { useWorkspaceStore } from '@/stores/workspace'

type GuidanceRow = AnswerGuidance & {
  answer?: AnswerItem
}

const guidanceTypes: AnswerGuidanceType[] = ['question', 'keyword', 'synonym', 'negative_keyword', 'note']
const ANSWER_PAGE_SIZE_OPTIONS = [
  { value: 10, label: '10' },
  { value: 20, label: '20' },
  { value: 50, label: '50' },
  { value: 100, label: '100' },
]

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

const getGuidanceSummary = (items: AnswerGuidance[] = []) => {
  const byType = (type: AnswerGuidanceType) => items.filter((item) => item.guidance_type === type).length
  return {
    total: items.length,
    questions: byType('question'),
    keywords: byType('keyword'),
    synonyms: byType('synonym'),
    negatives: byType('negative_keyword'),
    notes: byType('note'),
  }
}

const getGuidanceHealth = (items: AnswerGuidance[] = []) => {
  const summary = getGuidanceSummary(items)
  if (summary.total === 0) return { level: 'empty', className: 'border-rose-200 bg-rose-50 text-rose-700', labelKey: 'emptyHints' }
  if (summary.questions === 0 || summary.keywords === 0) return { level: 'weak', className: 'border-amber-200 bg-amber-50 text-amber-700', labelKey: 'weakHints' }
  if (summary.negatives === 0) return { level: 'no_negative', className: 'border-sky-200 bg-sky-50 text-sky-700', labelKey: 'noNegativeHints' }
  return { level: 'ready', className: 'border-emerald-200 bg-emerald-50 text-emerald-700', labelKey: 'readyHints' }
}

export default function AnswerMatching({ embedded = false }: { embedded?: boolean }) {
  const { t } = useTranslation()
  const currentWorkspaceId = useWorkspaceStore.use.currentWorkspaceId()
  const resolveRequestIdRef = useRef(0)
  const [answers, setAnswers] = useState<AnswerItem[]>([])
  const [guidanceByAnswer, setGuidanceByAnswer] = useState<Record<string, AnswerGuidance[]>>({})
  const [status, setStatus] = useState('all')
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(20)
  const [totalAnswers, setTotalAnswers] = useState(0)
  const [selectedAnswerId, setSelectedAnswerId] = useState('')
  const [guidanceType, setGuidanceType] = useState<AnswerGuidanceType>('question')
  const [guidanceText, setGuidanceText] = useState('')
  const [weight, setWeight] = useState('1')
  const [filterType, setFilterType] = useState<'all' | AnswerGuidanceType>('all')
  const [onlyUnguided, setOnlyUnguided] = useState(false)
  const [detailView, setDetailView] = useState<'selected' | 'all' | 'unguided' | 'aliases'>('selected')
  const [query, setQuery] = useState('')
  const [includeDrafts, setIncludeDrafts] = useState(true)
  const [minScore, setMinScore] = useState('0.18')
  const [retrievalMode, setRetrievalMode] = useState<'keyword' | 'hybrid' | 'graph_hybrid' | 'llm_rerank'>('hybrid')
  const [selectionPolicy, setSelectionPolicy] = useState<'workspace' | 'coverage' | 'precision'>('workspace')
  const [result, setResult] = useState<AnswerResolveResponse | null>(null)
  const [isTestResultOpen, setIsTestResultOpen] = useState(false)
  const [showSelectedAnswerContent, setShowSelectedAnswerContent] = useState(false)
  const [suggestions, setSuggestions] = useState<Awaited<ReturnType<typeof suggestAnswerGuidance>>['suggestions']>([])
  const [useLlmSuggestions, setUseLlmSuggestions] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [isTesting, setIsTesting] = useState(false)
  const [isSuggesting, setIsSuggesting] = useState(false)
  const [isRebuildingVectors, setIsRebuildingVectors] = useState(false)
  const [aliasGroups, setAliasGroups] = useState<AnswerAliasGroup[]>([])
  const [canonicalTerm, setCanonicalTerm] = useState('')
  const [aliasText, setAliasText] = useState('')
  const [isSavingAlias, setIsSavingAlias] = useState(false)
  const [termCandidates, setTermCandidates] = useState<AnswerTermCandidate[]>([])
  const [termCandidateStatus, setTermCandidateStatus] = useState<AnswerTermCandidateStatus>('suggested')
  const [termDiscoveryTaskId, setTermDiscoveryTaskId] = useState('')
  const [isStartingTermDiscovery, setIsStartingTermDiscovery] = useState(false)
  const [candidateActionId, setCandidateActionId] = useState('')

  const fetchTermCandidates = useCallback(async () => {
    const workspaceId = currentWorkspaceId
    try {
      const candidates = await listAnswerTermCandidates({
        status: termCandidateStatus,
        limit: 500,
      })
      if (workspaceId !== useWorkspaceStore.getState().currentWorkspaceId) return
      setTermCandidates(candidates)
    } catch (err) {
      toast.error(localizedErrorMessage(err, t))
    }
  }, [currentWorkspaceId, t, termCandidateStatus])

  const fetchData = useCallback(async () => {
    const workspaceId = currentWorkspaceId
    setIsLoading(true)
    try {
      const list = await listAnswers({
        status,
        search: search.trim() || undefined,
        page,
        page_size: pageSize,
      })
      if (workspaceId !== useWorkspaceStore.getState().currentWorkspaceId) return
      const totalPages = Math.max(1, Math.ceil(list.total / list.page_size))
      if (list.answers.length === 0 && list.total > 0 && page > totalPages) {
        setPage(totalPages)
        return
      }
      setAnswers(list.answers)
      setTotalAnswers(list.total)
      setSelectedAnswerId((current) =>
        current && list.answers.some((answer) => answer.answer_id === current)
          ? current
          : list.answers[0]?.answer_id || ''
      )

      const entries = await Promise.all(
        list.answers.map(async (answer) => [answer.answer_id, await listAnswerGuidance(answer.answer_id)] as const)
      )
      if (workspaceId !== useWorkspaceStore.getState().currentWorkspaceId) return
      setGuidanceByAnswer(Object.fromEntries(entries))
      setAliasGroups(await listAnswerAliases())
    } catch (err) {
      toast.error(localizedErrorMessage(err, t))
    } finally {
      setIsLoading(false)
    }
  }, [currentWorkspaceId, page, pageSize, search, status, t])

  useEffect(() => {
    setAnswers([])
    setGuidanceByAnswer({})
    setPage(1)
    setTotalAnswers(0)
    setSelectedAnswerId('')
    setGuidanceText('')
    setSuggestions([])
    setResult(null)
    setIsTestResultOpen(false)
    setShowSelectedAnswerContent(false)
    setAliasGroups([])
    setCanonicalTerm('')
    setAliasText('')
    setTermCandidates([])
    setTermCandidateStatus('suggested')
    setTermDiscoveryTaskId('')
    setCandidateActionId('')
  }, [currentWorkspaceId])

  useEffect(() => {
    fetchData()
  }, [fetchData])

  useEffect(() => {
    fetchTermCandidates()
  }, [fetchTermCandidates])

  const totalPages = useMemo(() => Math.max(1, Math.ceil(totalAnswers / pageSize)), [pageSize, totalAnswers])

  const handleSearchChange = (value: string) => {
    setSearch(value)
    setPage(1)
  }

  const handleStatusChange = (value: string) => {
    setStatus(value)
    setPage(1)
  }

  const handlePageSizeChange = (value: number) => {
    setPageSize(value)
    setPage(1)
  }

  const answersById = useMemo(
    () => Object.fromEntries(answers.map((answer) => [answer.answer_id, answer])),
    [answers]
  )
  const selectedAnswer = selectedAnswerId ? answersById[selectedAnswerId] : undefined
  const selectedGuidance = useMemo(
    () => (selectedAnswerId ? guidanceByAnswer[selectedAnswerId] || [] : []),
    [guidanceByAnswer, selectedAnswerId]
  )
  const selectedGuidanceSummary = useMemo(() => getGuidanceSummary(selectedGuidance), [selectedGuidance])
  const selectedGuidanceHealth = useMemo(() => getGuidanceHealth(selectedGuidance), [selectedGuidance])
  const selectedGuidanceRows = useMemo(
    () => selectedGuidance.filter((item) => filterType === 'all' || item.guidance_type === filterType),
    [filterType, selectedGuidance]
  )
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

  const handleAddGuidance = async () => {
    if (!selectedAnswerId || !guidanceText.trim()) {
      toast.error(t('answerCatalog.matching.addRequired', 'Select an answer and enter finding hint text.'))
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
      toast.success(t('answerCatalog.library.guidanceAdded', 'Finding hint added.'))
      fetchData()
    } catch (err) {
      toast.error(localizedErrorMessage(err, t))
    } finally {
      setIsSaving(false)
    }
  }

  const handleSuggestGuidance = async () => {
    if (!selectedAnswerId) {
      toast.error(t('answerCatalog.matching.selectAnswerFirst', 'Select an answer first.'))
      return
    }
    setIsSuggesting(true)
    try {
      const response = await suggestAnswerGuidance(selectedAnswerId, {
        query_examples: query.trim() ? [query.trim()] : [],
        max_suggestions: 10,
        use_llm: useLlmSuggestions,
      })
      setSuggestions(response.suggestions)
      toast.success(
        t('answerCatalog.matching.suggestionsReady', 'Finding hint suggestions are ready.')
      )
    } catch (err) {
      toast.error(localizedErrorMessage(err, t))
    } finally {
      setIsSuggesting(false)
    }
  }

  const handleAddSuggestion = async (index: number) => {
    const suggestion = suggestions[index]
    if (!selectedAnswerId || !suggestion) return
    setIsSaving(true)
    try {
      await addAnswerGuidance(selectedAnswerId, {
        guidance_type: suggestion.guidance_type,
        text: suggestion.text,
        weight: suggestion.weight || 1,
        metadata: {
          ...suggestion.metadata,
          created_from: 'matching_suggestion',
          source: suggestion.source,
        },
      })
      setSuggestions((items) => items.filter((_, itemIndex) => itemIndex !== index))
      toast.success(t('answerCatalog.library.guidanceAdded', 'Finding hint added.'))
      fetchData()
    } catch (err) {
      toast.error(localizedErrorMessage(err, t))
    } finally {
      setIsSaving(false)
    }
  }

  const handleRebuildVectors = async () => {
    setIsRebuildingVectors(true)
    try {
      const response = await rebuildAnswerVectors({
        status: status === 'all' ? undefined : status,
        limit: 500,
        only_missing: true,
      })
      toast.success(
        t('answerCatalog.matching.vectorRebuilt', '{{count}} answer vectors were rebuilt. {{remaining}} remain.', {
          count: response.rebuilt,
          remaining: response.remaining,
        })
      )
    } catch (err) {
      toast.error(localizedErrorMessage(err, t))
    } finally {
      setIsRebuildingVectors(false)
    }
  }

  const handleCreateAlias = async () => {
    const aliases = aliasText
      .split(/[,;|\n]+/)
      .map((item) => item.trim())
      .filter(Boolean)
    if (!canonicalTerm.trim() || aliases.length === 0) {
      toast.error(t('answerCatalog.matching.aliasRequired', 'Enter a standard term and at least one alias.'))
      return
    }
    setIsSavingAlias(true)
    try {
      await createAnswerAlias({
        canonical_term: canonicalTerm.trim(),
        aliases,
        metadata: { created_from: 'quality_management' },
      })
      setCanonicalTerm('')
      setAliasText('')
      setAliasGroups(await listAnswerAliases())
      toast.success(t('answerCatalog.matching.aliasCreated', 'Term alias group added.'))
    } catch (err) {
      toast.error(localizedErrorMessage(err, t))
    } finally {
      setIsSavingAlias(false)
    }
  }

  const handleDeleteAlias = async (aliasId: string) => {
    try {
      await deleteAnswerAlias(aliasId)
      setAliasGroups((items) => items.filter((item) => item.alias_id !== aliasId))
      toast.success(t('answerCatalog.matching.aliasDeleted', 'Term alias group deleted.'))
    } catch (err) {
      toast.error(localizedErrorMessage(err, t))
    }
  }

  const handleAnalyzeTerms = async () => {
    setIsStartingTermDiscovery(true)
    try {
      const response = await analyzeAnswerTerms({
        include_drafts: true,
        include_no_match_queries: true,
        answer_limit: 1000,
        event_limit: 300,
        batch_size: 20,
      })
      setTermCandidateStatus('suggested')
      setTermDiscoveryTaskId(response.task_id)
      toast.success(
        t(
          'answerCatalog.matching.termDiscoveryStarted',
          'AI term discovery started. Review candidates when the analysis is complete.'
        )
      )
    } catch (err) {
      toast.error(localizedErrorMessage(err, t))
    } finally {
      setIsStartingTermDiscovery(false)
    }
  }

  const refreshTermManagement = async () => {
    const [groups, candidates] = await Promise.all([
      listAnswerAliases(),
      listAnswerTermCandidates({ status: termCandidateStatus, limit: 500 }),
    ])
    setAliasGroups(groups)
    setTermCandidates(candidates)
  }

  const handleApproveTermCandidate = async (candidateId: string) => {
    setCandidateActionId(candidateId)
    try {
      await approveAnswerTermCandidate(candidateId)
      await refreshTermManagement()
      toast.success(
        t(
          'answerCatalog.matching.termCandidateApproved',
          'The approved term group is now used for FAQ search.'
        )
      )
    } catch (err) {
      toast.error(localizedErrorMessage(err, t))
    } finally {
      setCandidateActionId('')
    }
  }

  const handleRejectTermCandidate = async (candidateId: string) => {
    setCandidateActionId(candidateId)
    try {
      await rejectAnswerTermCandidate(candidateId)
      await refreshTermManagement()
      toast.success(
        t(
          'answerCatalog.matching.termCandidateRejected',
          'The term candidate was excluded.'
        )
      )
    } catch (err) {
      toast.error(localizedErrorMessage(err, t))
    } finally {
      setCandidateActionId('')
    }
  }

  const handleDeleteGuidance = async (item: GuidanceRow) => {
    try {
      await deleteAnswerGuidance(item.answer_id, item.guidance_id)
      toast.success(t('answerCatalog.library.guidanceDeleted', 'Finding hint deleted.'))
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
    const requestId = resolveRequestIdRef.current + 1
    resolveRequestIdRef.current = requestId
    setIsTesting(true)
    if (result) {
      setIsTestResultOpen(true)
    }
    try {
      const response = await resolveAnswer({
        query: query.trim(),
        top_k: 5,
        min_score: Number(minScore) || 0,
        strategy: 'balanced',
        retrieval_mode: retrievalMode,
        vector_top_k: 8,
        llm_candidate_count: 5,
        include_drafts: includeDrafts,
        selection_policy: selectionPolicy,
      })
      if (requestId !== resolveRequestIdRef.current) return
      setResult(response)
      setIsTestResultOpen(true)
      setShowSelectedAnswerContent(false)
    } catch (err) {
      if (requestId !== resolveRequestIdRef.current) return
      toast.error(localizedErrorMessage(err, t))
    } finally {
      if (requestId === resolveRequestIdRef.current) {
        setIsTesting(false)
      }
    }
  }

  return (
    <div className={`relative flex h-full flex-col gap-4 ${embedded ? 'px-0 pt-0 pb-56 xl:pb-32' : 'p-4 pb-56 xl:pb-32'}`}>
      {!embedded && (
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <div className="rounded-md border bg-muted/40 p-2 text-muted-foreground">
            <GitBranchIcon className="h-5 w-5" />
          </div>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-2xl font-bold">{t('answerCatalog.matching.title', 'Answer Item Settings')}</h1>
              <Badge variant="outline" className="bg-muted/40">
                Phase 3 MVP
              </Badge>
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              {t('answerCatalog.matching.description', 'Manage keywords, representative questions, exclusion terms, graph-based finding hints, and optional LLM suggestions.')}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <AnswerHelpButton />
          <Button
            variant="outline"
            size="sm"
            onClick={handleRebuildVectors}
            disabled={isRebuildingVectors}
          >
            {isRebuildingVectors ? <Loader2Icon className="h-4 w-4 animate-spin" /> : <DatabaseIcon className="h-4 w-4" />}
            {t('answerCatalog.matching.rebuildVectors', 'Rebuild Vectors')}
          </Button>
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
      )}

      <div className="grid min-h-0 flex-1 gap-4 xl:grid-cols-[460px_1fr]">
        <div className="flex min-h-0 flex-col gap-3 rounded-md border bg-card p-4">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <div className="font-semibold">
                {embedded
                  ? t('answerCatalog.matching.improvementQueue', 'FAQ to improve')
                  : t('answerCatalog.matching.answerExplorer', 'Answer Explorer')}
              </div>
              <div className="mt-1 text-xs text-muted-foreground">
                {embedded
                  ? t(
                    'answerCatalog.matching.improvementQueueDesc',
                    'Select an FAQ that needs stronger search settings and review AI suggestions.'
                  )
                  : t('answerCatalog.matching.answerExplorerDesc', 'Find an answer first, then edit only that answer’s finding hints.')}
              </div>
            </div>
            <Badge variant="outline" className="bg-muted/40">
              {totalAnswers.toLocaleString()}
            </Badge>
          </div>
          <div className="grid gap-2">
            <Input
              value={search}
              onChange={(event) => handleSearchChange(event.target.value)}
              placeholder={embedded
                ? t('answerCatalog.matching.improvementSearch', 'Search FAQ title or content...')
                : t('answerCatalog.matching.answerSearch', 'Search title, body, tag, or finding hint...')}
            />
            <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
              <Select value={status} onValueChange={handleStatusChange}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{t('common.all', 'All')}</SelectItem>
                  <SelectItem value="draft">{t('answerCatalog.status.draft', 'Draft')}</SelectItem>
                  <SelectItem value="published">{t('answerCatalog.status.published', 'Published')}</SelectItem>
                  <SelectItem value="archived">{t('answerCatalog.status.archived', 'Archived')}</SelectItem>
                </SelectContent>
              </Select>
              <label className="flex h-10 items-center gap-2 rounded-md border bg-muted/20 px-3 text-sm text-muted-foreground">
                <Checkbox checked={onlyUnguided} onCheckedChange={(checked) => setOnlyUnguided(Boolean(checked))} />
                {t('answerCatalog.matching.onlyUnguided', 'No finding hints')}
              </label>
            </div>
          </div>
          <div className="min-h-0 flex-1 overflow-auto rounded-md border bg-background">
            {isLoading ? (
              <div className="flex items-center justify-center gap-2 p-8 text-sm text-muted-foreground">
                <Loader2Icon className="h-4 w-4 animate-spin" />
                {t('common.loading', 'Loading...')}
              </div>
            ) : displayedAnswers.length === 0 ? (
              <div className="p-4 text-sm text-muted-foreground">
                {onlyUnguided
                  ? t('answerCatalog.matching.noUnguided', 'No unguided answers.')
                  : t('answerCatalog.matching.noAnswers', 'No answers match the current filters.')}
              </div>
            ) : (
              <div className="divide-y">
                {displayedAnswers.map((answer) => {
                  const answerGuidance = guidanceByAnswer[answer.answer_id] || []
                  const summary = getGuidanceSummary(answerGuidance)
                  const health = getGuidanceHealth(answerGuidance)
                  return (
                    <button
                      key={answer.answer_id}
                      type="button"
                      className={cn(
                        'block w-full p-3 text-left transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500',
                        selectedAnswerId === answer.answer_id && 'bg-emerald-50/70 dark:bg-emerald-950/20'
                      )}
                      onClick={() => {
                        setSelectedAnswerId(answer.answer_id)
                        setDetailView('selected')
                        setSuggestions([])
                      }}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className="truncate font-medium">{answer.title}</div>
                          <div className="mt-1 line-clamp-2 text-xs leading-5 text-muted-foreground">
                            {answer.approved_summary || answer.body}
                          </div>
                        </div>
                        <Badge variant="outline" className={cn('shrink-0', health.className)}>
                          {t(`answerCatalog.matching.health.${health.labelKey}`, health.level)}
                        </Badge>
                      </div>
                      <div className="mt-3 flex flex-wrap items-center gap-1.5">
                        <Badge variant="outline">{t(`answerCatalog.status.${answer.status}`, answer.status)}</Badge>
                        <Badge variant="outline">{t('answerCatalog.matching.hintCount', '{{count}} hints', { count: summary.total })}</Badge>
                        {!embedded && (
                          <>
                            <Badge variant="outline">{t('answerCatalog.matching.questionShort', 'Q')} {summary.questions}</Badge>
                            <Badge variant="outline">{t('answerCatalog.matching.keywordShort', 'K')} {summary.keywords}</Badge>
                            {answer.tags.slice(0, 3).map((tag) => (
                              <Badge key={tag} variant="outline" className="bg-muted/30">{tag}</Badge>
                            ))}
                          </>
                        )}
                      </div>
                      {!embedded && (
                        <div className="mt-2 truncate font-mono text-[11px] text-muted-foreground">{answer.answer_id}</div>
                      )}
                    </button>
                  )
                })}
              </div>
            )}
          </div>
          <PaginationControls
            currentPage={page}
            totalPages={totalPages}
            pageSize={pageSize}
            totalCount={totalAnswers}
            onPageChange={setPage}
            onPageSizeChange={handlePageSizeChange}
            pageSizeOptions={ANSWER_PAGE_SIZE_OPTIONS}
            isLoading={isLoading}
            compact
            className="justify-end"
          />
        </div>

        <Tabs
          value={detailView}
          onValueChange={(value) => setDetailView(value as 'selected' | 'all' | 'unguided' | 'aliases')}
          className="flex min-h-0 flex-col rounded-md border bg-card p-4"
        >
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <TabsList className="h-auto flex-wrap justify-start">
              <TabsTrigger value="selected">
                {t('answerCatalog.matching.selectedAnswerTab', 'Selected Answer')}
              </TabsTrigger>
              {!embedded && (
                <>
                  <TabsTrigger value="all">{t('answerCatalog.matching.allGuidanceTab', 'All Hints')}</TabsTrigger>
                  <TabsTrigger value="unguided">{t('answerCatalog.matching.unguidedTab', 'Needs Hints')}</TabsTrigger>
                </>
              )}
              <TabsTrigger value="aliases">
                <LanguagesIcon className="mr-1 h-4 w-4" />
                {t('answerCatalog.matching.aliasTab', 'Terms & aliases')}
              </TabsTrigger>
            </TabsList>
            {!embedded && detailView !== 'aliases' && (
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
            )}
          </div>

          <TabsContent value="selected" className="mt-0 min-h-0 flex-1 overflow-auto">
            {!selectedAnswer ? (
              <div className="rounded-md border border-dashed p-6 text-sm text-muted-foreground">
                {t('answerCatalog.matching.selectAnswerFirst', 'Select an answer first.')}
              </div>
            ) : (
              <div className="grid gap-4">
                <div className="rounded-md border bg-background p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <h2 className="text-lg font-semibold">{selectedAnswer.title}</h2>
                        <Badge variant="outline">{t(`answerCatalog.status.${selectedAnswer.status}`, selectedAnswer.status)}</Badge>
                        <Badge variant="outline" className={selectedGuidanceHealth.className}>
                          {t(`answerCatalog.matching.health.${selectedGuidanceHealth.labelKey}`, selectedGuidanceHealth.level)}
                        </Badge>
                      </div>
                      {!embedded && (
                        <div className="mt-1 font-mono text-xs text-muted-foreground">{selectedAnswer.answer_id}</div>
                      )}
                    </div>
                    {!embedded && <div className="text-right text-xs text-muted-foreground">
                      <div>v{selectedAnswer.version}</div>
                      <div>{selectedAnswer.update_time ? new Date(selectedAnswer.update_time).toLocaleString() : '-'}</div>
                    </div>}
                  </div>
                  {embedded ? (
                    <div className="mt-3 text-sm text-muted-foreground">
                      {t('answerCatalog.matching.compactHintSummary', 'Search settings: {{total}} total · {{questions}} questions · {{keywords}} keywords · {{synonyms}} synonyms · {{negatives}} exclusions', {
                        total: selectedGuidanceSummary.total,
                        questions: selectedGuidanceSummary.questions,
                        keywords: selectedGuidanceSummary.keywords,
                        synonyms: selectedGuidanceSummary.synonyms,
                        negatives: selectedGuidanceSummary.negatives,
                      })}
                    </div>
                  ) : <div className="mt-4 grid gap-3 md:grid-cols-5">
                    <MiniMetric label={t('answerCatalog.matching.totalHints', 'Hints')} value={selectedGuidanceSummary.total} />
                    <MiniMetric label={t('answerCatalog.guidanceTypes.question', 'Question')} value={selectedGuidanceSummary.questions} />
                    <MiniMetric label={t('answerCatalog.guidanceTypes.keyword', 'Keyword')} value={selectedGuidanceSummary.keywords} />
                    <MiniMetric label={t('answerCatalog.guidanceTypes.synonym', 'Synonym')} value={selectedGuidanceSummary.synonyms} />
                    <MiniMetric label={t('answerCatalog.guidanceTypes.negative_keyword', 'Negative')} value={selectedGuidanceSummary.negatives} />
                  </div>}
                  <div className="mt-4 grid gap-3 lg:grid-cols-2">
                    <div className="rounded-md border bg-muted/10 p-3">
                      <div className="text-xs font-medium text-muted-foreground">{t('answerCatalog.library.summary', 'Answer Memo')}</div>
                      <div className="mt-1 line-clamp-4 text-sm leading-6">{selectedAnswer.approved_summary || '-'}</div>
                    </div>
                    <div className="rounded-md border bg-muted/10 p-3">
                      <div className="text-xs font-medium text-muted-foreground">{t('answerCatalog.library.body', 'Body')}</div>
                      <div className="mt-1 line-clamp-4 text-sm leading-6">{selectedAnswer.body}</div>
                    </div>
                  </div>
                  {!embedded && <div className="mt-3 flex flex-wrap gap-1.5">
                    {selectedAnswer.tags.length === 0 ? (
                      <span className="text-xs text-muted-foreground">-</span>
                    ) : selectedAnswer.tags.map((tag) => (
                      <Badge key={tag} variant="outline" className="bg-muted/30">{tag}</Badge>
                    ))}
                  </div>}
                </div>

                <div className="grid gap-4 xl:grid-cols-[360px_1fr]">
                  <div className="rounded-md border bg-background p-4">
                    <div className="mb-3 font-semibold">{t('answerCatalog.matching.addGuidance', 'Add Finding Hint')}</div>
                    <div className="grid gap-3">
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
                        <Label>{t('answerCatalog.library.guidanceText', 'Finding Hint Text')}</Label>
                        <Input
                          value={guidanceText}
                          onChange={(event) => setGuidanceText(event.target.value)}
                          onKeyDown={(event) => {
                            if (event.key === 'Enter') handleAddGuidance()
                          }}
                          placeholder={t('answerCatalog.matching.guidancePlaceholder', 'Example: refund deadline, how to cancel order')}
                        />
                      </div>
                      <Button onClick={handleAddGuidance} disabled={isSaving || !selectedAnswerId}>
                        {isSaving ? <Loader2Icon className="h-4 w-4 animate-spin" /> : <PlusIcon className="h-4 w-4" />}
                        {t('answerCatalog.matching.add', 'Add Finding Hint')}
                      </Button>
                      <div className="rounded-md border bg-muted/20 p-3">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <label className="flex items-center gap-2 text-sm text-muted-foreground">
                            <Checkbox checked={useLlmSuggestions} onCheckedChange={(checked) => setUseLlmSuggestions(Boolean(checked))} />
                            {t('answerCatalog.matching.useLlmSuggestions', 'Use LLM suggestions')}
                          </label>
                          <Button variant="outline" size="sm" onClick={handleSuggestGuidance} disabled={isSuggesting || !selectedAnswerId}>
                            {isSuggesting ? <Loader2Icon className="h-4 w-4 animate-spin" /> : <SparklesIcon className="h-4 w-4" />}
                            {t('answerCatalog.matching.suggest', 'Suggest Hints')}
                          </Button>
                        </div>
                        {suggestions.length > 0 && (
                          <div className="mt-3 space-y-2">
                            {suggestions.map((suggestion, index) => (
                              <div key={`${suggestion.guidance_type}-${suggestion.text}`} className="rounded-md border bg-background p-2">
                                <div className="flex flex-wrap items-center gap-2">
                                  <Badge variant="outline" className={typeClassName(suggestion.guidance_type)}>
                                    {t(`answerCatalog.guidanceTypes.${suggestion.guidance_type}`, suggestion.guidance_type)}
                                  </Badge>
                                  <span className="min-w-0 flex-1 text-sm">{suggestion.text}</span>
                                  <Button variant="outline" size="sm" onClick={() => handleAddSuggestion(index)} disabled={isSaving}>
                                    {t('common.add', 'Add')}
                                  </Button>
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="rounded-md border bg-background">
                    <div className="border-b bg-muted/30 p-3">
                      <div className="text-sm font-semibold">{t('answerCatalog.matching.selectedGuidance', 'Selected Answer Finding Hints')}</div>
                      <div className="mt-1 text-xs text-muted-foreground">
                        {t('answerCatalog.matching.selectedGuidanceDesc', 'Only hints connected to the selected answer are shown here.')}
                      </div>
                    </div>
                    {selectedGuidanceRows.length === 0 ? (
                      <div className="p-4 text-sm text-muted-foreground">
                        {t('answerCatalog.library.noGuidance', 'No finding hints are registered.')}
                      </div>
                    ) : (
                      <div className="divide-y">
                        {selectedGuidanceRows.map((item) => (
                          <GuidanceListRow
                            key={item.guidance_id}
                            item={item}
                            onDelete={() => handleDeleteGuidance(item)}
                            t={t}
                          />
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}
          </TabsContent>

          <TabsContent value="all" className="mt-0 min-h-0 flex-1 overflow-auto">
            <GuidanceTable
              rows={guidanceRows}
              isLoading={isLoading}
              onDelete={handleDeleteGuidance}
              t={t}
            />
          </TabsContent>

          <TabsContent value="unguided" className="mt-0 min-h-0 flex-1 overflow-auto">
            <div className="rounded-md border bg-background">
              <div className="border-b bg-muted/30 p-3 text-sm font-medium">
                {t('answerCatalog.matching.unguidedAnswers', 'Answers without finding hints')}
              </div>
              {answers.filter((answer) => (guidanceByAnswer[answer.answer_id] || []).length === 0).length === 0 ? (
                <div className="p-4 text-sm text-muted-foreground">
                  {t('answerCatalog.matching.noUnguided', 'No unguided answers.')}
                </div>
              ) : (
                <div className="divide-y">
                  {answers.filter((answer) => (guidanceByAnswer[answer.answer_id] || []).length === 0).map((answer) => (
                    <button
                      key={answer.answer_id}
                      type="button"
                      className="block w-full p-3 text-left hover:bg-muted/50"
                      onClick={() => {
                        setSelectedAnswerId(answer.answer_id)
                        setDetailView('selected')
                      }}
                    >
                      <div className="font-medium">{answer.title}</div>
                      <div className="mt-1 line-clamp-2 text-xs text-muted-foreground">{answer.approved_summary || answer.body}</div>
                      <div className="mt-1 font-mono text-xs text-muted-foreground">{answer.answer_id}</div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </TabsContent>

          <TabsContent value="aliases" className="mt-0 min-h-0 flex-1 overflow-auto">
            <div className="grid gap-4">
              <div className="rounded-md border bg-background p-4">
                <div className="flex items-start gap-3">
                  <div className="rounded-md border bg-muted/30 p-2 text-muted-foreground">
                    <LanguagesIcon className="h-5 w-5" />
                  </div>
                  <div>
                    <div className="font-semibold">
                      {t('answerCatalog.matching.aliasTitle', 'Common terms and aliases')}
                    </div>
                    <div className="mt-1 text-sm leading-6 text-muted-foreground">
                      {t(
                        'answerCatalog.matching.aliasDescription',
                        'Equivalent product names, abbreviations, and Korean-English terms are expanded before keyword and semantic search. Example: 팀즈 = Teams = Microsoft Teams.'
                      )}
                    </div>
                  </div>
                </div>

                <div className="mt-5 border-t pt-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <div className="flex items-center gap-2 font-semibold">
                        <SparklesIcon className="h-4 w-4 text-emerald-600" />
                        {t('answerCatalog.matching.aiTermCandidates', 'AI term candidates')}
                      </div>
                      <div className="mt-1 max-w-3xl text-sm leading-6 text-muted-foreground">
                        {t(
                          'answerCatalog.matching.aiTermCandidatesDescription',
                          'AI reviews FAQs and unmatched questions to suggest synonyms, abbreviations, and new expressions. Only approved candidates affect search.'
                        )}
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <Select
                        value={termCandidateStatus}
                        onValueChange={(value) => setTermCandidateStatus(value as AnswerTermCandidateStatus)}
                      >
                        <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="suggested">
                            {t('answerCatalog.matching.termStatusSuggested', 'Needs review')}
                          </SelectItem>
                          <SelectItem value="approved">
                            {t('answerCatalog.matching.termStatusApproved', 'Approved')}
                          </SelectItem>
                          <SelectItem value="rejected">
                            {t('answerCatalog.matching.termStatusRejected', 'Excluded')}
                          </SelectItem>
                        </SelectContent>
                      </Select>
                      <Button
                        onClick={handleAnalyzeTerms}
                        disabled={isStartingTermDiscovery || Boolean(termDiscoveryTaskId)}
                      >
                        {isStartingTermDiscovery || termDiscoveryTaskId
                          ? <Loader2Icon className="h-4 w-4 animate-spin" />
                          : <SparklesIcon className="h-4 w-4" />}
                        {t('answerCatalog.matching.discoverTermsWithAi', 'Find terms with AI')}
                      </Button>
                    </div>
                  </div>

                  {termDiscoveryTaskId && (
                    <div className="mt-4 rounded-md border bg-muted/10 p-3">
                      <TaskProgressPanel
                        taskId={termDiscoveryTaskId}
                        compact
                        onComplete={() => {
                          setTermDiscoveryTaskId('')
                          fetchTermCandidates()
                          toast.success(
                            t(
                              'answerCatalog.matching.termDiscoveryCompleted',
                              'AI term analysis is complete. Review the suggested candidates.'
                            )
                          )
                        }}
                        onError={() => setTermDiscoveryTaskId('')}
                      />
                    </div>
                  )}

                  <div className="mt-4 overflow-hidden rounded-md border">
                    {termCandidates.length === 0 ? (
                      <div className="p-4 text-sm text-muted-foreground">
                        {termCandidateStatus === 'suggested'
                          ? t(
                            'answerCatalog.matching.noTermCandidates',
                            'No term candidates are waiting for review. Run AI term discovery or register a term directly.'
                          )
                          : t(
                            'answerCatalog.matching.noTermCandidateHistory',
                            'No term candidates exist for this status.'
                          )}
                      </div>
                    ) : (
                      <div className="divide-y">
                        {termCandidates.map((candidate) => (
                          <div key={candidate.candidate_id} className="grid gap-3 p-4">
                            <div className="flex flex-wrap items-start justify-between gap-3">
                              <div className="min-w-0">
                                <div className="flex flex-wrap items-center gap-2">
                                  <span className="font-semibold">{candidate.canonical_term}</span>
                                  <Badge variant="outline" className="bg-muted/20">
                                    {t(
                                      `answerCatalog.matching.termType.${candidate.term_type}`,
                                      candidate.term_type
                                    )}
                                  </Badge>
                                  <Badge variant="outline" className="border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-100">
                                    {t('answerCatalog.matching.termConfidence', 'Confidence')} {Math.round(candidate.confidence * 100)}%
                                  </Badge>
                                </div>
                                <div className="mt-2 flex flex-wrap gap-1.5">
                                  {candidate.aliases.map((alias) => (
                                    <Badge key={alias} variant="outline" className="bg-background">
                                      {alias}
                                    </Badge>
                                  ))}
                                </div>
                              </div>
                              {candidate.status !== 'approved' && (
                                <div className="flex shrink-0 items-center gap-2">
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={() => handleRejectTermCandidate(candidate.candidate_id)}
                                    disabled={Boolean(candidateActionId)}
                                  >
                                    {candidateActionId === candidate.candidate_id
                                      ? <Loader2Icon className="h-4 w-4 animate-spin" />
                                      : <XIcon className="h-4 w-4" />}
                                    {t('answerCatalog.matching.rejectTermCandidate', 'Exclude')}
                                  </Button>
                                  <Button
                                    size="sm"
                                    onClick={() => handleApproveTermCandidate(candidate.candidate_id)}
                                    disabled={Boolean(candidateActionId)}
                                  >
                                    {candidateActionId === candidate.candidate_id
                                      ? <Loader2Icon className="h-4 w-4 animate-spin" />
                                      : <CheckIcon className="h-4 w-4" />}
                                    {t('answerCatalog.matching.approveTermCandidate', 'Approve')}
                                  </Button>
                                </div>
                              )}
                            </div>
                            {candidate.rationale && (
                              <div className="text-sm leading-6 text-muted-foreground">
                                <span className="font-medium text-foreground">
                                  {t('answerCatalog.matching.termRecommendationReason', 'Why suggested')}:
                                </span>{' '}
                                {candidate.rationale}
                              </div>
                            )}
                            {candidate.evidence.length > 0 && (
                              <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                                <span className="font-medium">
                                  {t('answerCatalog.matching.termEvidence', 'Evidence')}:
                                </span>
                                {candidate.evidence.slice(0, 4).map((evidence) => (
                                  <span
                                    key={evidence.ref}
                                    className="max-w-72 truncate rounded border bg-muted/20 px-2 py-1"
                                    title={evidence.label || evidence.ref}
                                  >
                                    {evidence.kind === 'unmatched_query'
                                      ? t('answerCatalog.matching.unmatchedQuestionEvidence', 'Unmatched question')
                                      : t('answerCatalog.matching.faqEvidence', 'FAQ')}
                                    {' · '}
                                    {evidence.label || evidence.ref}
                                  </span>
                                ))}
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>

                <div className="mt-5 border-t pt-4">
                  <div className="font-semibold">
                    {t('answerCatalog.matching.manualTermRegistration', 'Register a term directly')}
                  </div>
                  <div className="mt-1 text-sm text-muted-foreground">
                    {t(
                      'answerCatalog.matching.manualTermRegistrationDescription',
                      'Use this when the standard term and aliases are already known.'
                    )}
                  </div>
                </div>
                <div className="mt-3 grid gap-3 lg:grid-cols-[minmax(180px,0.7fr)_minmax(280px,1.3fr)_auto]">
                  <div className="grid gap-2">
                    <Label>{t('answerCatalog.matching.canonicalTerm', 'Standard term')}</Label>
                    <Input
                      value={canonicalTerm}
                      onChange={(event) => setCanonicalTerm(event.target.value)}
                      placeholder={t('answerCatalog.matching.canonicalTermPlaceholder', 'Example: Microsoft Teams')}
                    />
                  </div>
                  <div className="grid gap-2">
                    <Label>{t('answerCatalog.matching.aliases', 'Aliases')}</Label>
                    <Input
                      value={aliasText}
                      onChange={(event) => setAliasText(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') handleCreateAlias()
                      }}
                      placeholder={t('answerCatalog.matching.aliasesPlaceholder', 'Example: Teams, MS Teams, 팀즈')}
                    />
                  </div>
                  <Button
                    className="self-end"
                    onClick={handleCreateAlias}
                    disabled={isSavingAlias}
                  >
                    {isSavingAlias ? <Loader2Icon className="h-4 w-4 animate-spin" /> : <PlusIcon className="h-4 w-4" />}
                    {t('answerCatalog.matching.addAliasGroup', 'Add term group')}
                  </Button>
                </div>
              </div>

              <div className="overflow-hidden rounded-md border bg-background">
                <div className="grid grid-cols-[minmax(180px,0.7fr)_minmax(0,1.3fr)_110px_44px] gap-3 border-b bg-muted/30 px-4 py-3 text-xs font-medium text-muted-foreground">
                  <span>{t('answerCatalog.matching.canonicalTerm', 'Standard term')}</span>
                  <span>{t('answerCatalog.matching.aliases', 'Aliases')}</span>
                  <span>{t('answerCatalog.matching.aliasSource', 'Source')}</span>
                  <span />
                </div>
                {aliasGroups.length === 0 ? (
                  <div className="p-5 text-sm text-muted-foreground">
                    {t('answerCatalog.matching.noAliases', 'No term alias groups are registered.')}
                  </div>
                ) : (
                  <div className="divide-y">
                    {aliasGroups.map((group) => (
                      <div
                        key={group.alias_id}
                        className="grid grid-cols-[minmax(180px,0.7fr)_minmax(0,1.3fr)_110px_44px] items-start gap-3 px-4 py-3"
                      >
                        <div className="font-medium">{group.canonical_term}</div>
                        <div className="flex flex-wrap gap-1.5">
                          {group.aliases.map((alias) => (
                            <Badge key={alias} variant="outline" className="bg-muted/20">
                              {alias}
                            </Badge>
                          ))}
                        </div>
                        <Badge variant="outline" className="w-fit">
                          {group.source === 'builtin'
                            ? t('answerCatalog.matching.aliasBuiltin', 'Built-in')
                            : t('answerCatalog.matching.aliasWorkspace', 'Workspace')}
                        </Badge>
                        {group.source !== 'builtin' ? (
                          <Button
                            variant="ghost"
                            size="icon"
                            title={t('common.delete', 'Delete')}
                            onClick={() => handleDeleteAlias(group.alias_id)}
                          >
                            <Trash2Icon className="h-4 w-4 text-rose-500" />
                          </Button>
                        ) : <span />}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </TabsContent>
        </Tabs>
      </div>

      <div className="pointer-events-none fixed inset-x-0 bottom-0 z-40 px-4 pb-4">
        <div className="pointer-events-auto mx-auto max-w-[calc(100vw-2rem)] overflow-hidden rounded-md border border-slate-200 bg-background shadow-[0_-6px_18px_rgba(15,23,42,0.10)] dark:border-slate-800 dark:shadow-[0_-6px_18px_rgba(0,0,0,0.28)]">
          {result && isTestResultOpen && (
            <div className="max-h-[46vh] overflow-auto border-b border-emerald-100 bg-background p-4 shadow-inner dark:border-emerald-900/40">
              <div className="mb-3 h-1 rounded-full bg-gradient-to-r from-emerald-300/70 via-sky-300/40 to-transparent" />
              <div className="flex flex-wrap items-start justify-between gap-3 rounded-md border border-emerald-200 bg-background/90 p-3 shadow-sm dark:border-emerald-900/70 dark:bg-background/80">
                <div>
                  <div className="flex flex-wrap items-center gap-2 text-base font-semibold">
                    <span className="flex h-7 w-7 items-center justify-center rounded-full bg-emerald-100 text-emerald-700 ring-1 ring-emerald-200 dark:bg-emerald-950 dark:text-emerald-200 dark:ring-emerald-800">
                      <SearchIcon className="h-4 w-4" />
                    </span>
                    <span>{t('answerCatalog.matching.testResultTitle', 'Answer selection test result')}</span>
                    <Badge
                      variant="outline"
                      className={result.selected_answer
                        ? 'border-emerald-300 bg-emerald-100 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-100'
                        : 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200'}
                    >
                      {Math.round(result.confidence * 100)}%
                    </Badge>
                    <Badge variant="outline" className="bg-background">{result.selected_by || retrievalMode}</Badge>
                    <Badge variant="outline" className="bg-background">
                      {result.selection_policy || selectionPolicy}
                    </Badge>
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    {t('answerCatalog.matching.testResultDescription', 'This panel shows how the current finding hints select an answer for the test question.')}
                  </div>
                </div>
                <Button variant="outline" size="sm" className="bg-background" onClick={() => setIsTestResultOpen(false)}>
                  <ChevronDownIcon className="h-4 w-4" />
                  {t('answerCatalog.matching.lowerResult', 'Lower result')}
                </Button>
              </div>

              {result.alias_expansions.length > 0 && (
                <div className="mt-3 rounded-md border border-sky-200 bg-sky-50/60 px-3 py-2 dark:border-sky-900 dark:bg-sky-950/20">
                  <div className="text-xs font-medium text-sky-800 dark:text-sky-200">
                    {t('answerCatalog.matching.appliedAliasExpansion', 'Applied term expansion')}
                  </div>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {result.alias_expansions.map((expansion) => (
                      <Badge
                        key={`${expansion.canonical_term}-${expansion.matched_term}`}
                        variant="outline"
                        className="border-sky-200 bg-background text-sky-800 dark:border-sky-800 dark:text-sky-100"
                      >
                        {expansion.matched_term} → {expansion.expanded_terms.join(', ')}
                      </Badge>
                    ))}
                  </div>
                </div>
              )}

              <div className="mt-4 grid gap-3 lg:grid-cols-[minmax(260px,360px)_1fr]">
                <div className="rounded-md border border-emerald-200 bg-background p-3 shadow-sm dark:border-emerald-900/70">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <div className="text-xs font-medium text-muted-foreground">{t('answerCatalog.test.selected', 'Selected Answer')}</div>
                      <div className="mt-2 text-base font-semibold">
                        {result.selected_answer ? result.selected_answer.title : t('answerCatalog.matching.noSelectedAnswer', 'No answer selected')}
                      </div>
                      <div className="mt-1 text-sm text-muted-foreground">
                        {result.selected_answer
                          ? result.selected_answer.answer_id
                          : result.abstention_reason
                            ? t(
                                `answerCatalog.test.abstention.${result.abstention_reason}`,
                                result.rationale
                              )
                            : result.rationale}
                      </div>
                      {!result.selected_answer && result.clarification_question && (
                        <div className="mt-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm font-medium text-amber-950 dark:border-amber-900 dark:bg-amber-950/20 dark:text-amber-100">
                          {t('answerCatalog.test.clarification', 'Follow-up question')}: {result.clarification_question}
                        </div>
                      )}
                      {result.matched_id && (
                        <div className="mt-2 inline-flex rounded-md border border-emerald-200 bg-emerald-50 px-2 py-1 font-mono text-xs font-semibold text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950/20 dark:text-emerald-100">
                          {t('answerCatalog.test.matchedId', 'Business ID')}: {result.matched_id}
                        </div>
                      )}
                    </div>
                    {result.selected_answer && (
                      <Button
                        variant="outline"
                        size="sm"
                        className="bg-background"
                        onClick={() => setShowSelectedAnswerContent((open) => !open)}
                      >
                        {showSelectedAnswerContent ? <ChevronUpIcon className="h-4 w-4" /> : <ChevronDownIcon className="h-4 w-4" />}
                        {showSelectedAnswerContent
                          ? t('answerCatalog.matching.hideSelectedAnswerContent', 'Hide content')
                          : t('answerCatalog.matching.showSelectedAnswerContent', 'View content')}
                      </Button>
                    )}
                  </div>
                  {result.selected_answer && showSelectedAnswerContent && (
                    <div className="mt-3 space-y-3 rounded-md border bg-muted/20 p-3">
                      {result.selected_answer.approved_summary && (
                        <div>
                          <div className="text-xs font-medium text-muted-foreground">
                            {t('answerCatalog.library.summary', 'Answer Memo')}
                          </div>
                          <div className="mt-1 whitespace-pre-wrap text-sm leading-6">
                            {result.selected_answer.approved_summary}
                          </div>
                        </div>
                      )}
                      <div>
                        <div className="text-xs font-medium text-muted-foreground">
                          {t('answerCatalog.library.body', 'Body')}
                        </div>
                        <AnswerContentPreview
                          content={result.selected_answer.body}
                          format={result.selected_answer.content_format}
                          className="mt-1"
                        />
                      </div>
                      {result.selected_answer.assets.length > 0 && (
                        <div>
                          <div className="mb-2 text-xs font-medium text-muted-foreground">
                            {t('answerCatalog.assets.section', 'Attachments')}
                          </div>
                          <AnswerAssetGallery assets={result.selected_answer.assets} />
                        </div>
                      )}
                    </div>
                  )}
                </div>

                <div className="rounded-md border border-slate-200 bg-background shadow-sm dark:border-slate-800">
                  <div className="border-b bg-slate-50 px-3 py-2 text-sm font-medium dark:bg-slate-950/40">
                    {t('answerCatalog.matching.candidateResults', 'Candidate answers')}
                  </div>
                  {result.candidates.length === 0 ? (
                    <div className="p-3 text-sm text-muted-foreground">
                      {t('answerCatalog.matching.noCandidates', 'No candidate answers were returned.')}
                    </div>
                  ) : (
                    <div className="grid max-h-56 gap-2 overflow-auto p-3 md:grid-cols-2 xl:grid-cols-3">
                      {result.candidates.map((candidate) => (
                        <div
                          key={candidate.answer.answer_id}
                          className={cn(
                            'rounded-md border bg-muted/10 p-3',
                            result.selected_answer?.answer_id === candidate.answer.answer_id && 'border-emerald-300 bg-emerald-50/70 dark:border-emerald-900 dark:bg-emerald-950/20'
                          )}
                        >
                          <div className="flex flex-wrap items-start justify-between gap-2">
                            <span className="min-w-0 flex-1 text-sm font-medium">{candidate.answer.title}</span>
                            <Badge variant="outline" className="bg-background">
                              {candidate.score}
                            </Badge>
                          </div>
                          <div className="mt-2 line-clamp-3 text-xs leading-5 text-muted-foreground">{candidate.reason}</div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          <div className="grid gap-3 p-3 xl:grid-cols-[180px_minmax(240px,1fr)_100px_150px_150px_170px_auto_auto] xl:items-end">
            <div className="hidden xl:block">
              <div className="flex items-center gap-2 font-semibold">
                <SearchIcon className="h-4 w-4 text-emerald-600" />
                {t('answerCatalog.matching.testDockTitle', 'Answer selection test')}
              </div>
              <div className="mt-1 text-xs text-muted-foreground">
                {t('answerCatalog.matching.testDockDescription', 'Verify which answer is selected without leaving this screen.')}
              </div>
            </div>
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
            <div className="grid gap-2">
              <Label>{t('answerCatalog.test.minScore', 'Min Score')}</Label>
              <Input value={minScore} onChange={(event) => setMinScore(event.target.value)} />
            </div>
            <label className="flex h-10 items-center gap-2 rounded-md border bg-muted/20 px-3 text-sm text-muted-foreground">
              <Checkbox checked={includeDrafts} onCheckedChange={(checked) => setIncludeDrafts(Boolean(checked))} />
              {t('answerCatalog.test.includeDrafts', 'Include draft answers')}
            </label>
            <div className="grid gap-2">
              <Label>{t('answerCatalog.test.retrievalMode', 'Retrieval Mode')}</Label>
              <Select value={retrievalMode} onValueChange={(value) => setRetrievalMode(value as 'keyword' | 'hybrid' | 'graph_hybrid' | 'llm_rerank')}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="keyword">{t('answerCatalog.test.modeKeyword', 'Keyword')}</SelectItem>
                  <SelectItem value="hybrid">{t('answerCatalog.test.modeHybrid', 'Keyword + Vector')}</SelectItem>
                  <SelectItem value="graph_hybrid">{t('answerCatalog.test.modeGraphHybrid', 'Keyword + Vector + Graph')}</SelectItem>
                  <SelectItem value="llm_rerank">{t('answerCatalog.test.modeLlm', 'LLM ID Select')}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label>{t('answerCatalog.test.selectionPolicy', 'Answer Policy')}</Label>
              <Select
                value={selectionPolicy}
                onValueChange={(value) =>
                  setSelectionPolicy(value as 'workspace' | 'coverage' | 'precision')
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="workspace">
                    {t('answerCatalog.test.policyWorkspace', 'Workspace setting')}
                  </SelectItem>
                  <SelectItem value="precision">
                    {t('answerCatalog.test.policyPrecision', 'Answer only when certain')}
                  </SelectItem>
                  <SelectItem value="coverage">
                    {t('answerCatalog.test.policyCoverage', 'Prefer an answer')}
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
            <Button
              className="h-10"
              onClick={handleResolve}
              disabled={isTesting}
            >
              {isTesting ? <Loader2Icon className="h-4 w-4 animate-spin" /> : <SearchIcon className="h-4 w-4" />}
              {t('answerCatalog.test.run', 'Find Answer')}
            </Button>
            <Button
              variant="outline"
              className="h-10"
              onClick={() => setIsTestResultOpen((open) => !open)}
              disabled={!result}
            >
              {isTestResultOpen ? <ChevronDownIcon className="h-4 w-4" /> : <ChevronUpIcon className="h-4 w-4" />}
              {isTestResultOpen
                ? t('answerCatalog.matching.lowerResult', 'Lower result')
                : t('answerCatalog.matching.showResult', 'Show result')}
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}

function MiniMetric({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-md border bg-muted/10 p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 text-lg font-semibold">{value.toLocaleString()}</div>
    </div>
  )
}

function GuidanceListRow({
  item,
  onDelete,
  t,
}: {
  item: GuidanceRow
  onDelete: () => void
  t: any
}) {
  return (
    <div className="grid gap-2 p-3 hover:bg-muted/50 md:grid-cols-[1fr_140px_90px_48px] md:items-center">
      <div className="min-w-0">
        <div className="truncate text-sm font-medium">{item.text}</div>
        <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          {item.answer && <span className="truncate">{item.answer.title}</span>}
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
        onClick={onDelete}
        className="text-rose-500 hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-950/30"
      >
        <Trash2Icon className="h-4 w-4" />
      </Button>
    </div>
  )
}

function GuidanceTable({
  rows,
  isLoading,
  onDelete,
  t,
}: {
  rows: GuidanceRow[]
  isLoading: boolean
  onDelete: (item: GuidanceRow) => void
  t: any
}) {
  return (
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
      ) : rows.length === 0 ? (
        <div className="p-4 text-sm text-muted-foreground">
          {t('answerCatalog.library.noGuidance', 'No finding hints are registered.')}
        </div>
      ) : (
        <div className="divide-y">
          {rows.map((item) => (
            <GuidanceListRow
              key={item.guidance_id}
              item={item}
              onDelete={() => onDelete(item)}
              t={t}
            />
          ))}
        </div>
      )}
    </div>
  )
}

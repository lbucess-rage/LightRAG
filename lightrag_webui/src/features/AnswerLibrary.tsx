import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import {
  ArchiveIcon,
  BookOpenIcon,
  Edit3Icon,
  HistoryIcon,
  LinkIcon,
  Loader2Icon,
  PlusIcon,
  RefreshCwIcon,
  RotateCcwIcon,
  SaveIcon,
  SendIcon,
  Trash2Icon,
} from 'lucide-react'

import {
  AnswerContentFormat,
  AnswerDisplayPolicy,
  AnswerGuidance,
  AnswerGuidanceType,
  AnswerItem,
  AnswerRevision,
  AnswerSourceLink,
  AnswerStatus,
  addAnswerGuidance,
  archiveAnswer,
  deleteAnswerGuidance,
  listAnswerSourceLinks,
  listAnswerGuidance,
  listAnswerRevisions,
  listAnswers,
  publishAnswer,
  restoreAnswerRevision,
  updateAnswer,
} from '@/api/lightrag'
import AnswerContentPreview from '@/components/answers/AnswerContentPreview'
import Badge from '@/components/ui/Badge'
import AnswerHelpButton from '@/components/answers/AnswerHelpButton'
import Button from '@/components/ui/Button'
import Input from '@/components/ui/Input'
import PaginationControls from '@/components/ui/PaginationControls'
import Textarea from '@/components/ui/Textarea'
import { Label } from '@/components/ui/Label'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/Dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/Select'
import { localizedErrorMessage } from '@/lib/utils'
import { useSettingsStore } from '@/stores/settings'
import { useWorkspaceStore } from '@/stores/workspace'

const statusVariant = (status: AnswerStatus): 'default' | 'secondary' | 'destructive' | 'outline' => {
  if (status === 'published') return 'secondary'
  if (status === 'archived' || status === 'expired') return 'outline'
  return 'default'
}

const parseCsv = (value: string) =>
  value.split(',').map((item) => item.trim()).filter(Boolean)

const toLocalDateTimeValue = (value?: string | null) => {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  const localDate = new Date(date.getTime() - date.getTimezoneOffset() * 60000)
  return localDate.toISOString().slice(0, 16)
}

const fromLocalDateTimeValue = (value: string) => (value ? new Date(value).toISOString() : null)
const ANSWER_PAGE_SIZE_OPTIONS = [
  { value: 10, label: '10' },
  { value: 20, label: '20' },
  { value: 50, label: '50' },
  { value: 100, label: '100' },
]

const answerSourceTypeOptions = [
  'plain',
  'markdown',
  'html',
  'url',
  'file',
  'excel',
  'structured',
  'manual_table',
  'db_table',
  'multi_table',
  'nosql_collection',
  'web',
]

export default function AnswerLibrary() {
  const { t } = useTranslation()
  const currentWorkspaceId = useWorkspaceStore.use.currentWorkspaceId()
  const setCurrentTab = useSettingsStore.use.setCurrentTab()
  const [answers, setAnswers] = useState<AnswerItem[]>([])
  const [status, setStatus] = useState<string>('all')
  const [search, setSearch] = useState('')
  const [contentFormat, setContentFormat] = useState<string>('all')
  const [displayPolicy, setDisplayPolicy] = useState<string>('all')
  const [validity, setValidity] = useState<string>('all')
  const [tag, setTag] = useState('')
  const [sourceType, setSourceType] = useState<string>('all')
  const [hasGuidance, setHasGuidance] = useState<string>('all')
  const [hasSource, setHasSource] = useState<string>('all')
  const [minPriority, setMinPriority] = useState('')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(20)
  const [totalAnswers, setTotalAnswers] = useState(0)
  const [isLoading, setIsLoading] = useState(false)
  const [selectedAnswer, setSelectedAnswer] = useState<AnswerItem | null>(null)

  const fetchAnswers = useCallback(async () => {
    const workspaceId = currentWorkspaceId
    setIsLoading(true)
    try {
      const trimmedMinPriority = minPriority.trim()
      const result = await listAnswers({
        status,
        search: search.trim() || undefined,
        content_format: contentFormat !== 'all' ? contentFormat : undefined,
        display_policy: displayPolicy !== 'all' ? displayPolicy : undefined,
        validity: validity !== 'all' ? validity : undefined,
        tag: tag.trim() || undefined,
        source_type: sourceType !== 'all' ? sourceType : undefined,
        has_guidance: hasGuidance === 'all' ? undefined : hasGuidance === 'yes',
        has_source: hasSource === 'all' ? undefined : hasSource === 'yes',
        min_priority: trimmedMinPriority ? Number(trimmedMinPriority) : undefined,
        page,
        page_size: pageSize,
      })
      if (workspaceId !== useWorkspaceStore.getState().currentWorkspaceId) return
      const totalPages = Math.max(1, Math.ceil(result.total / result.page_size))
      if (result.answers.length === 0 && result.total > 0 && page > totalPages) {
        setPage(totalPages)
        return
      }
      setAnswers(result.answers)
      setTotalAnswers(result.total)
    } catch (err) {
      toast.error(localizedErrorMessage(err, t))
    } finally {
      setIsLoading(false)
    }
  }, [
    contentFormat,
    currentWorkspaceId,
    displayPolicy,
    hasGuidance,
    hasSource,
    minPriority,
    page,
    pageSize,
    search,
    sourceType,
    status,
    tag,
    t,
    validity,
  ])

  useEffect(() => {
    setAnswers([])
    setPage(1)
    setTotalAnswers(0)
    setSelectedAnswer(null)
    setStatus('all')
    setSearch('')
    setContentFormat('all')
    setDisplayPolicy('all')
    setValidity('all')
    setTag('')
    setSourceType('all')
    setHasGuidance('all')
    setHasSource('all')
    setMinPriority('')
  }, [currentWorkspaceId])

  useEffect(() => {
    fetchAnswers()
  }, [fetchAnswers])

  const totalPages = useMemo(() => Math.max(1, Math.ceil(totalAnswers / pageSize)), [pageSize, totalAnswers])

  const handleSearchChange = (value: string) => {
    setSearch(value)
    setPage(1)
  }

  const handleStatusChange = (value: string) => {
    setStatus(value)
    setPage(1)
  }

  const resetFilters = () => {
    setStatus('all')
    setSearch('')
    setContentFormat('all')
    setDisplayPolicy('all')
    setValidity('all')
    setTag('')
    setSourceType('all')
    setHasGuidance('all')
    setHasSource('all')
    setMinPriority('')
    setPage(1)
  }

  const handlePageSizeChange = (value: number) => {
    setPageSize(value)
    setPage(1)
  }

  const handlePublish = async (answer: AnswerItem) => {
    try {
      await publishAnswer(answer.answer_id)
      toast.success(t('answerCatalog.library.published', 'Answer published.'))
      fetchAnswers()
    } catch (err) {
      toast.error(localizedErrorMessage(err, t))
    }
  }

  const handleArchive = async (answer: AnswerItem) => {
    try {
      await archiveAnswer(answer.answer_id)
      toast.success(t('answerCatalog.library.archived', 'Answer archived.'))
      fetchAnswers()
    } catch (err) {
      toast.error(localizedErrorMessage(err, t))
    }
  }

  return (
    <div className="flex h-full flex-col gap-4 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">{t('answerCatalog.library.title', 'View Answers')}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {t('answerCatalog.library.description', 'Manage approved answers, versions, validity, and matching hints.')}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <AnswerHelpButton />
          <Button variant="outline" size="sm" onClick={fetchAnswers} disabled={isLoading}>
            <RefreshCwIcon className={isLoading ? 'h-4 w-4 animate-spin' : 'h-4 w-4'} />
            {t('common.refresh', 'Refresh')}
          </Button>
          <Button size="sm" onClick={() => setCurrentTab('answer-sources')}>
            <PlusIcon className="h-4 w-4" />
            {t('answerCatalog.library.openAddAnswers', '답변 추가 열기')}
          </Button>
        </div>
      </div>

      <div className="grid gap-3 rounded-md border p-3">
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-[minmax(220px,1.6fr)_repeat(4,minmax(140px,1fr))]">
          <div className="grid gap-1.5">
            <Label className="text-xs">{t('answerCatalog.library.searchLabel', '검색어')}</Label>
            <Input
              value={search}
              onChange={(event) => handleSearchChange(event.target.value)}
              placeholder={t('answerCatalog.library.search', 'Search answers...')}
            />
          </div>
          <div className="grid gap-1.5">
            <Label className="text-xs">{t('answerCatalog.library.status', 'Status')}</Label>
            <Select value={status} onValueChange={handleStatusChange}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t('common.all', 'All')}</SelectItem>
                <SelectItem value="draft">{t('answerCatalog.status.draft', 'Draft')}</SelectItem>
                <SelectItem value="published">{t('answerCatalog.status.published', 'Published')}</SelectItem>
                <SelectItem value="archived">{t('answerCatalog.status.archived', 'Archived')}</SelectItem>
                <SelectItem value="expired">{t('answerCatalog.status.expired', 'Expired')}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-1.5">
            <Label className="text-xs">{t('answerCatalog.library.contentFormat', 'Format')}</Label>
            <Select value={contentFormat} onValueChange={(value) => { setContentFormat(value); setPage(1) }}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t('answerCatalog.library.allFormats', '전체 형식')}</SelectItem>
                <SelectItem value="plain">{t('answerCatalog.sources.types.plain', 'Plain Text')}</SelectItem>
                <SelectItem value="markdown">{t('answerCatalog.sources.types.markdown', 'Markdown')}</SelectItem>
                <SelectItem value="html">{t('answerCatalog.sources.types.html', 'HTML')}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-1.5">
            <Label className="text-xs">{t('answerCatalog.library.displayPolicy', 'Display Option')}</Label>
            <Select value={displayPolicy} onValueChange={(value) => { setDisplayPolicy(value); setPage(1) }}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t('answerCatalog.library.allDisplayPolicies', '전체 표시 방식')}</SelectItem>
                <SelectItem value="summary">{t('answerCatalog.displayPolicy.summary', 'Summary')}</SelectItem>
                <SelectItem value="full">{t('answerCatalog.displayPolicy.full', 'Full')}</SelectItem>
                <SelectItem value="both">{t('answerCatalog.displayPolicy.both', 'Both')}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-1.5">
            <Label className="text-xs">{t('answerCatalog.library.validity', 'Validity')}</Label>
            <Select value={validity} onValueChange={(value) => { setValidity(value); setPage(1) }}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t('common.all', 'All')}</SelectItem>
                <SelectItem value="active">{t('answerCatalog.library.validityActive', '현재 사용 가능')}</SelectItem>
                <SelectItem value="scheduled">{t('answerCatalog.library.validityScheduled', '예약됨')}</SelectItem>
                <SelectItem value="expired">{t('answerCatalog.library.validityExpired', '만료됨')}</SelectItem>
                <SelectItem value="no_period">{t('answerCatalog.library.validityNoPeriod', '기간 없음')}</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-[minmax(160px,1fr)_minmax(160px,1fr)_120px_140px_140px_auto_auto]">
          <div className="grid gap-1.5">
            <Label className="text-xs">{t('answerCatalog.library.tagFilter', '태그')}</Label>
            <Input
              value={tag}
              onChange={(event) => { setTag(event.target.value); setPage(1) }}
              placeholder={t('answerCatalog.library.tagFilterPlaceholder', '태그명')}
            />
          </div>
          <div className="grid gap-1.5">
            <Label className="text-xs">{t('answerCatalog.library.sourceTypeFilter', '답변 추가 유형')}</Label>
            <Select value={sourceType} onValueChange={(value) => { setSourceType(value); setPage(1) }}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t('common.all', 'All')}</SelectItem>
                {answerSourceTypeOptions.map((option) => (
                  <SelectItem key={option} value={option}>
                    {t(`answerCatalog.sources.types.${option}`, t(`answerCatalog.sources.connectorTypes.${option}`, option))}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-1.5">
            <Label className="text-xs">{t('answerCatalog.library.minPriority', '최소 우선순위')}</Label>
            <Input
              type="number"
              value={minPriority}
              onChange={(event) => { setMinPriority(event.target.value); setPage(1) }}
              placeholder="0"
            />
          </div>
          <div className="grid gap-1.5">
            <Label className="text-xs">{t('answerCatalog.library.hasGuidance', '찾기 힌트')}</Label>
            <Select value={hasGuidance} onValueChange={(value) => { setHasGuidance(value); setPage(1) }}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t('common.all', 'All')}</SelectItem>
                <SelectItem value="yes">{t('answerCatalog.library.exists', '있음')}</SelectItem>
                <SelectItem value="no">{t('answerCatalog.library.missing', '없음')}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-1.5">
            <Label className="text-xs">{t('answerCatalog.library.hasSource', '생성 기록')}</Label>
            <Select value={hasSource} onValueChange={(value) => { setHasSource(value); setPage(1) }}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t('common.all', 'All')}</SelectItem>
                <SelectItem value="yes">{t('answerCatalog.library.exists', '있음')}</SelectItem>
                <SelectItem value="no">{t('answerCatalog.library.missing', '없음')}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <Button variant="outline" onClick={resetFilters} className="self-end">
            {t('answerCatalog.library.resetFilters', '조건 초기화')}
          </Button>
          <Button onClick={fetchAnswers} disabled={isLoading} className="self-end">
            {isLoading ? <Loader2Icon className="h-4 w-4 animate-spin" /> : <RefreshCwIcon className="h-4 w-4" />}
            {t('common.search', 'Search')}
          </Button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-auto rounded-md border">
        {answers.length === 0 ? (
          <div className="flex h-full min-h-72 flex-col items-center justify-center p-8 text-center">
            <BookOpenIcon className="mb-3 h-8 w-8 text-muted-foreground" />
            <div className="text-sm font-medium">{t('answerCatalog.library.empty', 'No answers yet')}</div>
            <div className="mt-1 text-sm text-muted-foreground">
              {t('answerCatalog.library.emptyDesc', 'Create the first answer candidate from Add Answers.')}
            </div>
          </div>
        ) : (
          <div className="divide-y">
            {answers.map((answer) => (
              <div key={answer.answer_id} className="grid gap-3 p-4 lg:grid-cols-[1fr_auto]">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="truncate text-base font-semibold">{answer.title}</h2>
                    <Badge variant={statusVariant(answer.status)}>
                      {t(`answerCatalog.status.${answer.status}`, answer.status)}
                    </Badge>
                    <Badge variant="outline">v{answer.version}</Badge>
                    <span className="font-mono text-xs text-muted-foreground">{answer.answer_id}</span>
                  </div>
                  <p className="mt-2 line-clamp-3 whitespace-pre-wrap text-sm">{answer.body}</p>
                  {answer.tags.length > 0 && (
                    <div className="mt-3 flex flex-wrap gap-1">
                      {answer.tags.map((tag) => (
                        <Badge key={tag} variant="outline">{tag}</Badge>
                      ))}
                    </div>
                  )}
                </div>
                <div className="flex items-start gap-2">
                  <Button size="sm" variant="outline" onClick={() => setSelectedAnswer(answer)}>
                    <Edit3Icon className="h-4 w-4" />
                    {t('common.edit', 'Edit')}
                  </Button>
                  {answer.status !== 'published' && (
                    <Button size="sm" onClick={() => handlePublish(answer)}>
                      <SendIcon className="h-4 w-4" />
                      {t('answerCatalog.library.publish', 'Publish')}
                    </Button>
                  )}
                  {answer.status !== 'archived' && (
                    <Button size="sm" variant="outline" onClick={() => handleArchive(answer)}>
                      <ArchiveIcon className="h-4 w-4" />
                      {t('answerCatalog.library.archive', 'Archive')}
                    </Button>
                  )}
                </div>
              </div>
            ))}
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
      />
      <AnswerDetailDialog
        answer={selectedAnswer}
        open={Boolean(selectedAnswer)}
        onOpenChange={(open) => {
          if (!open) setSelectedAnswer(null)
        }}
        onChanged={(answer) => {
          setSelectedAnswer(answer)
          fetchAnswers()
        }}
      />
    </div>
  )
}

function AnswerDetailDialog({
  answer,
  open,
  onOpenChange,
  onChanged,
}: {
  answer: AnswerItem | null
  open: boolean
  onOpenChange: (open: boolean) => void
  onChanged: (answer: AnswerItem) => void
}) {
  const { t } = useTranslation()
  const [section, setSection] = useState<'content' | 'guidance' | 'sources' | 'revisions'>('content')
  const [title, setTitle] = useState('')
  const [summary, setSummary] = useState('')
  const [body, setBody] = useState('')
  const [status, setStatus] = useState<AnswerStatus>('draft')
  const [displayPolicy, setDisplayPolicy] = useState<AnswerDisplayPolicy>('both')
  const [contentFormat, setContentFormat] = useState<AnswerContentFormat>('markdown')
  const [priority, setPriority] = useState('0')
  const [tags, setTags] = useState('')
  const [validFrom, setValidFrom] = useState('')
  const [validUntil, setValidUntil] = useState('')
  const [guidance, setGuidance] = useState<AnswerGuidance[]>([])
  const [revisions, setRevisions] = useState<AnswerRevision[]>([])
  const [sourceLinks, setSourceLinks] = useState<AnswerSourceLink[]>([])
  const [guidanceType, setGuidanceType] = useState<AnswerGuidanceType>('keyword')
  const [guidanceText, setGuidanceText] = useState('')
  const [guidanceWeight, setGuidanceWeight] = useState('1')
  const [isSaving, setIsSaving] = useState(false)
  const [isLoadingDetails, setIsLoadingDetails] = useState(false)

  const resetFromAnswer = useCallback((value: AnswerItem | null) => {
    if (!value) return
    setTitle(value.title)
    setSummary(value.approved_summary || '')
    setBody(value.body)
    setStatus(value.status)
    setDisplayPolicy(value.display_policy)
    setContentFormat(value.content_format)
    setPriority(String(value.priority ?? 0))
    setTags(value.tags.join(', '))
    setValidFrom(toLocalDateTimeValue(value.valid_from))
    setValidUntil(toLocalDateTimeValue(value.valid_until))
  }, [])

  const reloadDetails = useCallback(async () => {
    if (!answer) return
    setIsLoadingDetails(true)
    try {
      const [nextGuidance, nextRevisions, nextSourceLinks] = await Promise.all([
        listAnswerGuidance(answer.answer_id),
        listAnswerRevisions(answer.answer_id),
        listAnswerSourceLinks(answer.answer_id),
      ])
      setGuidance(nextGuidance)
      setRevisions(nextRevisions)
      setSourceLinks(nextSourceLinks)
    } catch (err) {
      toast.error(localizedErrorMessage(err, t))
    } finally {
      setIsLoadingDetails(false)
    }
  }, [answer, t])

  useEffect(() => {
    if (!open || !answer) return
    resetFromAnswer(answer)
    setSection('content')
    reloadDetails()
  }, [answer, open, reloadDetails, resetFromAnswer])

  const handleSave = async () => {
    if (!answer) return
    if (!title.trim() || !body.trim()) {
      toast.error(t('answerCatalog.library.required', 'Title and body are required.'))
      return
    }
    setIsSaving(true)
    try {
      const updated = await updateAnswer(answer.answer_id, {
        title: title.trim(),
        approved_summary: summary.trim() || null,
        body: body.trim(),
        status,
        display_policy: displayPolicy,
        content_format: contentFormat,
        priority: Number(priority) || 0,
        tags: parseCsv(tags),
        valid_from: fromLocalDateTimeValue(validFrom),
        valid_until: fromLocalDateTimeValue(validUntil),
      })
      toast.success(t('answerCatalog.library.saved', 'Answer saved.'))
      onChanged(updated)
      reloadDetails()
    } catch (err) {
      toast.error(localizedErrorMessage(err, t))
    } finally {
      setIsSaving(false)
    }
  }

  const handleAddGuidance = async () => {
    if (!answer || !guidanceText.trim()) return
    setIsSaving(true)
    try {
      await addAnswerGuidance(answer.answer_id, {
        guidance_type: guidanceType,
        text: guidanceText.trim(),
        weight: Number(guidanceWeight) || 1,
      })
      setGuidanceText('')
      setGuidanceWeight('1')
      toast.success(t('answerCatalog.library.guidanceAdded', 'Guidance added.'))
      reloadDetails()
    } catch (err) {
      toast.error(localizedErrorMessage(err, t))
    } finally {
      setIsSaving(false)
    }
  }

  const handleDeleteGuidance = async (item: AnswerGuidance) => {
    if (!answer) return
    setIsSaving(true)
    try {
      await deleteAnswerGuidance(answer.answer_id, item.guidance_id)
      toast.success(t('answerCatalog.library.guidanceDeleted', 'Guidance deleted.'))
      reloadDetails()
    } catch (err) {
      toast.error(localizedErrorMessage(err, t))
    } finally {
      setIsSaving(false)
    }
  }

  const handleRestoreRevision = async (revision: AnswerRevision) => {
    if (!answer) return
    setIsSaving(true)
    try {
      const restored = await restoreAnswerRevision(answer.answer_id, revision.revision_id)
      resetFromAnswer(restored)
      onChanged(restored)
      toast.success(t('answerCatalog.library.revisionRestored', 'Revision restored.'))
      reloadDetails()
    } catch (err) {
      toast.error(localizedErrorMessage(err, t))
    } finally {
      setIsSaving(false)
    }
  }

  if (!answer) return null

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-6xl">
        <DialogHeader>
          <DialogTitle>{t('answerCatalog.library.detailTitle', 'Answer Details')}</DialogTitle>
          <DialogDescription>
            <span className="font-mono">{answer.answer_id}</span>
            <span className="ml-2">v{answer.version}</span>
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-wrap gap-2">
          {(['content', 'guidance', 'sources', 'revisions'] as const).map((item) => (
            <Button
              key={item}
              type="button"
              size="sm"
              variant={section === item ? 'default' : 'outline'}
              onClick={() => setSection(item)}
            >
              {item === 'content' && t('answerCatalog.library.contentSection', 'Content')}
              {item === 'guidance' && t('answerCatalog.library.guidanceSection', 'Guidance')}
              {item === 'sources' && t('answerCatalog.library.sourcesSection', 'Sources')}
              {item === 'revisions' && t('answerCatalog.library.revisionsSection', 'Revisions')}
            </Button>
          ))}
        </div>

        {section === 'content' && (
          <div className="grid gap-4 py-2">
            <div className="grid gap-4 lg:grid-cols-[1fr_180px_180px_130px]">
              <div className="grid gap-2">
                <Label>{t('answerCatalog.library.answerTitle', 'Title')}</Label>
                <Input value={title} onChange={(event) => setTitle(event.target.value)} />
              </div>
              <div className="grid gap-2">
                <Label>{t('answerCatalog.library.status', 'Status')}</Label>
                <Select value={status} onValueChange={(value) => setStatus(value as AnswerStatus)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="draft">{t('answerCatalog.status.draft', 'Draft')}</SelectItem>
                    <SelectItem value="published">{t('answerCatalog.status.published', 'Published')}</SelectItem>
                    <SelectItem value="archived">{t('answerCatalog.status.archived', 'Archived')}</SelectItem>
                    <SelectItem value="expired">{t('answerCatalog.status.expired', 'Expired')}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-2">
                <Label>{t('answerCatalog.library.displayPolicy', 'Display Policy')}</Label>
                <Select value={displayPolicy} onValueChange={(value) => setDisplayPolicy(value as AnswerDisplayPolicy)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="summary">{t('answerCatalog.display.summary', 'Summary')}</SelectItem>
                    <SelectItem value="full">{t('answerCatalog.display.full', 'Full')}</SelectItem>
                    <SelectItem value="both">{t('answerCatalog.display.both', 'Both')}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-2">
                <Label>{t('answerCatalog.library.priority', 'Priority')}</Label>
                <Input type="number" value={priority} onChange={(event) => setPriority(event.target.value)} />
              </div>
            </div>

            <div className="grid gap-4 lg:grid-cols-3">
              <div className="grid gap-2">
                <Label>{t('answerCatalog.library.contentFormat', 'Format')}</Label>
                <Select value={contentFormat} onValueChange={(value) => setContentFormat(value as AnswerContentFormat)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="plain">{t('answerCatalog.sources.types.plain', 'Plain Text')}</SelectItem>
                    <SelectItem value="markdown">{t('answerCatalog.sources.types.markdown', 'Markdown')}</SelectItem>
                    <SelectItem value="html">{t('answerCatalog.sources.types.html', 'HTML')}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-2">
                <Label>{t('answerCatalog.library.validFrom', 'Valid From')}</Label>
                <Input type="datetime-local" value={validFrom} onChange={(event) => setValidFrom(event.target.value)} />
              </div>
              <div className="grid gap-2">
                <Label>{t('answerCatalog.library.validUntil', 'Valid Until')}</Label>
                <Input type="datetime-local" value={validUntil} onChange={(event) => setValidUntil(event.target.value)} />
              </div>
            </div>

            <div className="grid gap-2">
              <Label>{t('answerCatalog.library.body', 'Body')}</Label>
              <Textarea value={body} onChange={(event) => setBody(event.target.value)} className="min-h-56" />
            </div>
            <AnswerContentPreview content={body} format={contentFormat} />
            <div className="grid gap-2">
              <Label>{t('answerCatalog.library.summary', 'Answer Memo')}</Label>
              <Textarea value={summary} onChange={(event) => setSummary(event.target.value)} rows={3} />
              <p className="text-xs leading-5 text-muted-foreground">
                {t(
                  'answerCatalog.library.summaryHelp',
                  'Internal note for approval requests, review context, or change history. It is separate from the answer body.'
                )}
              </p>
            </div>
            <div className="grid gap-2">
              <Label>{t('answerCatalog.library.tags', 'Tags')}</Label>
              <Input value={tags} onChange={(event) => setTags(event.target.value)} />
            </div>
          </div>
        )}

        {section === 'guidance' && (
          <div className="grid gap-4 py-2">
            <div className="grid gap-3 rounded-md border p-3 lg:grid-cols-[180px_1fr_120px_auto]">
              <div>
                <Label>{t('answerCatalog.library.guidanceType', 'Type')}</Label>
                <Select value={guidanceType} onValueChange={(value) => setGuidanceType(value as AnswerGuidanceType)}>
                  <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="keyword">{t('answerCatalog.guidance.keyword', 'Keyword')}</SelectItem>
                    <SelectItem value="question">{t('answerCatalog.guidance.question', 'Question')}</SelectItem>
                    <SelectItem value="synonym">{t('answerCatalog.guidance.synonym', 'Synonym')}</SelectItem>
                    <SelectItem value="negative_keyword">{t('answerCatalog.guidance.negative_keyword', 'Negative')}</SelectItem>
                    <SelectItem value="note">{t('answerCatalog.guidance.note', 'Note')}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>{t('answerCatalog.library.guidanceText', 'Guidance Text')}</Label>
                <Input className="mt-1" value={guidanceText} onChange={(event) => setGuidanceText(event.target.value)} />
              </div>
              <div>
                <Label>{t('answerCatalog.library.weight', 'Weight')}</Label>
                <Input className="mt-1" type="number" min="0" max="10" step="0.1" value={guidanceWeight} onChange={(event) => setGuidanceWeight(event.target.value)} />
              </div>
              <div className="flex items-end">
                <Button onClick={handleAddGuidance} disabled={isSaving || !guidanceText.trim()}>
                  <PlusIcon className="h-4 w-4" />
                  {t('common.add', 'Add')}
                </Button>
              </div>
            </div>
            <div className="rounded-md border">
              <div className="flex items-center justify-between border-b p-3">
                <div className="font-medium">{t('answerCatalog.library.guidanceSection', 'Guidance')}</div>
                {isLoadingDetails && <Loader2Icon className="h-4 w-4 animate-spin" />}
              </div>
              {guidance.length === 0 ? (
                <div className="p-4 text-sm text-muted-foreground">{t('answerCatalog.library.noGuidance', 'No guidance is registered.')}</div>
              ) : (
                <div className="divide-y">
                  {guidance.map((item) => (
                    <div key={item.guidance_id} className="grid gap-2 p-3 lg:grid-cols-[140px_1fr_100px_auto]">
                      <Badge variant={item.guidance_type === 'negative_keyword' ? 'destructive' : 'outline'}>
                        {t(`answerCatalog.guidance.${item.guidance_type}`, item.guidance_type)}
                      </Badge>
                      <div className="text-sm">{item.text}</div>
                      <div className="text-sm text-muted-foreground">{item.weight}</div>
                      <Button size="sm" variant="outline" onClick={() => handleDeleteGuidance(item)} disabled={isSaving}>
                        <Trash2Icon className="h-4 w-4" />
                        {t('common.delete', 'Delete')}
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {section === 'sources' && (
          <div className="grid gap-3 py-2">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <LinkIcon className="h-4 w-4" />
              {t('answerCatalog.library.sourcesDesc', 'Source snapshots show where this answer version came from.')}
            </div>
            <div className="rounded-md border">
              {sourceLinks.length === 0 ? (
                <div className="p-4 text-sm text-muted-foreground">{t('answerCatalog.library.noSources', 'No source snapshots are linked to this answer.')}</div>
              ) : (
                <div className="divide-y">
                  {sourceLinks.map((link) => {
                    const snapshot = link.snapshot
                    return (
                      <div key={link.link_id} className="grid gap-3 p-3 lg:grid-cols-[1fr_170px]">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <Badge variant="outline">{snapshot?.source_type || link.link_type}</Badge>
                            <Badge variant="outline">v{link.answer_version}</Badge>
                            <span className="truncate text-sm font-medium">
                              {snapshot?.title || snapshot?.file_name || snapshot?.source_uri || link.snapshot_id}
                            </span>
                          </div>
                          <div className="mt-1 truncate font-mono text-xs text-muted-foreground">{link.snapshot_id}</div>
                          {snapshot?.source_uri && <div className="mt-1 truncate text-xs text-muted-foreground">{snapshot.source_uri}</div>}
                          {snapshot?.content_preview && (
                            <div className="mt-2 line-clamp-2 text-xs text-muted-foreground">{snapshot.content_preview}</div>
                          )}
                          {snapshot?.profile?.structured?.columns?.length > 0 && (
                            <div className="mt-2 flex flex-wrap gap-1">
                              {snapshot.profile.structured.columns.slice(0, 8).map((column: string) => (
                                <Badge key={column} variant="outline">{column}</Badge>
                              ))}
                            </div>
                          )}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          <div>{link.create_time ? new Date(link.create_time).toLocaleString() : '-'}</div>
                          {snapshot && (
                            <>
                              <div className="mt-2">{snapshot.content_length.toLocaleString()} chars</div>
                              <div className="mt-1 font-mono">{snapshot.content_hash.slice(0, 12)}</div>
                            </>
                          )}
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          </div>
        )}

        {section === 'revisions' && (
          <div className="grid gap-3 py-2">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <HistoryIcon className="h-4 w-4" />
              {t('answerCatalog.library.revisionDesc', 'Every save creates a restorable answer snapshot.')}
            </div>
            <div className="rounded-md border">
              {revisions.length === 0 ? (
                <div className="p-4 text-sm text-muted-foreground">{t('answerCatalog.library.noRevisions', 'No revisions were recorded.')}</div>
              ) : (
                <div className="divide-y">
                  {revisions.map((revision) => (
                    <div key={revision.revision_id} className="grid gap-3 p-3 lg:grid-cols-[140px_1fr_auto]">
                      <div>
                        <Badge variant="outline">v{revision.version}</Badge>
                        <div className="mt-1 text-xs text-muted-foreground">{revision.created_at ? new Date(revision.created_at).toLocaleString() : '-'}</div>
                      </div>
                      <div className="min-w-0">
                        <div className="truncate text-sm font-medium">{String(revision.snapshot.title || '')}</div>
                        <div className="mt-1 line-clamp-2 text-xs text-muted-foreground">{String(revision.snapshot.approved_summary || revision.snapshot.body || '')}</div>
                      </div>
                      <Button size="sm" variant="outline" onClick={() => handleRestoreRevision(revision)} disabled={isSaving}>
                        <RotateCcwIcon className="h-4 w-4" />
                        {t('answerCatalog.library.restoreRevision', 'Restore')}
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isSaving}>
            {t('common.close', 'Close')}
          </Button>
          <Button onClick={handleSave} disabled={isSaving}>
            {isSaving ? <Loader2Icon className="h-4 w-4 animate-spin" /> : <SaveIcon className="h-4 w-4" />}
            {t('common.save', 'Save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import {
  ArchiveIcon,
  BookOpenIcon,
  ChevronDownIcon,
  Edit3Icon,
  FilterIcon,
  HistoryIcon,
  LinkIcon,
  Loader2Icon,
  PaperclipIcon,
  PlusIcon,
  RefreshCwIcon,
  RotateCcwIcon,
  SaveIcon,
  SendIcon,
  SparklesIcon,
  Trash2Icon,
  UploadIcon,
} from 'lucide-react'

import {
  AnswerAsset,
  AnswerAssetType,
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
  createAnswerAsset,
  deleteAnswerAsset,
  deleteAnswerGuidance,
  getAnswer,
  listAnswerAssets,
  listAnswerSourceLinks,
  listAnswerGuidance,
  listAnswerRevisions,
  listAnswers,
  publishAnswer,
  restoreAnswerRevision,
  suggestAnswerGuidance,
  updateAnswerAsset,
  updateAnswer,
  uploadAnswerAsset,
} from '@/api/lightrag'
import AnswerAssetGallery from '@/components/answers/AnswerAssetGallery'
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

function AnswerAssetEditor({
  answerId,
  asset,
  disabled,
  onSaved,
  onDelete,
}: {
  answerId: string
  asset: AnswerAsset
  disabled: boolean
  onSaved: () => Promise<void>
  onDelete: () => void
}) {
  const { t } = useTranslation()
  const [caption, setCaption] = useState(asset.caption || '')
  const [altText, setAltText] = useState(asset.alt_text || '')
  const [searchText, setSearchText] = useState(asset.search_text || '')
  const [displayOrder, setDisplayOrder] = useState(String(asset.display_order || 0))
  const [isSaving, setIsSaving] = useState(false)

  useEffect(() => {
    setCaption(asset.caption || '')
    setAltText(asset.alt_text || '')
    setSearchText(asset.search_text || '')
    setDisplayOrder(String(asset.display_order || 0))
  }, [asset])

  const handleSave = async () => {
    setIsSaving(true)
    try {
      await updateAnswerAsset(answerId, asset.asset_id, {
        caption: caption.trim() || null,
        alt_text: altText.trim() || null,
        search_text: searchText.trim() || null,
        display_order: Number(displayOrder) || 0,
      })
      await onSaved()
      toast.success(t('answerCatalog.assets.saved', 'Attachment information saved.'))
    } catch (err) {
      toast.error(localizedErrorMessage(err, t))
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <div className="grid gap-3 p-3 lg:grid-cols-[minmax(150px,0.7fr)_repeat(3,minmax(160px,1fr))_90px_auto]">
      <div className="min-w-0">
        <div className="flex items-center gap-2 text-sm font-medium">
          <PaperclipIcon className="h-4 w-4 text-muted-foreground" />
          <span className="truncate">{asset.file_name || asset.asset_id}</span>
        </div>
        <div className="mt-1 text-xs text-muted-foreground">
          {t(`answerCatalog.assets.types.${asset.asset_type}`, asset.asset_type)}
        </div>
      </div>
      <Input
        value={caption}
        aria-label={t('answerCatalog.assets.caption', 'Caption')}
        placeholder={t('answerCatalog.assets.caption', 'Caption')}
        onChange={(event) => setCaption(event.target.value)}
      />
      <Input
        value={altText}
        aria-label={t('answerCatalog.assets.altText', 'Alternative text')}
        placeholder={t('answerCatalog.assets.altText', 'Alternative text')}
        onChange={(event) => setAltText(event.target.value)}
      />
      <Input
        value={searchText}
        aria-label={t('answerCatalog.assets.searchText', 'Search description')}
        placeholder={t('answerCatalog.assets.searchText', 'Search description')}
        onChange={(event) => setSearchText(event.target.value)}
      />
      <Input
        type="number"
        value={displayOrder}
        aria-label={t('answerCatalog.assets.order', 'Order')}
        onChange={(event) => setDisplayOrder(event.target.value)}
      />
      <div className="flex justify-end gap-1">
        <Button
          type="button"
          size="icon"
          variant="outline"
          tooltip={t('common.save', 'Save')}
          onClick={handleSave}
          disabled={disabled || isSaving}
        >
          {isSaving ? <Loader2Icon className="h-4 w-4 animate-spin" /> : <SaveIcon className="h-4 w-4" />}
        </Button>
        <Button
          type="button"
          size="icon"
          variant="ghost"
          tooltip={t('common.delete', 'Delete')}
          onClick={onDelete}
          disabled={disabled || isSaving}
          className="text-destructive hover:text-destructive"
        >
          <Trash2Icon className="h-4 w-4" />
        </Button>
      </div>
    </div>
  )
}

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
  const [advancedFiltersOpen, setAdvancedFiltersOpen] = useState(false)
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
          <h1 className="text-2xl font-bold">{t('answerCatalog.library.title', 'FAQ List')}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {t('answerCatalog.library.description', 'Find and manage FAQ content, publication state, search settings, and history.')}
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
            {t('answerCatalog.library.openAddAnswers', 'FAQ 생성')}
          </Button>
        </div>
      </div>

      <div className="grid gap-3 rounded-md border p-3">
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-[minmax(260px,1fr)_160px_160px_auto_auto_auto]">
          <div className="grid gap-1.5">
            <Label className="text-xs">{t('answerCatalog.library.searchLabel', '검색어')}</Label>
            <Input
              value={search}
              onChange={(event) => handleSearchChange(event.target.value)}
              placeholder={t('answerCatalog.library.search', 'Search FAQ title or content...')}
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
          <Button
            type="button"
            variant="outline"
            onClick={() => setAdvancedFiltersOpen((open) => !open)}
            className="self-end"
          >
            <FilterIcon className="h-4 w-4" />
            {t('answerCatalog.library.advancedFilters', 'More filters')}
            <ChevronDownIcon className={`h-4 w-4 transition-transform ${advancedFiltersOpen ? 'rotate-180' : ''}`} />
          </Button>
          <Button variant="outline" onClick={resetFilters} className="self-end">
            {t('answerCatalog.library.resetFilters', '조건 초기화')}
          </Button>
          <Button onClick={fetchAnswers} disabled={isLoading} className="self-end">
            {isLoading ? <Loader2Icon className="h-4 w-4 animate-spin" /> : <RefreshCwIcon className="h-4 w-4" />}
            {t('common.search', 'Search')}
          </Button>
        </div>

        {advancedFiltersOpen && (
        <div className="grid gap-3 border-t pt-3 md:grid-cols-2 xl:grid-cols-7">
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
        </div>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-auto rounded-md border">
        {answers.length === 0 ? (
          <div className="flex h-full min-h-72 flex-col items-center justify-center p-8 text-center">
            <BookOpenIcon className="mb-3 h-8 w-8 text-muted-foreground" />
            <div className="text-sm font-medium">{t('answerCatalog.library.empty', 'No FAQs yet')}</div>
            <div className="mt-1 text-sm text-muted-foreground">
              {t('answerCatalog.library.emptyDesc', 'Create the first FAQ from the FAQ creation screen.')}
            </div>
          </div>
        ) : (
          <div className="divide-y">
            {answers.map((answer) => (
              <div key={answer.answer_id} className="grid gap-3 px-4 py-3 lg:grid-cols-[minmax(0,1fr)_auto]">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="truncate text-base font-semibold">{answer.title}</h2>
                    <Badge variant={statusVariant(answer.status)}>
                      {t(`answerCatalog.status.${answer.status}`, answer.status)}
                    </Badge>
                  </div>
                  <p className="mt-1 line-clamp-1 whitespace-pre-wrap text-sm text-muted-foreground">
                    {answer.body}
                  </p>
                  <div className="mt-2 text-xs text-muted-foreground">
                    {t('answerCatalog.library.lastUpdated', 'Last updated')}: {' '}
                    {answer.update_time ? new Date(answer.update_time).toLocaleString() : '-'}
                  </div>
                </div>
                <div className="flex items-start gap-2">
                  <Button size="sm" variant="outline" onClick={() => setSelectedAnswer(answer)}>
                    <Edit3Icon className="h-4 w-4" />
                    {t('answerCatalog.library.openDetail', 'Details')}
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
  const [section, setSection] = useState<'content' | 'assets' | 'guidance' | 'history'>('content')
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
  const [assets, setAssets] = useState<AnswerAsset[]>([])
  const [assetFile, setAssetFile] = useState<File | null>(null)
  const [assetCaption, setAssetCaption] = useState('')
  const [assetAltText, setAssetAltText] = useState('')
  const [assetSearchText, setAssetSearchText] = useState('')
  const [externalAssetUrl, setExternalAssetUrl] = useState('')
  const [externalAssetType, setExternalAssetType] = useState<AnswerAssetType>('image')
  const [guidanceType, setGuidanceType] = useState<AnswerGuidanceType>('keyword')
  const [guidanceText, setGuidanceText] = useState('')
  const [guidanceWeight, setGuidanceWeight] = useState('1')
  const [isSaving, setIsSaving] = useState(false)
  const [isLoadingDetails, setIsLoadingDetails] = useState(false)
  const [isSuggesting, setIsSuggesting] = useState(false)
  const [suggestions, setSuggestions] = useState<
    Awaited<ReturnType<typeof suggestAnswerGuidance>>['suggestions']
  >([])

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
      const [nextGuidance, nextRevisions, nextSourceLinks, nextAssets] = await Promise.all([
        listAnswerGuidance(answer.answer_id),
        listAnswerRevisions(answer.answer_id),
        listAnswerSourceLinks(answer.answer_id),
        listAnswerAssets(answer.answer_id),
      ])
      setGuidance(nextGuidance)
      setRevisions(nextRevisions)
      setSourceLinks(nextSourceLinks)
      setAssets(nextAssets)
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
    setSuggestions([])
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

  const handleSuggestGuidance = async () => {
    if (!answer) return
    setIsSuggesting(true)
    try {
      const result = await suggestAnswerGuidance(answer.answer_id, {
        max_suggestions: 10,
        use_llm: true,
      })
      setSuggestions(result.suggestions)
      toast.success(
        t(
          'answerCatalog.library.guidanceSuggestionsReady',
          'FAQ search suggestions are ready for review.'
        )
      )
    } catch (err) {
      toast.error(localizedErrorMessage(err, t))
    } finally {
      setIsSuggesting(false)
    }
  }

  const applyGuidanceSuggestions = async (indexes: number[]) => {
    if (!answer || indexes.length === 0) return
    setIsSaving(true)
    try {
      await Promise.all(
        indexes.map((index) => {
          const suggestion = suggestions[index]
          return addAnswerGuidance(answer.answer_id, {
            guidance_type: suggestion.guidance_type || 'keyword',
            text: suggestion.text,
            weight: suggestion.weight || 1,
            metadata: {
              ...suggestion.metadata,
              created_from: 'faq_detail_llm_suggestion',
              source: suggestion.source || 'llm',
            },
          })
        })
      )
      setSuggestions((current) => current.filter((_, index) => !indexes.includes(index)))
      toast.success(
        t('answerCatalog.library.guidanceSuggestionsApplied', 'Selected search suggestions were applied.')
      )
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

  const refreshAfterAssetChange = async () => {
    if (!answer) return
    const [updatedAnswer, nextAssets] = await Promise.all([
      getAnswer(answer.answer_id),
      listAnswerAssets(answer.answer_id),
    ])
    setAssets(nextAssets)
    onChanged(updatedAnswer)
    reloadDetails()
  }

  const handleUploadAsset = async () => {
    if (!answer || !assetFile) {
      toast.error(t('answerCatalog.assets.fileRequired', 'Select a file to upload.'))
      return
    }
    setIsSaving(true)
    try {
      await uploadAnswerAsset(answer.answer_id, assetFile, {
        caption: assetCaption.trim() || undefined,
        alt_text: assetAltText.trim() || undefined,
        search_text: assetSearchText.trim() || undefined,
        display_order: assets.length,
      })
      setAssetFile(null)
      setAssetCaption('')
      setAssetAltText('')
      setAssetSearchText('')
      await refreshAfterAssetChange()
      toast.success(t('answerCatalog.assets.uploaded', 'Attachment uploaded.'))
    } catch (err) {
      toast.error(localizedErrorMessage(err, t))
    } finally {
      setIsSaving(false)
    }
  }

  const handleRegisterExternalAsset = async () => {
    if (!answer || !externalAssetUrl.trim()) {
      toast.error(t('answerCatalog.assets.urlRequired', 'Enter an attachment URL.'))
      return
    }
    setIsSaving(true)
    try {
      await createAnswerAsset(answer.answer_id, {
        asset_type: externalAssetType,
        external_url: externalAssetUrl.trim(),
        caption: assetCaption.trim() || null,
        alt_text: assetAltText.trim() || null,
        search_text: assetSearchText.trim() || null,
        display_order: assets.length,
      })
      setExternalAssetUrl('')
      setAssetCaption('')
      setAssetAltText('')
      setAssetSearchText('')
      await refreshAfterAssetChange()
      toast.success(t('answerCatalog.assets.registered', 'External attachment registered.'))
    } catch (err) {
      toast.error(localizedErrorMessage(err, t))
    } finally {
      setIsSaving(false)
    }
  }

  const handleDeleteAsset = async (asset: AnswerAsset) => {
    if (!answer) return
    setIsSaving(true)
    try {
      await deleteAnswerAsset(answer.answer_id, asset.asset_id)
      await refreshAfterAssetChange()
      toast.success(t('answerCatalog.assets.removed', 'Attachment removed.'))
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
          <DialogTitle>{t('answerCatalog.library.detailTitle', 'FAQ Details')}</DialogTitle>
          <DialogDescription>
            <span className="font-mono">{answer.answer_id}</span>
            <span className="ml-2">v{answer.version}</span>
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-wrap gap-2">
          {(['content', 'assets', 'guidance', 'history'] as const).map((item) => (
            <Button
              key={item}
              type="button"
              size="sm"
              variant={section === item ? 'default' : 'outline'}
              onClick={() => setSection(item)}
            >
              {item === 'content' && t('answerCatalog.library.contentSection', 'Content')}
              {item === 'assets' && (
                <>
                  <PaperclipIcon className="h-4 w-4" />
                  {t('answerCatalog.assets.section', 'Attachments')}
                  {assets.length > 0 && <Badge variant="outline">{assets.length}</Badge>}
                </>
              )}
              {item === 'guidance' && t('answerCatalog.library.guidanceSection', 'Search settings')}
              {item === 'history' && t('answerCatalog.library.historySection', 'Source and history')}
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

        {section === 'assets' && (
          <div className="grid gap-4 py-2">
            <div>
              <h3 className="font-medium">{t('answerCatalog.assets.title', 'FAQ attachments')}</h3>
              <p className="mt-1 text-sm leading-6 text-muted-foreground">
                {t(
                  'answerCatalog.assets.description',
                  'Add images, video, audio, tables, or files. Captions and search descriptions help users find this FAQ even when the media itself has no searchable text.'
                )}
              </p>
            </div>

            <AnswerAssetGallery assets={assets} />

            {assets.length > 0 && (
              <div className="divide-y rounded-md border">
                {assets.map((asset) => (
                  <AnswerAssetEditor
                    key={asset.asset_id}
                    answerId={answer.answer_id}
                    asset={asset}
                    disabled={isSaving}
                    onSaved={refreshAfterAssetChange}
                    onDelete={() => handleDeleteAsset(asset)}
                  />
                ))}
              </div>
            )}

            <div className="grid gap-4 rounded-md border p-4 lg:grid-cols-2">
              <div className="grid content-start gap-3">
                <div className="flex items-center gap-2 font-medium">
                  <UploadIcon className="h-4 w-4" />
                  {t('answerCatalog.assets.uploadTitle', 'Upload a file')}
                </div>
                <Input
                  type="file"
                  accept=".png,.jpg,.jpeg,.gif,.webp,.mp4,.webm,.mov,.mp3,.wav,.ogg,.pdf,.csv,.xlsx,.xls,.docx,.pptx,.txt,.md"
                  onChange={(event) => setAssetFile(event.target.files?.[0] || null)}
                />
                <p className="text-xs leading-5 text-muted-foreground">
                  {t(
                    'answerCatalog.assets.uploadHelp',
                    'Up to 100MB. Images, video, audio, spreadsheets, documents, and text files are supported.'
                  )}
                </p>
                <Button type="button" onClick={handleUploadAsset} disabled={isSaving || !assetFile}>
                  <UploadIcon className="h-4 w-4" />
                  {t('answerCatalog.assets.upload', 'Upload attachment')}
                </Button>
              </div>

              <div className="grid content-start gap-3">
                <div className="flex items-center gap-2 font-medium">
                  <LinkIcon className="h-4 w-4" />
                  {t('answerCatalog.assets.externalTitle', 'Register an external URL')}
                </div>
                <div className="grid gap-3 sm:grid-cols-[150px_1fr]">
                  <Select
                    value={externalAssetType}
                    onValueChange={(value) => setExternalAssetType(value as AnswerAssetType)}
                  >
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {(['image', 'video', 'audio', 'table', 'file'] as const).map((type) => (
                        <SelectItem key={type} value={type}>
                          {t(`answerCatalog.assets.types.${type}`, type)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Input
                    type="url"
                    value={externalAssetUrl}
                    placeholder="https://..."
                    onChange={(event) => setExternalAssetUrl(event.target.value)}
                  />
                </div>
                <Button
                  type="button"
                  variant="outline"
                  onClick={handleRegisterExternalAsset}
                  disabled={isSaving || !externalAssetUrl.trim()}
                >
                  <LinkIcon className="h-4 w-4" />
                  {t('answerCatalog.assets.register', 'Register URL')}
                </Button>
              </div>

              <div className="grid gap-3 border-t pt-4 lg:col-span-2 lg:grid-cols-3">
                <div className="grid gap-1.5">
                  <Label>{t('answerCatalog.assets.caption', 'Caption')}</Label>
                  <Input value={assetCaption} onChange={(event) => setAssetCaption(event.target.value)} />
                </div>
                <div className="grid gap-1.5">
                  <Label>{t('answerCatalog.assets.altText', 'Alternative text')}</Label>
                  <Input value={assetAltText} onChange={(event) => setAssetAltText(event.target.value)} />
                </div>
                <div className="grid gap-1.5">
                  <Label>{t('answerCatalog.assets.searchText', 'Search description')}</Label>
                  <Input value={assetSearchText} onChange={(event) => setAssetSearchText(event.target.value)} />
                </div>
              </div>
            </div>
          </div>
        )}

        {section === 'guidance' && (
          <div className="grid gap-4 py-2">
            <div className="rounded-md border bg-muted/20 p-3">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2 font-medium">
                    <SparklesIcon className="h-4 w-4 text-emerald-600" />
                    {t('answerCatalog.library.llmGuidanceTitle', 'Prepare search settings with AI')}
                  </div>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {t(
                      'answerCatalog.library.llmGuidanceDescription',
                      'AI proposes representative questions, keywords, synonyms, and exclusion terms. Review them before applying.'
                    )}
                  </p>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  onClick={handleSuggestGuidance}
                  disabled={isSuggesting || isSaving}
                >
                  {isSuggesting ? <Loader2Icon className="h-4 w-4 animate-spin" /> : <SparklesIcon className="h-4 w-4" />}
                  {t('answerCatalog.library.suggestGuidance', 'Generate suggestions')}
                </Button>
              </div>
              {suggestions.length > 0 && (
                <div className="mt-3 border-t pt-3">
                  <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                    <div className="text-sm font-medium">
                      {t('answerCatalog.library.suggestionCount', '{{count}} suggestions', { count: suggestions.length })}
                    </div>
                    <Button
                      type="button"
                      size="sm"
                      onClick={() => applyGuidanceSuggestions(suggestions.map((_, index) => index))}
                      disabled={isSaving}
                    >
                      {t('answerCatalog.library.applyAllSuggestions', 'Apply all')}
                    </Button>
                  </div>
                  <div className="divide-y rounded-md border bg-background">
                    {suggestions.map((suggestion, index) => (
                      <div
                        key={`${suggestion.guidance_type || 'keyword'}-${suggestion.text}-${index}`}
                        className="grid gap-2 p-3 sm:grid-cols-[120px_minmax(0,1fr)_auto]"
                      >
                        <Badge variant="outline">
                          {t(
                            `answerCatalog.guidance.${suggestion.guidance_type || 'keyword'}`,
                            suggestion.guidance_type || 'keyword'
                          )}
                        </Badge>
                        <div className="text-sm">{suggestion.text}</div>
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={() => applyGuidanceSuggestions([index])}
                          disabled={isSaving}
                        >
                          {t('answerCatalog.library.applySuggestion', 'Apply')}
                        </Button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
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

        {section === 'history' && (
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

        {section === 'history' && (
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

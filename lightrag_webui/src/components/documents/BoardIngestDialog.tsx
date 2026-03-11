import { useState, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import Button from '@/components/ui/Button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/Dialog'
import Input from '@/components/ui/Input'
import Textarea from '@/components/ui/Textarea'
import Checkbox from '@/components/ui/Checkbox'
import { Label } from '@/components/ui/Label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/Select'
import TaskProgressPanel from './TaskProgressPanel'
import {
  exploreBoard,
  ingestBoard,
  BoardFieldMapping,
  BoardExploreResponse,
} from '@/api/lightrag'
import { toast } from 'sonner'
import { errorMessage } from '@/lib/utils'
import {
  LayoutList,
  Loader2,
  Plus,
  Trash2,
  CheckCircle2,
  AlertCircle,
  Info,
  MessageSquareText,
  ChevronUp,
  ChevronDown,
} from 'lucide-react'

interface BoardIngestDialogProps {
  onDocumentsUploaded?: () => Promise<void>
}

const EMPTY_MAPPING: BoardFieldMapping = {
  items_path: '',
  title_field: '',
  body_field: '',
  id_field: '',
  date_field: '',
  author_field: '',
  attachments_field: '',
  attachment_url_field: '',
  attachment_name_field: '',
  detail_url_template: '',
  pagination_type: 'page_param',
  page_param: '',
  page_size_param: '',
  total_field: '',
  cursor_field: '',
}

export default function BoardIngestDialog({ onDocumentsUploaded }: BoardIngestDialogProps) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)

  // Step state
  const [step, setStep] = useState<1 | 2 | 3>(1)
  const [isManualMode, setIsManualMode] = useState(false)

  // Step 1: API connection
  const [apiUrl, setApiUrl] = useState('')
  const [method, setMethod] = useState('GET')
  const [headers, setHeaders] = useState<Array<{ key: string; value: string }>>([])
  const [params, setParams] = useState<Array<{ key: string; value: string }>>([])
  const [baseUrl, setBaseUrl] = useState('')

  // Explore result
  const [exploreResult, setExploreResult] = useState<BoardExploreResponse | null>(null)
  const [isExploring, setIsExploring] = useState(false)

  // Step 2: Field mapping
  const [fieldMapping, setFieldMapping] = useState<BoardFieldMapping>({ ...EMPTY_MAPPING })

  // Step 3: Options
  const [maxPages, setMaxPages] = useState(50)
  const [pageSize, setPageSize] = useState(20)
  const [processImages, setProcessImages] = useState(true)
  const [processTables, setProcessTables] = useState(true)
  const [processDocuments, setProcessDocuments] = useState(true)
  const [parser, setParser] = useState<'pymupdf' | 'docling'>('docling')
  const [skipDuplicates, setSkipDuplicates] = useState(true)
  const [updateExisting, setUpdateExisting] = useState(false)
  const [fetchDetail, setFetchDetail] = useState(false)

  // Custom prompts
  const [showCustomPrompts, setShowCustomPrompts] = useState(false)
  const [documentPrompt, setDocumentPrompt] = useState('')
  const [imagePrompt, setImagePrompt] = useState('')
  const [tablePrompt, setTablePrompt] = useState('')

  // Task state
  const [activeTaskId, setActiveTaskId] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)

  const resetState = useCallback(() => {
    setStep(1)
    setIsManualMode(false)
    setApiUrl('')
    setMethod('GET')
    setHeaders([])
    setParams([])
    setBaseUrl('')
    setExploreResult(null)
    setIsExploring(false)
    setFieldMapping({ ...EMPTY_MAPPING })
    setMaxPages(50)
    setPageSize(20)
    setProcessImages(true)
    setProcessTables(true)
    setProcessDocuments(true)
    setParser('docling')
    setSkipDuplicates(true)
    setUpdateExisting(false)
    setFetchDetail(false)
    setShowCustomPrompts(false)
    setDocumentPrompt('')
    setImagePrompt('')
    setTablePrompt('')
    setActiveTaskId(null)
    setIsSubmitting(false)
  }, [])

  const buildHeadersObj = useCallback(() => {
    const obj: Record<string, string> = {}
    for (const h of headers) {
      if (h.key.trim()) obj[h.key.trim()] = h.value
    }
    return Object.keys(obj).length > 0 ? obj : undefined
  }, [headers])

  const buildParamsObj = useCallback(() => {
    const obj: Record<string, string> = {}
    for (const p of params) {
      if (p.key.trim()) obj[p.key.trim()] = p.value
    }
    return Object.keys(obj).length > 0 ? obj : undefined
  }, [params])

  const handleExplore = useCallback(async () => {
    if (!apiUrl.trim()) return
    setIsExploring(true)
    setExploreResult(null)
    try {
      const result = await exploreBoard({
        api_url: apiUrl.trim(),
        method,
        headers: buildHeadersObj(),
        params: buildParamsObj(),
        base_url: baseUrl.trim() || undefined,
        user_mapping: isManualMode ? fieldMapping : undefined,
      })
      setExploreResult(result)
      if (result.success && result.detected_mapping) {
        setFieldMapping(result.detected_mapping)
      }
      if (result.success) {
        toast.success(
          isManualMode
            ? t('documentPanel.boardIngest.validationSuccess')
            : t('documentPanel.boardIngest.detectedItems', { count: result.detected_items_count })
        )
      } else {
        toast.error(result.error || t('documentPanel.boardIngest.exploreError'))
      }
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setIsExploring(false)
    }
  }, [apiUrl, method, buildHeadersObj, buildParamsObj, baseUrl, isManualMode, fieldMapping, t])

  const handleStartIngestion = useCallback(async () => {
    setIsSubmitting(true)
    try {
      const result = await ingestBoard({
        api_url: apiUrl.trim(),
        method,
        headers: buildHeadersObj(),
        params: buildParamsObj(),
        field_mapping: fieldMapping,
        max_pages: maxPages,
        page_size: pageSize,
        process_images: processImages,
        process_tables: processTables,
        process_documents: processDocuments,
        parser: processDocuments ? parser : undefined,
        skip_duplicates: skipDuplicates,
        update_existing: updateExisting,
        fetch_detail: fetchDetail,
        base_url: baseUrl.trim() || undefined,
        document_prompt: documentPrompt || undefined,
        image_prompt: imagePrompt || undefined,
        table_prompt: tablePrompt || undefined,
      })
      setActiveTaskId(result.task_id)
      toast.success(result.message)
    } catch (err) {
      toast.error(errorMessage(err))
      setIsSubmitting(false)
    }
  }, [apiUrl, method, buildHeadersObj, buildParamsObj, fieldMapping, maxPages, pageSize,
      processImages, processTables, processDocuments, parser, skipDuplicates, updateExisting,
      fetchDetail, baseUrl, documentPrompt, imagePrompt, tablePrompt])

  const handleTaskComplete = useCallback(() => {
    onDocumentsUploaded?.()
  }, [onDocumentsUploaded])

  const updateMapping = useCallback((key: keyof BoardFieldMapping, value: string) => {
    setFieldMapping(prev => ({ ...prev, [key]: value || undefined }))
  }, [])

  const canProceedFromStep1 = exploreResult?.success === true
  const hasTask = activeTaskId !== null

  // Get available keys from sample item for dropdowns
  const availableKeys = exploreResult?.sample_item?._raw_keys as string[] || []

  return (
    <Dialog
      open={open}
      onOpenChange={(newOpen) => {
        if (hasTask) return
        if (!newOpen) resetState()
        setOpen(newOpen)
      }}
    >
      <DialogTrigger asChild>
        <Button variant="outline" side="bottom" tooltip={t('documentPanel.boardIngest.tooltip')} size="sm">
          <LayoutList className="h-4 w-4" /> {t('documentPanel.boardIngest.button')}
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-5xl max-h-[85vh] overflow-y-auto" onCloseAutoFocus={(e) => e.preventDefault()}>
        <DialogHeader>
          <DialogTitle>{t('documentPanel.boardIngest.title')}</DialogTitle>
          <DialogDescription>
            {step === 1 ? t('documentPanel.boardIngest.step1Title')
              : step === 2 ? t('documentPanel.boardIngest.step2Title')
              : t('documentPanel.boardIngest.step3Title')}
          </DialogDescription>
        </DialogHeader>

        {hasTask ? (
          <div className="space-y-3">
            <div className="border rounded-md p-3">
              <TaskProgressPanel
                taskId={activeTaskId}
                onComplete={handleTaskComplete}
              />
            </div>
            <Button
              variant="outline"
              className="w-full"
              onClick={() => {
                resetState()
                setOpen(false)
              }}
            >
              {t('documentPanel.boardIngest.close')}
            </Button>
          </div>
        ) : (
          <div className="space-y-4">
            {/* Step indicator */}
            <div className="flex gap-2 mb-2">
              {[1, 2, 3].map(s => (
                <div
                  key={s}
                  className={`h-1.5 flex-1 rounded-full ${
                    s <= step ? 'bg-primary' : 'bg-muted'
                  }`}
                />
              ))}
            </div>

            {/* ===== Step 1: API Connection ===== */}
            {step === 1 && (
              <div className="space-y-3">
                {/* Mode toggle */}
                <div className="flex gap-2">
                  <Button
                    variant={!isManualMode ? 'default' : 'outline'}
                    size="sm"
                    onClick={() => { setIsManualMode(false); setExploreResult(null) }}
                    className="flex-1"
                  >
                    {t('documentPanel.boardIngest.autoDetectMode')}
                  </Button>
                  <Button
                    variant={isManualMode ? 'default' : 'outline'}
                    size="sm"
                    onClick={() => { setIsManualMode(true); setExploreResult(null) }}
                    className="flex-1"
                  >
                    {t('documentPanel.boardIngest.manualMode')}
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  {isManualMode
                    ? t('documentPanel.boardIngest.manualModeDesc')
                    : t('documentPanel.boardIngest.autoDetectModeDesc')
                  }
                </p>

                {/* API URL */}
                <div>
                  <Label className="text-sm font-medium">{t('documentPanel.boardIngest.apiUrl')}</Label>
                  <Input
                    placeholder={t('documentPanel.boardIngest.apiUrlPlaceholder')}
                    value={apiUrl}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) => setApiUrl(e.target.value)}
                  />
                </div>

                {/* HTTP Method */}
                <div>
                  <Label className="text-sm font-medium">{t('documentPanel.boardIngest.method')}</Label>
                  <Select value={method} onValueChange={setMethod}>
                    <SelectTrigger className="h-9">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="GET">GET</SelectItem>
                      <SelectItem value="POST">POST</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {/* Headers */}
                <KeyValueSection
                  label={t('documentPanel.boardIngest.headers')}
                  addLabel={t('documentPanel.boardIngest.addHeader')}
                  items={headers}
                  onChange={setHeaders}
                />

                {/* Params */}
                <KeyValueSection
                  label={t('documentPanel.boardIngest.params')}
                  addLabel={t('documentPanel.boardIngest.addParam')}
                  items={params}
                  onChange={setParams}
                />

                {/* Base URL */}
                <div>
                  <div className="flex items-center gap-1">
                    <Label className="text-sm font-medium">{t('documentPanel.boardIngest.baseUrl')}</Label>
                    <span className="text-xs text-muted-foreground">({t('documentPanel.boardIngest.optional')})</span>
                    <Info className="h-3 w-3 text-muted-foreground" title={t('documentPanel.boardIngest.baseUrlTooltip')} />
                  </div>
                  <Input
                    placeholder={t('documentPanel.boardIngest.baseUrlPlaceholder')}
                    value={baseUrl}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) => setBaseUrl(e.target.value)}
                  />
                </div>

                {/* Manual mode: field mapping inputs */}
                {isManualMode && (
                  <div className="border rounded-md p-3 space-y-2">
                    <Label className="text-sm font-medium">{t('documentPanel.boardIngest.fieldMapping')}</Label>
                    <MappingInputs mapping={fieldMapping} onChange={updateMapping} />
                  </div>
                )}

                {/* Explore/Validate button */}
                <Button
                  className="w-full"
                  onClick={handleExplore}
                  disabled={!apiUrl.trim() || isExploring}
                >
                  {isExploring ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin mr-2" />
                      {isManualMode ? t('documentPanel.boardIngest.validating') : t('documentPanel.boardIngest.exploring')}
                    </>
                  ) : (
                    isManualMode ? t('documentPanel.boardIngest.validate') : t('documentPanel.boardIngest.explore')
                  )}
                </Button>

                {/* Explore result */}
                {exploreResult && (
                  <ExploreResultPreview result={exploreResult} />
                )}

                {/* Next button */}
                {canProceedFromStep1 && (
                  <Button
                    className="w-full"
                    onClick={() => setStep(isManualMode ? 3 : 2)}
                  >
                    {t('documentPanel.boardIngest.next')}
                  </Button>
                )}
              </div>
            )}

            {/* ===== Step 2: Field Mapping (auto-detect only) ===== */}
            {step === 2 && (
              <div className="space-y-3">
                <div className="border rounded-md p-3 space-y-3">
                  <Label className="text-sm font-medium">{t('documentPanel.boardIngest.fieldMapping')}</Label>

                  {/* Items path */}
                  <FieldRow label={t('documentPanel.boardIngest.itemsPath')} required>
                    <Input
                      value={fieldMapping.items_path}
                      onChange={(e: React.ChangeEvent<HTMLInputElement>) => updateMapping('items_path', e.target.value)}
                      className="h-8 text-sm"
                    />
                  </FieldRow>

                  {/* Title/Body fields with dropdowns */}
                  <FieldRow label={t('documentPanel.boardIngest.titleField')} required>
                    <FieldSelect
                      value={fieldMapping.title_field}
                      keys={availableKeys}
                      onChange={(v) => updateMapping('title_field', v)}
                    />
                  </FieldRow>

                  <FieldRow label={t('documentPanel.boardIngest.bodyField')} required>
                    <FieldSelect
                      value={fieldMapping.body_field}
                      keys={availableKeys}
                      onChange={(v) => updateMapping('body_field', v)}
                    />
                  </FieldRow>

                  <FieldRow label={t('documentPanel.boardIngest.idField')}>
                    <FieldSelect
                      value={fieldMapping.id_field || ''}
                      keys={availableKeys}
                      onChange={(v) => updateMapping('id_field', v)}
                    />
                  </FieldRow>

                  <FieldRow label={t('documentPanel.boardIngest.dateField')}>
                    <FieldSelect
                      value={fieldMapping.date_field || ''}
                      keys={availableKeys}
                      onChange={(v) => updateMapping('date_field', v)}
                    />
                  </FieldRow>

                  <FieldRow label={t('documentPanel.boardIngest.authorField')}>
                    <FieldSelect
                      value={fieldMapping.author_field || ''}
                      keys={availableKeys}
                      onChange={(v) => updateMapping('author_field', v)}
                    />
                  </FieldRow>

                  <FieldRow label={t('documentPanel.boardIngest.attachmentsField')}>
                    <FieldSelect
                      value={fieldMapping.attachments_field || ''}
                      keys={availableKeys}
                      onChange={(v) => updateMapping('attachments_field', v)}
                    />
                  </FieldRow>

                  {fieldMapping.attachments_field && (
                    <>
                      <FieldRow label={t('documentPanel.boardIngest.attachmentUrlField')}>
                        <Input
                          value={fieldMapping.attachment_url_field || ''}
                          onChange={(e: React.ChangeEvent<HTMLInputElement>) => updateMapping('attachment_url_field', e.target.value)}
                          placeholder="filePath, url, download_url ..."
                          className="h-8 text-sm"
                        />
                      </FieldRow>
                      <FieldRow label={t('documentPanel.boardIngest.attachmentNameField')}>
                        <Input
                          value={fieldMapping.attachment_name_field || ''}
                          onChange={(e: React.ChangeEvent<HTMLInputElement>) => updateMapping('attachment_name_field', e.target.value)}
                          placeholder="attachFileNm, fileName, name ..."
                          className="h-8 text-sm"
                        />
                      </FieldRow>
                    </>
                  )}

                  <FieldRow label={t('documentPanel.boardIngest.detailUrlTemplate')}>
                    <Input
                      value={fieldMapping.detail_url_template || ''}
                      onChange={(e: React.ChangeEvent<HTMLInputElement>) => updateMapping('detail_url_template', e.target.value)}
                      placeholder="/api/posts/{id}"
                      className="h-8 text-sm"
                      title={t('documentPanel.boardIngest.detailUrlTemplateTooltip')}
                    />
                  </FieldRow>
                </div>

                {/* Pagination */}
                <div className="border rounded-md p-3 space-y-3">
                  <Label className="text-sm font-medium">{t('documentPanel.boardIngest.pagination')}</Label>

                  <FieldRow label={t('documentPanel.boardIngest.paginationType')}>
                    <Select
                      value={fieldMapping.pagination_type || 'none'}
                      onValueChange={(v) => updateMapping('pagination_type', v)}
                    >
                      <SelectTrigger className="h-8 text-sm">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="page_param">Page Parameter</SelectItem>
                        <SelectItem value="offset_limit">Offset/Limit</SelectItem>
                        <SelectItem value="cursor">Cursor</SelectItem>
                        <SelectItem value="none">None</SelectItem>
                      </SelectContent>
                    </Select>
                  </FieldRow>

                  {(fieldMapping.pagination_type === 'page_param' || fieldMapping.pagination_type === 'offset_limit') && (
                    <>
                      <FieldRow label={t('documentPanel.boardIngest.pageParam')}>
                        <Input
                          value={fieldMapping.page_param || ''}
                          onChange={(e: React.ChangeEvent<HTMLInputElement>) => updateMapping('page_param', e.target.value)}
                          placeholder="page"
                          className="h-8 text-sm"
                        />
                      </FieldRow>
                      <FieldRow label={t('documentPanel.boardIngest.pageSizeParam')}>
                        <Input
                          value={fieldMapping.page_size_param || ''}
                          onChange={(e: React.ChangeEvent<HTMLInputElement>) => updateMapping('page_size_param', e.target.value)}
                          placeholder="size"
                          className="h-8 text-sm"
                        />
                      </FieldRow>
                    </>
                  )}

                  <FieldRow label={t('documentPanel.boardIngest.totalField')}>
                    <Input
                      value={fieldMapping.total_field || ''}
                      onChange={(e: React.ChangeEvent<HTMLInputElement>) => updateMapping('total_field', e.target.value)}
                      placeholder="data.totalCount"
                      className="h-8 text-sm"
                    />
                  </FieldRow>
                </div>

                {/* Sample preview */}
                {exploreResult?.sample_item && (
                  <SamplePreview item={exploreResult.sample_item} mapping={fieldMapping} />
                )}

                {/* Navigation */}
                <div className="flex gap-2">
                  <Button variant="outline" className="flex-1" onClick={() => setStep(1)}>
                    {t('documentPanel.boardIngest.back')}
                  </Button>
                  <Button
                    className="flex-1"
                    onClick={() => setStep(3)}
                    disabled={!fieldMapping.title_field || !fieldMapping.body_field}
                  >
                    {t('documentPanel.boardIngest.next')}
                  </Button>
                </div>
              </div>
            )}

            {/* ===== Step 3: Options & Run ===== */}
            {step === 3 && (
              <div className="space-y-3">
                {fieldMapping.pagination_type && fieldMapping.pagination_type !== 'none' && (
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <Label className="text-sm">{t('documentPanel.boardIngest.maxPages')}</Label>
                      <Input
                        type="number"
                        value={maxPages}
                        onChange={(e: React.ChangeEvent<HTMLInputElement>) => setMaxPages(Number(e.target.value) || 50)}
                        min={1}
                        max={500}
                        className="h-8"
                      />
                    </div>
                    <div>
                      <Label className="text-sm">{t('documentPanel.boardIngest.pageSize')}</Label>
                      <Input
                        type="number"
                        value={pageSize}
                        onChange={(e: React.ChangeEvent<HTMLInputElement>) => setPageSize(Number(e.target.value) || 20)}
                        min={1}
                        max={100}
                        className="h-8"
                      />
                    </div>
                  </div>
                )}

                <div className="space-y-2">
                  <div className="flex flex-wrap gap-4 text-sm">
                    <div className="flex items-center gap-2">
                      <Checkbox
                        id="board-process-images"
                        checked={processImages}
                        onCheckedChange={(v) => setProcessImages(v === true)}
                      />
                      <Label htmlFor="board-process-images">{t('documentPanel.boardIngest.processImages')}</Label>
                    </div>
                    <div className="flex items-center gap-2">
                      <Checkbox
                        id="board-process-tables"
                        checked={processTables}
                        onCheckedChange={(v) => setProcessTables(v === true)}
                      />
                      <Label htmlFor="board-process-tables">{t('documentPanel.boardIngest.processTables')}</Label>
                    </div>
                    <div className="flex items-center gap-2">
                      <Checkbox
                        id="board-skip-duplicates"
                        checked={skipDuplicates}
                        onCheckedChange={(v) => {
                          const checked = v === true
                          setSkipDuplicates(checked)
                          if (checked) setUpdateExisting(false)
                        }}
                      />
                      <Label htmlFor="board-skip-duplicates">{t('documentPanel.boardIngest.skipDuplicates')}</Label>
                    </div>
                    <div className="flex items-center gap-2">
                      <Checkbox
                        id="board-update-existing"
                        checked={updateExisting}
                        onCheckedChange={(v) => {
                          const checked = v === true
                          setUpdateExisting(checked)
                          if (checked) setSkipDuplicates(false)
                        }}
                      />
                      <Label htmlFor="board-update-existing">{t('documentPanel.boardIngest.updateExisting')}</Label>
                      <Info className="h-3 w-3 text-muted-foreground" title={t('documentPanel.boardIngest.updateExistingTooltip')} />
                    </div>
                  </div>
                  <div className="flex items-center gap-2 text-sm">
                    <Checkbox
                      id="board-fetch-detail"
                      checked={fetchDetail}
                      onCheckedChange={(v) => setFetchDetail(v === true)}
                    />
                    <Label htmlFor="board-fetch-detail">{t('documentPanel.boardIngest.fetchDetail')}</Label>
                    <Info className="h-3 w-3 text-muted-foreground" title={t('documentPanel.boardIngest.fetchDetailTooltip')} />
                  </div>
                  <div className="flex items-center gap-2 text-sm">
                    <Checkbox
                      id="board-process-documents"
                      checked={processDocuments}
                      onCheckedChange={(v) => setProcessDocuments(v === true)}
                    />
                    <Label htmlFor="board-process-documents">{t('documentPanel.boardIngest.processDocuments')}</Label>
                  </div>
                  {processDocuments && (
                    <div className="flex items-center gap-2 text-sm ml-6">
                      <Label className="text-xs text-muted-foreground">{t('documentPanel.boardIngest.parserSelection')}:</Label>
                      <div className="flex gap-1">
                        <Button
                          variant={parser === 'pymupdf' ? 'default' : 'outline'}
                          size="sm"
                          className="h-6 text-xs px-2"
                          onClick={() => setParser('docling')}
                        >
                          PyMuPDF
                          <span className="ml-1 text-[10px] opacity-70">({t('documentPanel.multimodalUpload.pymupdfDesc')})</span>
                        </Button>
                        <Button
                          variant={parser === 'docling' ? 'default' : 'outline'}
                          size="sm"
                          className="h-6 text-xs px-2"
                          onClick={() => setParser('docling')}
                        >
                          Docling
                          <span className="ml-1 text-[10px] opacity-70">({t('documentPanel.multimodalUpload.doclingDesc')})</span>
                        </Button>
                      </div>
                    </div>
                  )}
                </div>

                {/* Custom Prompts */}
                <div className="space-y-2">
                  <button
                    type="button"
                    className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors w-full"
                    onClick={() => setShowCustomPrompts(!showCustomPrompts)}
                  >
                    <MessageSquareText className="h-4 w-4" />
                    <span>{t('documentPanel.multimodalUpload.customPrompts.title')}</span>
                    {showCustomPrompts ? <ChevronUp className="h-4 w-4 ml-auto" /> : <ChevronDown className="h-4 w-4 ml-auto" />}
                  </button>
                  {showCustomPrompts && (
                    <div className="space-y-3 pt-1">
                      <p className="text-xs text-muted-foreground">
                        {t('documentPanel.multimodalUpload.customPrompts.description')}
                      </p>
                      <div>
                        <Label className="text-xs text-muted-foreground">{t('documentPanel.multimodalUpload.customPrompts.documentPrompt')}</Label>
                        <Textarea
                          rows={2}
                          className="mt-1 min-h-[60px]"
                          placeholder={t('documentPanel.multimodalUpload.customPrompts.documentPromptPlaceholder')}
                          value={documentPrompt}
                          onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setDocumentPrompt(e.target.value)}
                        />
                      </div>
                      <div>
                        <Label className="text-xs text-muted-foreground">{t('documentPanel.multimodalUpload.customPrompts.imagePrompt')}</Label>
                        <Textarea
                          rows={2}
                          className="mt-1 min-h-[60px]"
                          placeholder={t('documentPanel.multimodalUpload.customPrompts.imagePromptPlaceholder')}
                          value={imagePrompt}
                          onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setImagePrompt(e.target.value)}
                        />
                      </div>
                      <div>
                        <Label className="text-xs text-muted-foreground">{t('documentPanel.multimodalUpload.customPrompts.tablePrompt')}</Label>
                        <Textarea
                          rows={2}
                          className="mt-1 min-h-[60px]"
                          placeholder={t('documentPanel.multimodalUpload.customPrompts.tablePromptPlaceholder')}
                          value={tablePrompt}
                          onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setTablePrompt(e.target.value)}
                        />
                      </div>
                    </div>
                  )}
                </div>

                {/* Navigation */}
                <div className="flex gap-2">
                  <Button variant="outline" className="flex-1" onClick={() => setStep(isManualMode ? 1 : 2)}>
                    {t('documentPanel.boardIngest.back')}
                  </Button>
                  <Button
                    className="flex-1"
                    onClick={handleStartIngestion}
                    disabled={isSubmitting || !fieldMapping.title_field || !fieldMapping.body_field}
                  >
                    {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                    {t('documentPanel.boardIngest.startIngestion')}
                  </Button>
                </div>
              </div>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}

// ============================================================
// Sub-components
// ============================================================

function KeyValueSection({
  label, addLabel, items, onChange,
}: {
  label: string
  addLabel: string
  items: Array<{ key: string; value: string }>
  onChange: (items: Array<{ key: string; value: string }>) => void
}) {
  const { t } = useTranslation()
  return (
    <div>
      <div className="flex items-center justify-between">
        <Label className="text-sm font-medium">{label}</Label>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => onChange([...items, { key: '', value: '' }])}
          className="h-6 text-xs"
        >
          <Plus className="h-3 w-3 mr-1" /> {addLabel}
        </Button>
      </div>
      {items.map((item, i) => (
        <div key={i} className="flex gap-1 mt-1">
          <Input
            placeholder={t('documentPanel.boardIngest.key')}
            value={item.key}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
              const newItems = [...items]
              newItems[i] = { ...newItems[i], key: e.target.value }
              onChange(newItems)
            }}
            className="h-7 text-xs flex-1"
          />
          <Input
            placeholder={t('documentPanel.boardIngest.value')}
            value={item.value}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
              const newItems = [...items]
              newItems[i] = { ...newItems[i], value: e.target.value }
              onChange(newItems)
            }}
            className="h-7 text-xs flex-1"
          />
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onChange(items.filter((_, j) => j !== i))}
            className="h-7 w-7 p-0"
          >
            <Trash2 className="h-3 w-3" />
          </Button>
        </div>
      ))}
    </div>
  )
}

function MappingInputs({
  mapping, onChange,
}: {
  mapping: BoardFieldMapping
  onChange: (key: keyof BoardFieldMapping, value: string) => void
}) {
  const { t } = useTranslation()
  return (
    <div className="space-y-2">
      <FieldRow label={t('documentPanel.boardIngest.itemsPath')}>
        <Input
          value={mapping.items_path}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => onChange('items_path', e.target.value)}
          placeholder="data.items"
          className="h-7 text-xs"
        />
      </FieldRow>
      <FieldRow label={t('documentPanel.boardIngest.titleField')} required>
        <Input
          value={mapping.title_field}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => onChange('title_field', e.target.value)}
          placeholder="title"
          className="h-7 text-xs"
        />
      </FieldRow>
      <FieldRow label={t('documentPanel.boardIngest.bodyField')} required>
        <Input
          value={mapping.body_field}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => onChange('body_field', e.target.value)}
          placeholder="content"
          className="h-7 text-xs"
        />
      </FieldRow>
      <FieldRow label={t('documentPanel.boardIngest.idField')}>
        <Input
          value={mapping.id_field || ''}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => onChange('id_field', e.target.value)}
          placeholder="id"
          className="h-7 text-xs"
        />
      </FieldRow>
      <FieldRow label={t('documentPanel.boardIngest.dateField')}>
        <Input
          value={mapping.date_field || ''}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => onChange('date_field', e.target.value)}
          placeholder="createdAt"
          className="h-7 text-xs"
        />
      </FieldRow>
      <FieldRow label={t('documentPanel.boardIngest.authorField')}>
        <Input
          value={mapping.author_field || ''}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => onChange('author_field', e.target.value)}
          placeholder="author"
          className="h-7 text-xs"
        />
      </FieldRow>
      <FieldRow label={t('documentPanel.boardIngest.paginationType')}>
        <Select
          value={mapping.pagination_type || 'none'}
          onValueChange={(v) => onChange('pagination_type', v)}
        >
          <SelectTrigger className="h-7 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="page_param">Page Parameter</SelectItem>
            <SelectItem value="offset_limit">Offset/Limit</SelectItem>
            <SelectItem value="cursor">Cursor</SelectItem>
            <SelectItem value="none">None</SelectItem>
          </SelectContent>
        </Select>
      </FieldRow>
      {(mapping.pagination_type === 'page_param' || mapping.pagination_type === 'offset_limit') && (
        <>
          <FieldRow label={t('documentPanel.boardIngest.pageParam')}>
            <Input
              value={mapping.page_param || ''}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => onChange('page_param', e.target.value)}
              placeholder="page"
              className="h-7 text-xs"
            />
          </FieldRow>
          <FieldRow label={t('documentPanel.boardIngest.pageSizeParam')}>
            <Input
              value={mapping.page_size_param || ''}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => onChange('page_size_param', e.target.value)}
              placeholder="size"
              className="h-7 text-xs"
            />
          </FieldRow>
        </>
      )}
      <FieldRow label={t('documentPanel.boardIngest.totalField')}>
        <Input
          value={mapping.total_field || ''}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => onChange('total_field', e.target.value)}
          placeholder="data.totalCount"
          className="h-7 text-xs"
        />
      </FieldRow>
      {mapping.pagination_type === 'cursor' && (
        <FieldRow label={t('documentPanel.boardIngest.cursorField')}>
          <Input
            value={mapping.cursor_field || ''}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => onChange('cursor_field', e.target.value)}
            placeholder="nextCursor, cursor ..."
            className="h-7 text-xs"
          />
        </FieldRow>
      )}
      <FieldRow label={t('documentPanel.boardIngest.attachmentsField')}>
        <Input
          value={mapping.attachments_field || ''}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => onChange('attachments_field', e.target.value)}
          placeholder="attachFiles, files ..."
          className="h-7 text-xs"
        />
      </FieldRow>
      {mapping.attachments_field && (
        <>
          <FieldRow label={t('documentPanel.boardIngest.attachmentUrlField')}>
            <Input
              value={mapping.attachment_url_field || ''}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => onChange('attachment_url_field', e.target.value)}
              placeholder="filePath, url ..."
              className="h-7 text-xs"
            />
          </FieldRow>
          <FieldRow label={t('documentPanel.boardIngest.attachmentNameField')}>
            <Input
              value={mapping.attachment_name_field || ''}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => onChange('attachment_name_field', e.target.value)}
              placeholder="attachFileNm, fileName ..."
              className="h-7 text-xs"
            />
          </FieldRow>
        </>
      )}
      <FieldRow label={t('documentPanel.boardIngest.detailUrlTemplate')}>
        <Input
          value={mapping.detail_url_template || ''}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => onChange('detail_url_template', e.target.value)}
          placeholder="/api/board/{id}"
          title={t('documentPanel.boardIngest.detailUrlTemplateTooltip')}
          className="h-7 text-xs"
        />
      </FieldRow>
    </div>
  )
}

function FieldRow({ label, required, children }: {
  label: string
  required?: boolean
  children: React.ReactNode
}) {
  const { t } = useTranslation()
  return (
    <div className="flex items-center gap-2">
      <span className="text-xs w-28 shrink-0 text-right text-muted-foreground">
        {label}
        {required && <span className="text-red-500 ml-0.5">*</span>}
      </span>
      <div className="flex-1">{children}</div>
    </div>
  )
}

function FieldSelect({
  value, keys, onChange,
}: {
  value: string
  keys: string[]
  onChange: (v: string) => void
}) {
  if (keys.length === 0) {
    return (
      <Input
        value={value}
        onChange={(e: React.ChangeEvent<HTMLInputElement>) => onChange(e.target.value)}
        className="h-8 text-sm"
      />
    )
  }
  return (
    <Select value={value || '_none_'} onValueChange={(v) => onChange(v === '_none_' ? '' : v)}>
      <SelectTrigger className="h-8 text-sm">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="_none_">—</SelectItem>
        {keys.map(k => (
          <SelectItem key={k} value={k}>{k}</SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

function ExploreResultPreview({ result }: { result: BoardExploreResponse }) {
  const { t } = useTranslation()

  return (
    <div className="border rounded-md p-3 space-y-2 text-sm">
      {/* Status */}
      <div className="flex items-center gap-2">
        {result.success ? (
          <>
            <CheckCircle2 className="h-4 w-4 text-green-500" />
            <span className="text-green-600">
              {t('documentPanel.boardIngest.detectedItems', { count: result.detected_items_count })}
            </span>
          </>
        ) : (
          <>
            <AlertCircle className="h-4 w-4 text-red-500" />
            <span className="text-red-600">{result.error}</span>
          </>
        )}
      </div>

      {/* Detection info */}
      {result.success && (
        <>
          {result.detection_method && (
            <div className="flex gap-3 text-xs text-muted-foreground">
              <span>{t('documentPanel.boardIngest.detectionMethod')}: {result.detection_method}</span>
              {result.llm_confidence && (
                <span>{t('documentPanel.boardIngest.confidence')}: {result.llm_confidence}</span>
              )}
            </div>
          )}
          {result.llm_notes && (
            <p className="text-xs text-muted-foreground bg-muted p-2 rounded">
              {result.llm_notes}
            </p>
          )}
        </>
      )}

      {/* Sample item preview */}
      {result.sample_item && (
        <div className="bg-muted p-2 rounded space-y-1">
          <p className="text-xs font-medium">{t('documentPanel.boardIngest.samplePreview')}</p>
          {result.sample_item.title && (
            <p className="text-xs"><strong>Title:</strong> {String(result.sample_item.title)}</p>
          )}
          {result.sample_item.body && (
            <p className="text-xs text-muted-foreground line-clamp-2">
              <strong>Body:</strong> {String(result.sample_item.body).substring(0, 150)}
            </p>
          )}
          {result.sample_item.date && (
            <p className="text-xs"><strong>Date:</strong> {String(result.sample_item.date)}</p>
          )}
          {result.sample_item.author && (
            <p className="text-xs"><strong>Author:</strong> {String(result.sample_item.author)}</p>
          )}
        </div>
      )}
    </div>
  )
}

function SamplePreview({ item, mapping }: {
  item: Record<string, any>
  mapping: BoardFieldMapping
}) {
  const { t } = useTranslation()
  return (
    <div className="border rounded-md p-3 space-y-1">
      <p className="text-xs font-medium">{t('documentPanel.boardIngest.mappingPreview')}</p>
      <div className="bg-muted p-2 rounded text-xs space-y-0.5">
        {mapping.title_field && (
          <p><strong>{mapping.title_field}:</strong> {String(item.title || '')}</p>
        )}
        {mapping.body_field && (
          <p className="text-muted-foreground line-clamp-2">
            <strong>{mapping.body_field}:</strong> {String(item.body || '').substring(0, 150)}
          </p>
        )}
        {item.id && <p><strong>ID:</strong> {String(item.id)}</p>}
        {item.date && <p><strong>Date:</strong> {String(item.date)}</p>}
        {item.author && <p><strong>Author:</strong> {String(item.author)}</p>}
      </div>
    </div>
  )
}

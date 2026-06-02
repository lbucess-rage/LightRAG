import { ChangeEvent, useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import {
  CheckCircle2Icon,
  DatabaseIcon,
  EyeIcon,
  FileTextIcon,
  HelpCircleIcon,
  LinkIcon,
  Loader2Icon,
  PlusIcon,
  SparklesIcon,
  Trash2Icon,
} from 'lucide-react'

import {
  AnswerContentFormat,
  AnswerExcelPreviewResponse,
  AnswerGuidanceType,
  AnswerItem,
  AnswerSourceConnector,
  AnswerSourceConnectorMappingPreview,
  AnswerSourceConnectorType,
  AnswerSourceSnapshot,
  createAnswerSourceConnector,
  createAnswerSourceDraft,
  listAnswerSourceConnectors,
  listAnswerSourceSnapshots,
  materializeAnswerStructuredSource,
  materializeAnswerSourceConnector,
  previewAnswerSourceConnectorMapping,
  previewAnswerExcelSource,
  sampleAnswerSourceConnector,
} from '@/api/lightrag'
import AnswerHelpButton from '@/components/answers/AnswerHelpButton'
import Badge from '@/components/ui/Badge'
import Button from '@/components/ui/Button'
import Checkbox from '@/components/ui/Checkbox'
import Input from '@/components/ui/Input'
import Textarea from '@/components/ui/Textarea'
import { Label } from '@/components/ui/Label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/Select'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/Tooltip'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/Dialog'
import { localizedErrorMessage } from '@/lib/utils'
import { useWorkspaceStore } from '@/stores/workspace'

type SourceType = 'plain' | 'markdown' | 'html' | 'url' | 'file' | 'excel' | 'structured'
type ConnectorMaterializationMode = 'table_as_dataset' | 'row_per_answer'
type StructuredMappingRole = 'id' | 'title' | 'question' | 'answer' | 'category' | 'status' | 'valid_from' | 'valid_until'
type ReviewStep = 'details' | 'preview' | 'mapping' | 'hints' | 'confirm'

type ReviewStepItem = {
  id: ReviewStep
  label: string
  description: string
  disabled?: boolean
}

type StructuredProfile = {
  kind: 'json' | 'table' | 'text'
  columns: string[]
  rowCount: number
  sampleRows: string[][]
  jsonKeys: string[]
}

type SourceProfile = {
  charCount: number
  lineCount: number
  tokenCount: number
  headings: string[]
  keywords: string[]
  structured: StructuredProfile
}

type GuidanceCandidate = {
  guidance_type: AnswerGuidanceType
  text: string
  weight: number
  source: string
}

type AnswerCandidate = {
  title: string
  summary: string
  tags: string[]
  profile: SourceProfile
  guidance: GuidanceCandidate[]
}

const sourceFormat: Record<SourceType, AnswerContentFormat> = {
  plain: 'plain',
  markdown: 'markdown',
  html: 'html',
  url: 'markdown',
  file: 'markdown',
  excel: 'plain',
  structured: 'markdown',
}

const sourceTypeToTag: Record<SourceType, string> = {
  plain: 'text',
  markdown: 'markdown',
  html: 'html',
  url: 'url',
  file: 'file',
  excel: 'excel',
  structured: 'structured',
}

const connectorTypes: AnswerSourceConnectorType[] = ['db_table', 'multi_table', 'nosql_collection', 'web', 'manual_table']
const structuredAnswerMappingRoles: StructuredMappingRole[] = ['id', 'title', 'question', 'answer', 'category']
const structuredPolicyMappingRoles: StructuredMappingRole[] = ['status', 'valid_from', 'valid_until']
const structuredMappingRoles: StructuredMappingRole[] = [...structuredAnswerMappingRoles, ...structuredPolicyMappingRoles]
const maxExcelUploadBytes = 200 * 1024 * 1024
const maxStructuredRowsPerAnswerBatch = 1000

const stopWords = new Set([
  'and',
  'the',
  'for',
  'with',
  'from',
  'this',
  'that',
  'what',
  'how',
  'are',
  'you',
  'your',
  '하다',
  '있는',
  '없는',
  '대한',
  '관련',
  '사용',
  '답변',
  '정보',
])

const splitLines = (value: string) =>
  value.split('\n').map((line) => line.trim()).filter(Boolean)

const parseTags = (value: string) =>
  value.split(',').map((tag) => tag.trim()).filter(Boolean)

const unique = <T,>(items: T[]) => Array.from(new Set(items))

const inferStructuredSourceType = (value: string) => {
  const trimmed = value.trim()
  return trimmed.startsWith('{') || trimmed.startsWith('[') ? 'json' : 'csv'
}

const stripMarkup = (value: string, format: AnswerContentFormat) => {
  if (format === 'html') {
    return value
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
  }
  return value.replace(/^#{1,6}\s+/gm, '').replace(/\*\*|__/g, '')
}

const extractHeadings = (value: string, format: AnswerContentFormat) => {
  if (format === 'html') {
    return Array.from(value.matchAll(/<h[1-3][^>]*>(.*?)<\/h[1-3]>/gi))
      .map((match) => stripMarkup(match[1], 'html').trim())
      .filter(Boolean)
      .slice(0, 6)
  }
  return Array.from(value.matchAll(/^#{1,3}\s+(.+)$/gm))
    .map((match) => match[1].trim())
    .filter(Boolean)
    .slice(0, 6)
}

const tokenize = (value: string) =>
  Array.from(value.toLowerCase().matchAll(/[0-9a-z가-힣_]{2,}/g))
    .map((match) => match[0])
    .filter((token) => !stopWords.has(token))

const extractKeywords = (value: string) => {
  const counts = new Map<string, number>()
  tokenize(value).forEach((token) => counts.set(token, (counts.get(token) || 0) + 1))
  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 10)
    .map(([token]) => token)
}

const splitCsvLine = (line: string) => {
  const cells: string[] = []
  let current = ''
  let quoted = false
  for (const char of line) {
    if (char === '"') {
      quoted = !quoted
      continue
    }
    if (char === ',' && !quoted) {
      cells.push(current.trim())
      current = ''
      continue
    }
    current += char
  }
  cells.push(current.trim())
  return cells
}

const profileStructured = (value: string): StructuredProfile => {
  const trimmed = value.trim()
  if (!trimmed) {
    return { kind: 'text', columns: [], rowCount: 0, sampleRows: [], jsonKeys: [] }
  }

  try {
    const parsed = JSON.parse(trimmed)
    const rows = Array.isArray(parsed) ? parsed : [parsed]
    const objects = rows.filter((row) => row && typeof row === 'object' && !Array.isArray(row)) as Record<string, unknown>[]
    const columns = unique(objects.flatMap((row) => Object.keys(row))).slice(0, 20)
    const sampleRows = objects.slice(0, 3).map((row) => columns.slice(0, 6).map((column) => String(row[column] ?? '')))
    return {
      kind: 'json',
      columns,
      rowCount: rows.length,
      sampleRows,
      jsonKeys: columns,
    }
  } catch {
    // Not JSON. Try CSV/table below.
  }

  const rows = trimmed.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
  if (rows.length >= 2 && rows[0].includes(',')) {
    const columns = splitCsvLine(rows[0]).slice(0, 20)
    return {
      kind: 'table',
      columns,
      rowCount: Math.max(rows.length - 1, 0),
      sampleRows: rows.slice(1, 4).map((row) => splitCsvLine(row).slice(0, 6)),
      jsonKeys: [],
    }
  }

  return { kind: 'text', columns: [], rowCount: 0, sampleRows: [], jsonKeys: [] }
}

const buildCandidate = ({
  sourceType,
  contentFormat,
  title,
  summary,
  body,
  tags,
  guidance,
  sourceUri,
  fileName,
}: {
  sourceType: SourceType
  contentFormat: AnswerContentFormat
  title: string
  summary: string
  body: string
  tags: string
  guidance: string
  sourceUri: string
  fileName: string
}): AnswerCandidate => {
  const clean = stripMarkup(body, contentFormat)
  const headings = extractHeadings(body, contentFormat)
  const lines = splitLines(clean)
  const structured = profileStructured(body)
  const keywords = extractKeywords(`${title}\n${summary}\n${clean}\n${structured.columns.join(' ')}`)
  const fallbackTitle =
    headings[0] ||
    title.trim() ||
    fileName.replace(/\.[^.]+$/, '') ||
    sourceUri.replace(/^https?:\/\//, '').split(/[/?#]/)[0] ||
    lines[0]?.slice(0, 80) ||
    'Untitled Answer'
  const fallbackSummary = summary.trim() || lines.slice(0, 3).join(' ').slice(0, 280)
  const manualGuidance = splitLines(guidance).map<GuidanceCandidate>((text) => ({
    guidance_type: text.includes('?') || text.includes('？') ? 'question' : 'keyword',
    text,
    weight: text.includes('?') || text.includes('？') ? 1.2 : 1,
    source: 'manual',
  }))
  const keywordGuidance = keywords.slice(0, 6).map<GuidanceCandidate>((text) => ({
    guidance_type: 'keyword',
    text,
    weight: 0.9,
    source: 'profile',
  }))
  const headingGuidance = headings.slice(0, 3).map<GuidanceCandidate>((text) => ({
    guidance_type: 'question',
    text,
    weight: 1.1,
    source: 'heading',
  }))
  const columnGuidance = structured.columns.slice(0, 5).map<GuidanceCandidate>((text) => ({
    guidance_type: 'synonym',
    text,
    weight: 0.7,
    source: 'structured_field',
  }))

  return {
    title: fallbackTitle,
    summary: fallbackSummary,
    tags: unique([...parseTags(tags), sourceTypeToTag[sourceType], ...structured.columns.slice(0, 3)]),
    profile: {
      charCount: body.length,
      lineCount: lines.length,
      tokenCount: tokenize(clean).length,
      headings,
      keywords,
      structured,
    },
    guidance: unique([...manualGuidance, ...headingGuidance, ...keywordGuidance, ...columnGuidance].map((item) => JSON.stringify(item)))
      .map((item) => JSON.parse(item) as GuidanceCandidate)
      .slice(0, 18),
  }
}

export default function AnswerSources() {
  const { t } = useTranslation()
  const currentWorkspaceId = useWorkspaceStore.use.currentWorkspaceId()
  const [sourceType, setSourceType] = useState<SourceType>('plain')
  const [contentFormat, setContentFormat] = useState<AnswerContentFormat>('plain')
  const [sourceUri, setSourceUri] = useState('')
  const [title, setTitle] = useState('')
  const [summary, setSummary] = useState('')
  const [body, setBody] = useState('')
  const [tags, setTags] = useState('')
  const [guidance, setGuidance] = useState('')
  const [guidanceCandidates, setGuidanceCandidates] = useState<GuidanceCandidate[]>([])
  const [priority, setPriority] = useState('0')
  const [fileName, setFileName] = useState('')
  const [candidate, setCandidate] = useState<AnswerCandidate | null>(null)
  const [createdAnswer, setCreatedAnswer] = useState<AnswerItem | null>(null)
  const [snapshots, setSnapshots] = useState<AnswerSourceSnapshot[]>([])
  const [isLoadingSnapshots, setIsLoadingSnapshots] = useState(false)
  const [sourceSupportTool, setSourceSupportTool] = useState<'history' | 'connectors'>('history')
  const [isSupportToolsOpen, setIsSupportToolsOpen] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [connectors, setConnectors] = useState<AnswerSourceConnector[]>([])
  const [selectedConnectorId, setSelectedConnectorId] = useState('')
  const [connectorName, setConnectorName] = useState('')
  const [connectorType, setConnectorType] = useState<AnswerSourceConnectorType>('db_table')
  const [connectorUri, setConnectorUri] = useState('')
  const [connectorContent, setConnectorContent] = useState('')
  const [connectorMode, setConnectorMode] = useState<ConnectorMaterializationMode>('table_as_dataset')
  const [connectorPreview, setConnectorPreview] = useState<AnswerSourceConnectorMappingPreview | null>(null)
  const [isLoadingConnectors, setIsLoadingConnectors] = useState(false)
  const [isConnectorBusy, setIsConnectorBusy] = useState(false)
  const [excelFile, setExcelFile] = useState<File | null>(null)
  const [excelPreview, setExcelPreview] = useState<AnswerExcelPreviewResponse | null>(null)
  const [excelSheetName, setExcelSheetName] = useState('')
  const [excelHeaderRow, setExcelHeaderRow] = useState('1')
  const [excelDataStartRow, setExcelDataStartRow] = useState('')
  const [structuredMode, setStructuredMode] = useState<ConnectorMaterializationMode>('row_per_answer')
  const [structuredMapping, setStructuredMapping] = useState<Partial<Record<StructuredMappingRole, string>>>({})
  const [structuredGuidanceColumns, setStructuredGuidanceColumns] = useState<string[]>([])
  const [isExcelBusy, setIsExcelBusy] = useState(false)
  const [activeReviewStep, setActiveReviewStep] = useState<ReviewStep>('details')

  const fetchSnapshots = useCallback(async () => {
    const workspaceId = currentWorkspaceId
    setIsLoadingSnapshots(true)
    try {
      const result = await listAnswerSourceSnapshots({ limit: 50 })
      if (workspaceId !== useWorkspaceStore.getState().currentWorkspaceId) return
      setSnapshots(result)
    } catch (err) {
      toast.error(localizedErrorMessage(err, t))
    } finally {
      setIsLoadingSnapshots(false)
    }
  }, [currentWorkspaceId, t])

  const fetchConnectors = useCallback(async () => {
    const workspaceId = currentWorkspaceId
    setIsLoadingConnectors(true)
    try {
      const result = await listAnswerSourceConnectors({ limit: 50 })
      if (workspaceId !== useWorkspaceStore.getState().currentWorkspaceId) return
      setConnectors(result)
      setSelectedConnectorId((current) => result.some((connector) => connector.connector_id === current) ? current : result[0]?.connector_id || '')
    } catch (err) {
      toast.error(localizedErrorMessage(err, t))
    } finally {
      setIsLoadingConnectors(false)
    }
  }, [currentWorkspaceId, t])

  useEffect(() => {
    setSourceUri('')
    setTitle('')
    setSummary('')
    setBody('')
    setTags('')
    setGuidance('')
    setGuidanceCandidates([])
    setPriority('0')
    setFileName('')
    setCandidate(null)
    setCreatedAnswer(null)
    setSnapshots([])
    setConnectors([])
    setSelectedConnectorId('')
    setConnectorName('')
    setConnectorType('db_table')
    setConnectorUri('')
    setConnectorContent('')
    setConnectorPreview(null)
    setExcelFile(null)
    setExcelPreview(null)
    setExcelSheetName('')
    setExcelHeaderRow('1')
    setExcelDataStartRow('')
    setStructuredMode('row_per_answer')
    setStructuredMapping({})
    setStructuredGuidanceColumns([])
    setContentFormat('plain')
    setActiveReviewStep('details')
  }, [currentWorkspaceId])

  useEffect(() => {
    fetchSnapshots()
    fetchConnectors()
  }, [fetchConnectors, fetchSnapshots])

  const sourceHelp = useMemo(() => {
    if (sourceType === 'url') return t('answerCatalog.sources.urlHelp', 'The URL is stored as source information. Paste the relevant content to create a reviewable answer candidate.')
    if (sourceType === 'file') return t('answerCatalog.sources.fileHelp', 'Text, Markdown, and HTML files can be read locally and converted into an answer candidate.')
    if (sourceType === 'excel') return t('answerCatalog.sources.excelHelp', 'Upload an Excel workbook up to 200MB, select a sheet, check the columns, then create one answer candidate per row or one dataset answer candidate from the whole table.')
    if (sourceType === 'structured') return t('answerCatalog.sources.structuredHelp', 'Paste a table row, JSON record, DB extract, or NoSQL document sample. You can review the structure analysis before creating answer candidates.')
    return t('answerCatalog.sources.textHelp', 'Paste source content and create a reviewable answer candidate.')
  }, [sourceType, t])

  const selectedConnector = useMemo(
    () => connectors.find((connector) => connector.connector_id === selectedConnectorId) || null,
    [connectors, selectedConnectorId]
  )

  const reviewSteps = useMemo<ReviewStepItem[]>(() => {
    const steps: ReviewStepItem[] = [
      {
        id: 'details',
        label: t('answerCatalog.sources.reviewSteps.details', '1. Common Settings'),
        description: t('answerCatalog.sources.reviewSteps.detailsDesc', 'Check the source batch name, summary, common tags, and priority.'),
      },
    ]
    if (sourceType === 'excel') {
      steps.push({
        id: 'mapping',
        label: t('answerCatalog.sources.reviewSteps.mapping', '2. Excel Mapping'),
        description: t('answerCatalog.sources.reviewSteps.mappingDesc', 'Choose which columns become the answer title, body, category, and matching hints.'),
        disabled: !excelPreview,
      })
    } else {
      steps.push({
        id: 'preview',
        label: t('answerCatalog.sources.reviewSteps.preview', '2. Optional Preview'),
        description: t('answerCatalog.sources.reviewSteps.previewDesc', 'Preview source analysis and detected fields, or skip and let creation analyze automatically.'),
      })
    }
    steps.push(
      {
        id: 'hints',
        label: sourceType === 'excel'
          ? t('answerCatalog.sources.reviewSteps.hintsExcel', '3. Finding Hints')
          : t('answerCatalog.sources.reviewSteps.hints', '3. Finding Hints'),
        description: t('answerCatalog.sources.reviewSteps.hintsDesc', 'Review representative questions, keywords, synonyms, and exclusions used for matching.'),
      },
      {
        id: 'confirm',
        label: sourceType === 'excel'
          ? t('answerCatalog.sources.reviewSteps.confirmExcel', '4. Create')
          : t('answerCatalog.sources.reviewSteps.confirm', '4. Create'),
        description: t('answerCatalog.sources.reviewSteps.confirmDesc', 'Confirm what will be created, then generate unpublished answer candidates.'),
      },
    )
    return steps
  }, [excelPreview, sourceType, t])

  const activeStepIndex = reviewSteps.findIndex((step) => step.id === activeReviewStep)
  const activeStep = reviewSteps[activeStepIndex] || reviewSteps[0]
  const canGoPreviousStep = activeStepIndex > 0
  const canGoNextStep = activeStepIndex >= 0 && activeStepIndex < reviewSteps.length - 1
  const nextReviewStep = reviewSteps[activeStepIndex + 1]
  const estimatedDraftCount = sourceType === 'excel' && excelPreview
    ? structuredMode === 'row_per_answer' ? excelPreview.row_count : 1
    : 1
  const estimatedHintBasisCount = sourceType === 'excel' && excelPreview
    ? [
        structuredMapping.question,
        structuredMapping.title,
        structuredMapping.category,
        structuredMapping.answer,
        ...structuredGuidanceColumns,
      ].filter(Boolean).length
    : guidanceCandidates.length || candidate?.guidance.length || 0
  const exceedsExcelRowLimit = sourceType === 'excel' && structuredMode === 'row_per_answer' && excelPreview
    ? excelPreview.row_count > maxStructuredRowsPerAnswerBatch
    : false
  const canCreateDraft = !isSubmitting && !exceedsExcelRowLimit && (
    sourceType === 'excel' ? Boolean(excelPreview && title.trim() && body.trim()) : Boolean(body.trim())
  )

  const goToRelativeReviewStep = (direction: 1 | -1) => {
    if (activeStepIndex < 0) return
    const nextStep = reviewSteps[activeStepIndex + direction]
    if (nextStep && !nextStep.disabled) {
      setActiveReviewStep(nextStep.id)
    }
  }

  useEffect(() => {
    if (!reviewSteps.some((step) => step.id === activeReviewStep) || activeStep?.disabled) {
      setActiveReviewStep('details')
    }
  }, [activeReviewStep, activeStep, reviewSteps])

  const resetForm = () => {
    setSourceUri('')
    setTitle('')
    setSummary('')
    setBody('')
    setTags('')
    setGuidance('')
    setGuidanceCandidates([])
    setPriority('0')
    setFileName('')
    setCandidate(null)
    setExcelFile(null)
    setExcelPreview(null)
    setExcelSheetName('')
    setExcelHeaderRow('1')
    setExcelDataStartRow('')
    setStructuredMode('row_per_answer')
    setStructuredMapping({})
    setStructuredGuidanceColumns([])
    setContentFormat('plain')
    setActiveReviewStep('details')
  }

  const handleFileChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return
    try {
      const text = await file.text()
      setFileName(file.name)
      setTitle((current) => current || file.name.replace(/\.[^.]+$/, ''))
      setBody(text)
      const lowerName = file.name.toLowerCase()
      if (lowerName.endsWith('.html') || lowerName.endsWith('.htm')) {
        setContentFormat('html')
      } else if (lowerName.endsWith('.txt') || lowerName.endsWith('.csv') || lowerName.endsWith('.json')) {
        setContentFormat('plain')
      } else {
        setContentFormat('markdown')
      }
      setCandidate(null)
    } catch (err) {
      toast.error(localizedErrorMessage(err, t))
    }
  }

  const applyExcelPreview = (preview: AnswerExcelPreviewResponse) => {
    const mapping = Object.fromEntries(
      Object.entries(preview.profile.mapping_suggestions || {})
        .filter((entry): entry is [StructuredMappingRole, string] =>
          structuredMappingRoles.includes(entry[0] as StructuredMappingRole) && Boolean(entry[1])
        )
    )
    const mappedColumns = new Set(Object.values(mapping))
    const guidanceColumns = preview.profile.fields
      .filter((field) => !mappedColumns.has(field.name) && ['title', 'category', 'id', 'metadata'].includes(field.semantic_role))
      .map((field) => field.name)
      .slice(0, 5)
    const fallbackTitle = `${preview.file_name.replace(/\.[^.]+$/, '')} - ${preview.selected_sheet}`
    setExcelPreview(preview)
    setExcelSheetName(preview.selected_sheet)
    setExcelHeaderRow(String(preview.header_row))
    setExcelDataStartRow(String(preview.data_start_row))
    setFileName(preview.file_name)
    setSourceUri(preview.source_uri)
    setTitle((current) => current || fallbackTitle)
    setSummary((current) => current || t('answerCatalog.sources.excelSummary', {
      defaultValue: '{{sheet}} sheet, {{rows}} rows',
      sheet: preview.selected_sheet,
      rows: preview.row_count,
    }))
    setBody(preview.raw_content)
    setTags((current) => current || 'excel, structured')
    setContentFormat('plain')
    setStructuredMapping(mapping)
    setStructuredGuidanceColumns(guidanceColumns)
    setActiveReviewStep('mapping')
    setCandidate(buildCandidate({
      sourceType: 'excel',
      contentFormat: 'plain',
      title: title || fallbackTitle,
      summary,
      body: preview.raw_content,
      tags: tags || 'excel, structured',
      guidance,
      sourceUri: preview.source_uri,
      fileName: preview.file_name,
    }))
  }

  const handleExcelPreview = async (
    file: File,
    options: { sheetName?: string; headerRow?: number; dataStartRow?: number } = {}
  ) => {
    if (file.size > maxExcelUploadBytes) {
      toast.error(t('answerCatalog.sources.excelTooLarge', 'Excel files can be uploaded up to 200MB.'))
      return
    }
    setIsExcelBusy(true)
    try {
      const workspaceId = currentWorkspaceId
      const preview = await previewAnswerExcelSource(file, {
        sheet_name: options.sheetName || excelSheetName || undefined,
        header_row: options.headerRow || Number(excelHeaderRow) || 1,
        data_start_row: options.dataStartRow || Number(excelDataStartRow) || undefined,
        sample_limit: 20,
        max_rows: 1000,
      })
      if (workspaceId !== useWorkspaceStore.getState().currentWorkspaceId) return
      applyExcelPreview(preview)
      toast.success(t('answerCatalog.sources.excelPreviewReady', 'Excel preview is ready.'))
    } catch (err) {
      toast.error(localizedErrorMessage(err, t))
    } finally {
      setIsExcelBusy(false)
    }
  }

  const handleExcelFileChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return
    setExcelFile(file)
    setExcelPreview(null)
    setExcelSheetName('')
    setExcelHeaderRow('1')
    setExcelDataStartRow('')
    setSourceType('excel')
    await handleExcelPreview(file, { headerRow: 1 })
  }

  const updateStructuredMapping = (role: StructuredMappingRole, column: string) => {
    setStructuredMapping((current) => {
      const next = { ...current }
      if (!column || column === 'none') {
        delete next[role]
      } else {
        Object.entries(next).forEach(([mappedRole, mappedColumn]) => {
          if (mappedRole !== role && mappedColumn === column) {
            delete next[mappedRole as StructuredMappingRole]
          }
        })
        next[role] = column
      }
      return next
    })
  }

  const toggleStructuredGuidanceColumn = (column: string, checked: boolean) => {
    setStructuredGuidanceColumns((current) => {
      if (checked) return current.includes(column) ? current : [...current, column]
      return current.filter((item) => item !== column)
    })
  }

  const handleAnalyzeSource = (options: { nextStep?: ReviewStep; showToast?: boolean } = {}) => {
    if (!body.trim()) {
      if (options.showToast !== false) {
        toast.error(t('answerCatalog.sources.bodyRequired', 'Paste source content before preview.'))
      }
      return
    }
    const nextCandidate = buildCandidate({
      sourceType,
      contentFormat,
      title,
      summary,
      body,
      tags,
      guidance,
      sourceUri,
      fileName,
    })
    setCandidate(nextCandidate)
    setGuidanceCandidates(nextCandidate.guidance)
    if (!title.trim()) setTitle(nextCandidate.title)
    if (!summary.trim()) setSummary(nextCandidate.summary)
    if (!tags.trim()) setTags(nextCandidate.tags.join(', '))
    if (options.nextStep) setActiveReviewStep(options.nextStep)
    if (options.showToast !== false) {
      toast.success(t('answerCatalog.sources.previewReady', 'Source preview is ready for review.'))
    }
    return nextCandidate
  }

  const updateGuidanceCandidate = (index: number, patch: Partial<GuidanceCandidate>) => {
    setGuidanceCandidates((items) => items.map((item, itemIndex) => itemIndex === index ? { ...item, ...patch } : item))
  }

  const handleCreateConnector = async () => {
    if (!connectorName.trim()) {
      toast.error(t('answerCatalog.sources.connectorNameRequired', 'Enter a connector name.'))
      return
    }
    const canUseLocationOnly = connectorType === 'db_table' && connectorUri.trim()
    if (!connectorContent.trim() && !canUseLocationOnly) {
      toast.error(t('answerCatalog.sources.connectorContentRequired', 'Paste sample content before creating a connector.'))
      return
    }
    setIsConnectorBusy(true)
    try {
      const workspaceId = currentWorkspaceId
      const connector = await createAnswerSourceConnector({
        name: connectorName.trim(),
        connector_type: connectorType,
        status: 'draft',
        enabled: true,
        config: {
          source_uri: connectorUri.trim() || undefined,
          raw_content: connectorContent.trim() || undefined,
          source_type: connectorContent.trim() ? inferStructuredSourceType(connectorContent) : undefined,
          created_from: 'answer_sources_connector_ui',
        },
        metadata: {
          created_from: 'answer_sources_connector_ui',
        },
      })
      if (workspaceId !== useWorkspaceStore.getState().currentWorkspaceId) return
      setSelectedConnectorId(connector.connector_id)
      setConnectorPreview(null)
      toast.success(t('answerCatalog.sources.connectorCreated', 'Connector has been registered.'))
      fetchConnectors()
    } catch (err) {
      toast.error(localizedErrorMessage(err, t))
    } finally {
      setIsConnectorBusy(false)
    }
  }

  const handleSampleConnector = async () => {
    if (!selectedConnectorId) {
      toast.error(t('answerCatalog.sources.connectorRequired', 'Select a connector first.'))
      return
    }
    setIsConnectorBusy(true)
    try {
      const workspaceId = currentWorkspaceId
      const sample = await sampleAnswerSourceConnector(selectedConnectorId, { limit: 50 })
      if (workspaceId !== useWorkspaceStore.getState().currentWorkspaceId) return
      setSourceType('structured')
      setContentFormat('plain')
      setSourceUri(sample.source_uri || selectedConnector?.config?.source_uri || `connector://${sample.connector_id}`)
      setTitle((current) => current || selectedConnector?.name || sample.connector_id)
      setBody(sample.raw_content)
      setTags((current) => current || [sample.connector_type, 'connector'].join(', '))
      setCandidate(null)
      toast.success(t('answerCatalog.sources.sampleLoaded', 'Connector sample has been loaded into the source editor.'))
    } catch (err) {
      toast.error(localizedErrorMessage(err, t))
    } finally {
      setIsConnectorBusy(false)
    }
  }

  const handlePreviewConnector = async () => {
    if (!selectedConnectorId) {
      toast.error(t('answerCatalog.sources.connectorRequired', 'Select a connector first.'))
      return
    }
    setIsConnectorBusy(true)
    try {
      const workspaceId = currentWorkspaceId
      const preview = await previewAnswerSourceConnectorMapping(selectedConnectorId, {
        materialization_mode: connectorMode,
      })
      if (workspaceId !== useWorkspaceStore.getState().currentWorkspaceId) return
      setConnectorPreview(preview)
      toast.success(t('answerCatalog.sources.mappingPreviewReady', 'Connector mapping preview is ready.'))
    } catch (err) {
      toast.error(localizedErrorMessage(err, t))
    } finally {
      setIsConnectorBusy(false)
    }
  }

  const handleMaterializeConnector = async () => {
    if (!selectedConnectorId) {
      toast.error(t('answerCatalog.sources.connectorRequired', 'Select a connector first.'))
      return
    }
    setIsConnectorBusy(true)
    try {
      const workspaceId = currentWorkspaceId
      const result = await materializeAnswerSourceConnector(selectedConnectorId, {
        title: selectedConnector?.name || connectorName || undefined,
        mapping: connectorPreview?.mapping,
        guidance_columns: connectorPreview?.guidance_columns,
        materialization_mode: connectorMode,
        status: 'draft',
        tags: [selectedConnector?.connector_type || connectorType, 'connector'],
        metadata: {
          created_from: 'answer_sources_connector_ui',
          connector_name: selectedConnector?.name,
        },
      })
      if (workspaceId !== useWorkspaceStore.getState().currentWorkspaceId) return
      toast.success(t('answerCatalog.sources.connectorMaterialized', {
          defaultValue: '{{count}} answer candidate(s) were created from the reusable source.',
        count: result.materialized.answers.length,
      }))
      fetchConnectors()
      fetchSnapshots()
    } catch (err) {
      toast.error(localizedErrorMessage(err, t))
    } finally {
      setIsConnectorBusy(false)
    }
  }

  const handleCreateDraft = async () => {
    if (!body.trim()) {
      toast.error(t('answerCatalog.sources.bodyRequired', 'Paste source content before preview.'))
      return
    }
    if (sourceType === 'excel' && !excelPreview) {
      toast.error(t('answerCatalog.sources.excelPreviewRequired', 'Preview the Excel file before creating answer candidates.'))
      return
    }
    if (sourceType === 'excel' && structuredMode === 'row_per_answer' && excelPreview && excelPreview.row_count > maxStructuredRowsPerAnswerBatch) {
      toast.error(t('answerCatalog.sources.excelRowLimit', 'Row-per-answer candidate creation currently supports up to 1000 rows. Use one dataset answer candidate or reduce the selected sheet.'))
      return
    }
    setIsSubmitting(true)
    try {
      const workspaceId = currentWorkspaceId
      if (sourceType === 'excel' && excelPreview) {
        if (!title.trim()) {
          toast.error(t('answerCatalog.library.required', 'Title and body are required.'))
          return
        }
        const result = await materializeAnswerStructuredSource({
          source_type: 'json',
          raw_content: body.trim(),
          title: title.trim(),
          approved_summary: summary.trim() || null,
          source_uri: sourceUri.trim() || excelPreview.source_uri,
          file_name: fileName || excelPreview.file_name,
          status: 'draft',
          priority: Number(priority) || 0,
          tags: parseTags(tags),
          mapping: Object.fromEntries(
            Object.entries(structuredMapping).filter(([, column]) => Boolean(column))
          ),
          guidance_columns: structuredGuidanceColumns,
          materialization_mode: structuredMode,
          metadata: {
            created_from: 'answer_excel_source_ui',
            original_source_type: 'excel',
            excel_file_name: excelPreview.file_name,
            excel_file_size: excelPreview.file_size,
            excel_sheet_name: excelPreview.selected_sheet,
            excel_header_row: excelPreview.header_row,
            excel_data_start_row: excelPreview.data_start_row,
          },
        })
        if (workspaceId !== useWorkspaceStore.getState().currentWorkspaceId) return
        setCreatedAnswer(result.answers[0] || result.answer)
        toast.success(t('answerCatalog.sources.excelCreated', {
          defaultValue: 'Created {{count}} answer candidate(s) from Excel.',
          count: result.answers.length || 1,
        }))
        fetchSnapshots()
        resetForm()
        return
      }
      const draftCandidate = candidate || handleAnalyzeSource({ showToast: false })
      const draftTitle = title.trim() || draftCandidate?.title || ''
      if (!draftTitle) {
        toast.error(t('answerCatalog.library.required', 'Title and body are required.'))
        return
      }
      const draftTags = parseTags(tags)
      const draftGuidanceCandidates = guidanceCandidates.length > 0
        ? guidanceCandidates
        : draftCandidate?.guidance || []
      const result = await createAnswerSourceDraft({
        title: draftTitle,
        approved_summary: summary.trim() || draftCandidate?.summary || null,
        body: body.trim(),
        content_format: contentFormat,
        display_policy: 'both',
        status: 'draft',
        priority: Number(priority) || 0,
        tags: draftTags.length > 0 ? draftTags : draftCandidate?.tags || [],
        metadata: {
          created_from: 'answer_source_wizard',
        },
        source_type: sourceType,
        source_uri: sourceUri.trim() || undefined,
        file_name: fileName || undefined,
        source_profile: draftCandidate?.profile,
        guidance: draftGuidanceCandidates
          .filter((item) => item.text.trim())
          .map((item) => ({
            guidance_type: item.guidance_type,
            text: item.text.trim(),
            weight: item.weight,
            source: item.source,
            metadata: {
              created_from: 'answer_source_wizard',
              source: item.source,
            },
          })),
      })
      if (workspaceId !== useWorkspaceStore.getState().currentWorkspaceId) return
      setCreatedAnswer(result.answer)
      toast.success(t('answerCatalog.sources.created', 'Answer candidate created from source.'))
      fetchSnapshots()
      resetForm()
    } catch (err) {
      toast.error(localizedErrorMessage(err, t))
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div className="flex h-full flex-col gap-4 p-4">
      <div className="flex items-start gap-3">
        <div className="rounded-md border bg-muted/40 p-2">
          <LinkIcon className="h-5 w-5" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-2xl font-bold">{t('answerCatalog.sources.title', 'Add Answers')}</h1>
              <Badge variant="outline">Phase 2+</Badge>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="outline" onClick={() => setIsSupportToolsOpen(true)}>
                <DatabaseIcon className="h-4 w-4" />
                {t('answerCatalog.sources.openSupportTools', 'Support Tools')}
              </Button>
              <AnswerHelpButton />
            </div>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            {t('answerCatalog.sources.description', 'Turn source content into reviewable FAQ answer candidates.')}
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <SourceGuideHint
              label={t('answerCatalog.sources.basicBadge', 'Basic')}
              title={t('answerCatalog.sources.quickSourceCardTitle', 'Quick Add Answers')}
              description={t('answerCatalog.sources.quickSourceCardDesc', 'Use this first for one-off text, file, URL, or table samples. Preview the source content, then create unpublished answer candidates.')}
            />
            <SourceGuideHint
              label={t('answerCatalog.sources.optionalBadge', 'Optional')}
              title={t('answerCatalog.sources.repeatSourceCardTitle', 'Reusable Add Answers Setup')}
              description={t('answerCatalog.sources.repeatSourceCardDesc', 'Use this when the same DB, NoSQL, web, or manual table input will be sampled, mapped, or converted repeatedly.')}
            />
            <SourceGuideHint
              label={t('answerCatalog.sources.historyBadge', 'History')}
              title={t('answerCatalog.sources.recordsCardTitle', 'Add Answers History')}
              description={t('answerCatalog.sources.recordsCardDesc', 'Every created answer candidate keeps its source snapshot, source row, and creation path so the origin can be audited later.')}
            />
          </div>
        </div>
      </div>

      <Dialog open={isSupportToolsOpen} onOpenChange={setIsSupportToolsOpen}>
        <DialogContent className="flex max-h-[88vh] w-[calc(100vw-2rem)] max-w-7xl flex-col overflow-hidden">
          <DialogHeader>
            <DialogTitle>{t('answerCatalog.sources.supportTools', 'Add Answers Support Tools')}</DialogTitle>
            <DialogDescription>
              {t('answerCatalog.sources.supportToolsDesc', 'These are optional operating tools. They are separate from the normal source-to-answer candidate flow above.')}
            </DialogDescription>
          </DialogHeader>
          <div className="min-h-0 flex-1 overflow-y-auto pr-1">
      <div className="rounded-md border bg-muted/10 p-4">
        <div className="mb-4 flex flex-wrap gap-2">
            <Button
              variant={sourceSupportTool === 'history' ? 'default' : 'outline'}
              size="sm"
              onClick={() => setSourceSupportTool('history')}
            >
              {t('answerCatalog.sources.snapshotHistory', 'Add Answers History')}
            </Button>
            <Button
              variant={sourceSupportTool === 'connectors' ? 'default' : 'outline'}
              size="sm"
              onClick={() => setSourceSupportTool('connectors')}
            >
              {t('answerCatalog.sources.connectorRegistry', 'Reusable Add Answers Setup')}
            </Button>
        </div>

        {sourceSupportTool === 'history' ? (
          <SourceSnapshotHistory
            snapshots={snapshots}
            isLoading={isLoadingSnapshots}
            onRefresh={fetchSnapshots}
          />
        ) : (
          <div className="grid gap-4">
            <div className="rounded-md border border-dashed bg-background p-3 text-sm leading-6 text-muted-foreground">
              <span className="font-medium text-foreground">
                {t('answerCatalog.sources.connectorRelationshipTitle', 'Relationship with quick Add Answers')}
              </span>
              <span className="ml-1">
                {t('answerCatalog.sources.connectorRelationshipDesc', 'Reusable input can load a sample into the quick Add Answers editor, preview the field mapping, or create answer candidates directly. If the input is only used once, skip this section.')}
              </span>
            </div>

            <div className="grid gap-4 xl:grid-cols-[420px_1fr]">
          <div className="grid gap-3 rounded-md border bg-muted/10 p-3">
            <div className="grid gap-2 md:grid-cols-[150px_1fr]">
              <div className="grid gap-2">
                <Label>{t('answerCatalog.sources.connectorType', 'Connector Type')}</Label>
                <Select value={connectorType} onValueChange={(value) => setConnectorType(value as AnswerSourceConnectorType)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {connectorTypes.map((type) => (
                      <SelectItem key={type} value={type}>
                        {t(`answerCatalog.sources.connectorTypes.${type}`, type.replace(/_/g, ' '))}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-2">
                <Label>{t('answerCatalog.sources.connectorName', 'Connector Name')}</Label>
                <Input
                  value={connectorName}
                  onChange={(event) => setConnectorName(event.target.value)}
                  placeholder={t('answerCatalog.sources.connectorNamePlaceholder', 'Example: billing FAQ table')}
                />
              </div>
            </div>
            <div className="grid gap-2">
              <Label>{t('answerCatalog.sources.connectorUri', 'Connector Location')}</Label>
              <Input
                value={connectorUri}
                onChange={(event) => setConnectorUri(event.target.value)}
                placeholder="db://schema.table, mongo://collection, https://example.com/feed"
              />
            </div>
            <div className="grid gap-2">
              <Label>{t('answerCatalog.sources.connectorContent', 'Sample Content')}</Label>
              <Textarea
                className="min-h-36 font-mono text-xs"
                value={connectorContent}
                onChange={(event) => setConnectorContent(event.target.value)}
                placeholder={t('answerCatalog.sources.connectorContentPlaceholder', 'question,answer,category\nHow do I change my plan?,Open My Page > Plan.,Billing')}
              />
              <div className="text-xs leading-5 text-muted-foreground">
                {t('answerCatalog.sources.connectorContentHelp', 'For DB table input, this can be left empty when the location is a readable db://schema.table value.')}
              </div>
            </div>
            <Button onClick={handleCreateConnector} disabled={isConnectorBusy}>
              {isConnectorBusy ? <Loader2Icon className="h-4 w-4 animate-spin" /> : <PlusIcon className="h-4 w-4" />}
              {t('answerCatalog.sources.createConnector', 'Register Connector')}
            </Button>
          </div>

          <div className="grid gap-3 rounded-md border bg-muted/10 p-3">
            <div className="grid gap-2 lg:grid-cols-[1fr_190px]">
              <div className="grid gap-2">
                <Label>{t('answerCatalog.sources.selectConnector', 'Registered Connector')}</Label>
                <Select value={selectedConnectorId || 'none'} onValueChange={(value) => {
                  setSelectedConnectorId(value === 'none' || value === 'empty' ? '' : value)
                  setConnectorPreview(null)
                }}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">{t('answerCatalog.sources.selectConnectorPlaceholder', 'Select a connector')}</SelectItem>
                    {connectors.length === 0 ? (
                      <SelectItem value="empty" disabled>{t('answerCatalog.sources.connectorsEmpty', 'No connectors registered yet.')}</SelectItem>
                    ) : connectors.map((connector) => (
                      <SelectItem key={connector.connector_id} value={connector.connector_id}>
                        {connector.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-2">
                <Label>{t('answerCatalog.sources.connectorMode', 'Creation Mode')}</Label>
                <Select value={connectorMode} onValueChange={(value) => {
                  setConnectorMode(value as ConnectorMaterializationMode)
                  setConnectorPreview(null)
                }}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="table_as_dataset">{t('answerCatalog.sources.connectorModeDataset', 'Whole table as one dataset answer candidate')}</SelectItem>
                    <SelectItem value="row_per_answer">{t('answerCatalog.sources.connectorModeRows', 'One answer candidate per row')}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            {selectedConnector ? (
              <div className="grid gap-2 rounded-md border bg-background p-3 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{selectedConnector.name}</span>
                  <Badge variant="outline">{t(`answerCatalog.sources.connectorTypes.${selectedConnector.connector_type}`, selectedConnector.connector_type)}</Badge>
                  <Badge variant="outline">{selectedConnector.status}</Badge>
                  {!selectedConnector.enabled && <Badge variant="outline">{t('common.disabled', 'Disabled')}</Badge>}
                </div>
                <div className="truncate font-mono text-xs text-muted-foreground">
                  {selectedConnector.config?.source_uri || `connector://${selectedConnector.connector_id}`}
                </div>
                {Array.isArray(selectedConnector.metadata?.last_materialized_answer_ids) && (
                  <div className="text-xs text-muted-foreground">
                    {t('answerCatalog.sources.lastMaterialized', 'Recently created answers')}: {selectedConnector.metadata.last_materialized_answer_ids.length}
                  </div>
                )}
              </div>
            ) : (
              <div className="rounded-md border border-dashed bg-background p-3 text-sm text-muted-foreground">
                {t('answerCatalog.sources.connectorsEmpty', 'No connectors registered yet.')}
              </div>
            )}

            <div className="flex flex-wrap gap-2">
              <Button variant="outline" onClick={handleSampleConnector} disabled={isConnectorBusy || !selectedConnectorId}>
                {isConnectorBusy ? <Loader2Icon className="h-4 w-4 animate-spin" /> : <FileTextIcon className="h-4 w-4" />}
                {t('answerCatalog.sources.sampleConnector', 'Load Sample')}
              </Button>
              <Button variant="outline" onClick={handlePreviewConnector} disabled={isConnectorBusy || !selectedConnectorId}>
                {isConnectorBusy ? <Loader2Icon className="h-4 w-4 animate-spin" /> : <EyeIcon className="h-4 w-4" />}
                {t('answerCatalog.sources.mappingPreview', 'Preview Mapping')}
              </Button>
              <Button onClick={handleMaterializeConnector} disabled={isConnectorBusy || !selectedConnectorId}>
                {isConnectorBusy ? <Loader2Icon className="h-4 w-4 animate-spin" /> : <SparklesIcon className="h-4 w-4" />}
                {t('answerCatalog.sources.materializeConnector', 'Create Answer Candidates')}
              </Button>
            </div>

            {connectorPreview ? (
              <div className="grid gap-3 rounded-md border bg-background p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-medium">{t('answerCatalog.sources.connectorPreview', 'Connector Preview')}</span>
                  <Badge variant="outline">{connectorPreview.sample.row_count.toLocaleString()} {t('answerCatalog.sources.rows', 'Rows')}</Badge>
                  <Badge variant="outline">{connectorPreview.sample.source_type.toUpperCase()}</Badge>
                </div>
                <div className="flex flex-wrap gap-1">
                  {connectorPreview.sample.columns.map((column) => (
                    <Badge key={column} variant="outline">{column}</Badge>
                  ))}
                </div>
                <div className="grid gap-2 md:grid-cols-2">
                  <PreviewList
                    title={t('answerCatalog.sources.mappingFields', 'Mapped Fields')}
                    items={Object.entries(connectorPreview.mapping).map(([target, source]) => `${target}: ${source}`)}
                  />
                  <PreviewList
                    title={t('answerCatalog.sources.guidanceColumns', 'Finding Hint Columns')}
                    items={connectorPreview.guidance_columns}
                  />
                </div>
                {connectorPreview.sample.warnings.length > 0 && (
                  <PreviewList title={t('common.warnings', 'Warnings')} items={connectorPreview.sample.warnings} />
                )}
              </div>
            ) : (
              <div className="rounded-md border border-dashed bg-background p-3 text-sm text-muted-foreground">
                {t('answerCatalog.sources.connectorPreviewHint', 'Preview a connector to inspect detected columns, answer mapping, and finding hint fields before creating answer candidates.')}
              </div>
            )}
          </div>
        </div>
          </div>
        )}
      </div>
          </div>
        </DialogContent>
      </Dialog>

      <div className="order-2 grid gap-4 xl:grid-cols-[380px_1fr]">
        <div className="rounded-md border p-4">
          <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="flex items-center gap-2">
                <FileTextIcon className="h-4 w-4" />
                <div className="font-semibold">{t('answerCatalog.sources.sourceSetup', 'Quick Source Add')}</div>
              </div>
              <p className="mt-1 text-xs leading-5 text-muted-foreground">
                {t('answerCatalog.sources.quickSourcePanelDesc', 'Paste or load a source directly. This is the normal starting point for one-off FAQ answer candidate creation.')}
              </p>
            </div>
            <Badge variant="outline">{t('answerCatalog.sources.basicBadge', 'Basic')}</Badge>
          </div>
          <div className="grid gap-4">
            <div className="grid gap-2">
              <Label>{t('answerCatalog.sources.sourceType', 'Original Input Method')}</Label>
              <Select
                value={sourceType}
                onValueChange={(value) => {
                  const nextType = value as SourceType
                  setSourceType(nextType)
                  setContentFormat(sourceFormat[nextType])
                  setCandidate(null)
                  if (nextType !== 'excel') {
                    setExcelFile(null)
                    setExcelPreview(null)
                    setExcelSheetName('')
                  }
                }}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="plain">{t('answerCatalog.sources.types.plain', 'Plain Text')}</SelectItem>
                  <SelectItem value="markdown">{t('answerCatalog.sources.types.markdown', 'Markdown')}</SelectItem>
                  <SelectItem value="html">{t('answerCatalog.sources.types.html', 'HTML')}</SelectItem>
                  <SelectItem value="url">{t('answerCatalog.sources.types.url', 'URL')}</SelectItem>
                  <SelectItem value="file">{t('answerCatalog.sources.types.file', 'Text File')}</SelectItem>
                  <SelectItem value="excel">{t('answerCatalog.sources.types.excel', 'Excel Workbook')}</SelectItem>
                  <SelectItem value="structured">{t('answerCatalog.sources.types.structured', 'Structured Sample')}</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs leading-5 text-muted-foreground">{sourceHelp}</p>
            </div>

            {(sourceType === 'url' || sourceType === 'structured') && (
              <div className="grid gap-2">
                <Label>{t('answerCatalog.sources.sourceUri', 'Source Location')}</Label>
                <Input
                  value={sourceUri}
                  onChange={(event) => setSourceUri(event.target.value)}
                  placeholder={sourceType === 'url' ? 'https://example.com/faq' : 'db://table/key 또는 collection/id'}
                />
              </div>
            )}

            {sourceType === 'file' && (
              <div className="grid gap-2">
                <Label>{t('answerCatalog.sources.file', 'File')}</Label>
                <Input type="file" accept=".txt,.md,.markdown,.html,.htm,.json,.csv" onChange={handleFileChange} />
                {fileName && <div className="text-xs text-muted-foreground">{fileName}</div>}
              </div>
            )}

            {sourceType === 'excel' && (
              <div className="grid gap-3 rounded-md border bg-muted/10 p-3">
                <div className="grid gap-2">
                  <Label>{t('answerCatalog.sources.excelFile', 'Excel File')}</Label>
                  <Input type="file" accept=".xlsx,.xlsm,.xltx,.xltm" onChange={handleExcelFileChange} />
                  <div className="text-xs leading-5 text-muted-foreground">
                    {t('answerCatalog.sources.excelLimitHelp', 'Supported formats: .xlsx, .xlsm, .xltx, .xltm. Maximum upload size: 200MB.')}
                  </div>
                  {fileName && <div className="text-xs text-muted-foreground">{fileName}</div>}
                </div>
                {excelPreview && (
                  <>
                    <div className="grid gap-2">
                      <Label>{t('answerCatalog.sources.excelSheet', 'Sheet')}</Label>
                      <Select
                        value={excelSheetName}
                        onValueChange={(value) => {
                          setExcelSheetName(value)
                          setCandidate(null)
                        }}
                      >
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {excelPreview.sheets.map((sheet) => (
                            <SelectItem key={sheet.name} value={sheet.name}>
                              {sheet.name} ({sheet.max_row.toLocaleString()} x {sheet.max_column.toLocaleString()})
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="grid gap-2 sm:grid-cols-2">
                      <div className="grid gap-2">
                        <Label>{t('answerCatalog.sources.headerRow', 'Header Row')}</Label>
                        <Input type="number" min={1} value={excelHeaderRow} onChange={(event) => setExcelHeaderRow(event.target.value)} />
                      </div>
                      <div className="grid gap-2">
                        <Label>{t('answerCatalog.sources.dataStartRow', 'Data Start Row')}</Label>
                        <Input type="number" min={2} value={excelDataStartRow} onChange={(event) => setExcelDataStartRow(event.target.value)} />
                      </div>
                    </div>
                  </>
                )}
                <Button
                  variant="outline"
                  onClick={() => excelFile && handleExcelPreview(excelFile, { sheetName: excelSheetName })}
                  disabled={isExcelBusy || !excelFile}
                >
                  {isExcelBusy ? <Loader2Icon className="h-4 w-4 animate-spin" /> : <EyeIcon className="h-4 w-4" />}
                  {t('answerCatalog.sources.previewExcel', 'Preview Excel')}
                </Button>
              </div>
            )}

            <div className="grid gap-3 rounded-md border bg-muted/10 p-3">
              <div>
                <div className="text-sm font-semibold">{t('answerCatalog.sources.commonSettings', 'Common Settings')}</div>
                <div className="text-xs leading-5 text-muted-foreground">
                  {t('answerCatalog.sources.commonSettingsDesc', 'These settings are applied to every answer candidate created from this source.')}
                </div>
              </div>
              <div className="grid gap-2">
                <Label>{t('answerCatalog.library.tags', 'Tags')}</Label>
                <Input
                  value={tags}
                  onChange={(event) => setTags(event.target.value)}
                  placeholder={t('answerCatalog.library.tagsPlaceholder', 'billing, refund, membership')}
                />
                <div className="text-xs leading-5 text-muted-foreground">
                  {t('answerCatalog.sources.tagsHelp', 'Tags help with filtering and answer item selection. For Excel row-per-answer creation, these tags are added to every generated answer candidate. A mapped category column can also be added per row.')}
                </div>
              </div>

              <div className="grid gap-2">
                <Label>{t('answerCatalog.library.priority', 'Priority')}</Label>
                <Input type="number" value={priority} onChange={(event) => setPriority(event.target.value)} />
                <div className="text-xs leading-5 text-muted-foreground">
                  {t('answerCatalog.sources.priorityHelp', 'Priority gives a small score boost when multiple answers are similarly relevant. Use 0 for normal answers and higher values only for answers that should be preferred.')}
                </div>
              </div>
            </div>

          </div>
        </div>

        <div className="rounded-md border p-4">
          <div className="mb-4">
            <div className="flex items-center gap-2">
              <SparklesIcon className="h-4 w-4" />
              <div className="font-semibold">{t('answerCatalog.sources.materialize', 'Review Mapping and Create Answer Candidates')}</div>
            </div>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">
              {t('answerCatalog.sources.draftReviewPanelDesc', 'Review common settings, row mapping, and finding hints before creating unpublished answer candidates. Excel row-per-answer creation can create many candidates at once.')}
            </p>
          </div>
          <div className="grid gap-4">
            <ReviewStepNav
              steps={reviewSteps}
              activeStep={activeReviewStep}
              onStepChange={setActiveReviewStep}
            />

            {activeStep && (
              <div className="rounded-md border bg-muted/10 p-3 text-sm leading-6 text-muted-foreground">
                <span className="font-semibold text-foreground">{activeStep.label}</span>
                <span className="ml-2">{activeStep.description}</span>
              </div>
            )}

            {activeReviewStep === 'details' && (
              <div className="grid gap-4">
                <div className="grid gap-2">
                  <Label>
                    {sourceType === 'excel'
                      ? t('answerCatalog.sources.sourceGroupTitle', 'Source Batch Name')
                      : t('answerCatalog.library.answerTitle', 'Title')}
                  </Label>
                  <Input value={title} onChange={(event) => setTitle(event.target.value)} />
                </div>
                <div className="grid gap-2">
                  <Label>
                    {sourceType === 'excel'
                      ? t('answerCatalog.sources.sourceGroupSummary', 'Source Batch Summary')
                      : t('answerCatalog.library.summary', 'Answer Memo')}
                  </Label>
                  <Textarea rows={3} value={summary} onChange={(event) => setSummary(event.target.value)} />
                  {sourceType !== 'excel' && (
                    <p className="text-xs leading-5 text-muted-foreground">
                      {t(
                        'answerCatalog.library.summaryHelp',
                        'Internal note for approval requests, review context, or change history. It is separate from the answer body.'
                      )}
                    </p>
                  )}
                </div>
                {sourceType === 'excel' && (
                  <div className="rounded-md border bg-emerald-50/50 p-3 text-xs leading-5 text-emerald-950 dark:bg-emerald-950/10 dark:text-emerald-50">
                    {t('answerCatalog.sources.excelDetailsHelp', 'These fields name the source batch and are stored in the source record. Individual answer titles, bodies, categories, status, validity dates, and finding hints are filled from the row mapping step.')}
                  </div>
                )}
                {sourceType !== 'excel' && (
                  <div className="grid gap-2">
                    <Label>{t('answerCatalog.sources.sourceBody', 'Source Content / Answer Body')}</Label>
                    <Textarea className="min-h-56" value={body} onChange={(event) => {
                      setBody(event.target.value)
                      setCandidate(null)
                    }} />
                  </div>
                )}
              </div>
            )}
            {activeReviewStep === 'preview' && sourceType !== 'excel' && (
              <div className="grid gap-4">
                <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border bg-muted/10 p-4">
                  <div>
                    <div className="text-sm font-semibold">
                      {t('answerCatalog.sources.optionalPreviewTitle', 'Optional Source Preview')}
                    </div>
                    <div className="mt-1 text-xs leading-5 text-muted-foreground">
                      {t('answerCatalog.sources.optionalPreviewDesc', 'Preview analyzes the source before creation. You can skip this step; creation will run the same analysis automatically.')}
                    </div>
                  </div>
                  <Button variant="outline" onClick={() => handleAnalyzeSource()}>
                    <EyeIcon className="h-4 w-4" />
                    {candidate
                      ? t('answerCatalog.sources.refreshPreview', 'Refresh Preview')
                      : t('answerCatalog.sources.preview', 'Preview Source')}
                  </Button>
                </div>

                {candidate ? (
                  <div className="grid gap-3 rounded-md border bg-muted/20 p-4">
                    <div className="flex flex-wrap items-center gap-2">
                      <SparklesIcon className="h-4 w-4" />
                      <div className="font-semibold">{t('answerCatalog.sources.previewTitle', 'Review Candidate')}</div>
                      <Badge variant="outline">{candidate.profile.structured.kind}</Badge>
                    </div>
                    <div className="grid gap-2 md:grid-cols-4">
                      <Metric label={t('answerCatalog.sources.characters', 'Characters')} value={candidate.profile.charCount} />
                      <Metric label={t('answerCatalog.sources.lines', 'Lines')} value={candidate.profile.lineCount} />
                      <Metric label={t('answerCatalog.sources.tokens', 'Tokens')} value={candidate.profile.tokenCount} />
                      <Metric label={t('answerCatalog.sources.rows', 'Rows')} value={candidate.profile.structured.rowCount} />
                    </div>
                    {(candidate.profile.headings.length > 0 || candidate.profile.keywords.length > 0) && (
                      <div className="grid gap-3 md:grid-cols-2">
                        <PreviewList title={t('answerCatalog.sources.detectedHeadings', 'Detected Headings')} items={candidate.profile.headings} />
                        <PreviewList title={t('answerCatalog.sources.detectedKeywords', 'Detected Keywords')} items={candidate.profile.keywords} />
                      </div>
                    )}
                    {candidate.profile.structured.columns.length > 0 && (
                      <div className="rounded-md border bg-background p-3">
                        <div className="mb-2 text-sm font-medium">{t('answerCatalog.sources.structuredProfile', 'Structure Analysis')}</div>
                        <div className="flex flex-wrap gap-1">
                          {candidate.profile.structured.columns.map((column) => (
                            <Badge key={column} variant="outline">{column}</Badge>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="rounded-md border border-dashed p-4 text-sm leading-6 text-muted-foreground">
                    {t('answerCatalog.sources.previewOptionalHint', 'No preview has been generated yet. Continue to finding hints if you want to create directly, or preview now to inspect detected keywords and structure.')}
                  </div>
                )}
              </div>
            )}
            {activeReviewStep === 'mapping' && sourceType === 'excel' && excelPreview && (
              <div className="grid gap-4 rounded-md border bg-muted/10 p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <div className="text-sm font-semibold">{t('answerCatalog.sources.excelMappingTitle', 'Excel Row Mapping')}</div>
                    <div className="text-xs leading-5 text-muted-foreground">
                      {t('answerCatalog.sources.excelMappingDesc', 'Choose which Excel columns become each answer candidate field. Common tags and priority are applied to every generated candidate.')}
                    </div>
                  </div>
                  <Badge variant="outline">{excelPreview.row_count.toLocaleString()} {t('answerCatalog.sources.rows', 'Rows')}</Badge>
                </div>
                <div className="grid gap-3 md:grid-cols-3">
                  <Metric label={t('answerCatalog.sources.previewRowsLoaded', 'Rows loaded')} value={excelPreview.row_count} />
                  <Metric label={t('answerCatalog.sources.previewColumnsDetected', 'Columns detected')} value={excelPreview.columns.length} />
                  <Metric label={t('answerCatalog.sources.previewSampleRows', 'Sample rows')} value={excelPreview.profile.sample_rows.length} />
                </div>
                <ExcelPreviewResult preview={excelPreview} />
                <div className="grid gap-3 rounded-md border bg-background p-3">
                  <div>
                    <div className="text-sm font-semibold">{t('answerCatalog.sources.rowAnswerFields', 'Row Answer Fields')}</div>
                    <div className="text-xs leading-5 text-muted-foreground">
                      {t('answerCatalog.sources.rowAnswerFieldsDesc', 'These mappings are applied row by row. One row becomes one answer candidate when row-per-answer mode is selected.')}
                    </div>
                  </div>
                  <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-5">
                    {structuredAnswerMappingRoles.map((role) => (
                      <StructuredMappingSelect
                        key={role}
                        role={role}
                        columns={excelPreview.columns}
                        value={structuredMapping[role] || 'none'}
                        onChange={(value) => updateStructuredMapping(role, value)}
                      />
                    ))}
                  </div>
                </div>
                <div className="grid gap-3 rounded-md border bg-background p-3">
                  <div>
                    <div className="text-sm font-semibold">{t('answerCatalog.sources.rowPolicyFields', 'Row Policy Fields')}</div>
                    <div className="text-xs leading-5 text-muted-foreground">
                      {t('answerCatalog.sources.rowPolicyFieldsDesc', 'Optional row-level policy mappings. If a column is not selected, every generated answer candidate is created as draft with no validity date.')}
                    </div>
                  </div>
                  <div className="grid gap-2 md:grid-cols-3">
                    {structuredPolicyMappingRoles.map((role) => (
                      <StructuredMappingSelect
                        key={role}
                        role={role}
                        columns={excelPreview.columns}
                        value={structuredMapping[role] || 'none'}
                        onChange={(value) => updateStructuredMapping(role, value)}
                      />
                    ))}
                  </div>
                </div>
                <ExcelAnswerMappingPreview
                  preview={excelPreview}
                  mapping={structuredMapping}
                  guidanceColumns={structuredGuidanceColumns}
                  baseTitle={title}
                />
                <div className="grid gap-2">
                  <Label>{t('answerCatalog.sources.guidanceColumns', 'Finding Hint Columns')}</Label>
                  <div className="flex flex-wrap gap-2">
                    {excelPreview.columns.map((column) => {
                      const isMapped = Object.values(structuredMapping).includes(column)
                      return (
                        <label key={column} className="flex items-center gap-2 rounded-md border bg-background px-3 py-2 text-xs">
                          <Checkbox
                            checked={structuredGuidanceColumns.includes(column)}
                            disabled={isMapped}
                            onCheckedChange={(checked) => toggleStructuredGuidanceColumn(column, checked === true)}
                          />
                          <span className={isMapped ? 'text-muted-foreground' : ''}>{column}</span>
                        </label>
                      )
                    })}
                  </div>
                  <div className="text-xs leading-5 text-muted-foreground">
                    {t('answerCatalog.sources.guidanceColumnsHelp', 'Finding hint columns are added to each row as keyword hints. Columns already used as answer fields or policy fields are disabled.')}
                  </div>
                </div>
                <div className="grid gap-2">
                  <Label>{t('answerCatalog.sources.creationMode', 'Creation Mode')}</Label>
                  <Select value={structuredMode} onValueChange={(value) => setStructuredMode(value as ConnectorMaterializationMode)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="row_per_answer">{t('answerCatalog.sources.connectorModeRows', 'One answer candidate per row')}</SelectItem>
                      <SelectItem value="table_as_dataset">{t('answerCatalog.sources.connectorModeDataset', 'Whole table as one dataset answer candidate')}</SelectItem>
                    </SelectContent>
                  </Select>
                  <div className="rounded-md border bg-background p-2 text-xs leading-5 text-muted-foreground">
                    {structuredMode === 'row_per_answer'
                      ? t('answerCatalog.sources.rowPerAnswerModeHelp', '{{count}} answer candidate(s) will be created. An answer candidate is one unpublished answer that can be reviewed and published later.', { count: excelPreview.row_count.toLocaleString() })
                      : t('answerCatalog.sources.tableAsDatasetModeHelp', 'One dataset answer candidate will be created from the whole table. Use this when you want to query the table as structured data instead of creating FAQ answers per row.')}
                  </div>
                  {structuredMode === 'row_per_answer' && excelPreview.row_count > maxStructuredRowsPerAnswerBatch && (
                    <div className="rounded-md border border-amber-200 bg-amber-50 p-2 text-xs leading-5 text-amber-800">
                      {t('answerCatalog.sources.excelRowLimit', 'Row-per-answer candidate creation currently supports up to 1000 rows. Use one dataset answer candidate or reduce the selected sheet.')}
                    </div>
                  )}
                </div>
                {(excelPreview.warnings.length > 0 || excelPreview.profile.warnings.length > 0) && (
                  <PreviewList
                    title={t('common.warnings', 'Warnings')}
                    items={unique([...excelPreview.warnings, ...excelPreview.profile.warnings])}
                  />
                )}
              </div>
            )}
            {activeReviewStep === 'hints' && sourceType === 'excel' && excelPreview ? (
              <ExcelFindingHintSummary
                mapping={structuredMapping}
                guidanceColumns={structuredGuidanceColumns}
                rowCount={excelPreview.row_count}
              />
            ) : activeReviewStep === 'hints' ? (
              <div className="grid gap-4">
                <div className="grid gap-2">
                  <Label>{t('answerCatalog.library.guidance', 'Representative Questions / Keywords')}</Label>
                  <Textarea
                    rows={4}
                    value={guidance}
                    onChange={(event) => setGuidance(event.target.value)}
                    placeholder={t('answerCatalog.library.guidancePlaceholder', 'How do I get a refund?\nCancel payment\nrefund policy')}
                  />
                </div>

                <div className="rounded-md border bg-muted/20 p-4">
                  <div className="mb-3 flex items-center justify-between gap-2">
                    <div>
                      <div className="text-sm font-medium">{t('answerCatalog.sources.guidanceCandidates', 'Finding Hint Candidates')}</div>
                      <div className="mt-1 text-xs leading-5 text-muted-foreground">
                        {candidate
                          ? t('answerCatalog.sources.guidanceCandidateDesc', 'These hints came from the optional preview. You can edit them before creating answer candidates.')
                          : t('answerCatalog.sources.guidanceCandidateWithoutPreviewDesc', 'Preview has not been run. Add manual hints here, or continue and the source will be analyzed automatically during creation.')}
                      </div>
                    </div>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setGuidanceCandidates((items) => [...items, { guidance_type: 'keyword', text: '', weight: 1, source: 'manual' }])}
                    >
                      <PlusIcon className="h-4 w-4" />
                      {t('common.add', 'Add')}
                    </Button>
                  </div>
                  <div className="grid gap-2">
                    {guidanceCandidates.length === 0 ? (
                      <div className="text-sm text-muted-foreground">
                        {t('answerCatalog.library.noGuidance', 'No matching hints are registered.')}
                      </div>
                    ) : (
                      guidanceCandidates.map((item, index) => (
                        <div key={`${item.source}-${index}`} className="grid gap-2 md:grid-cols-[150px_1fr_90px_40px]">
                          <Select
                            value={item.guidance_type}
                            onValueChange={(value) => updateGuidanceCandidate(index, { guidance_type: value as AnswerGuidanceType })}
                          >
                            <SelectTrigger><SelectValue /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="question">{t('answerCatalog.guidanceTypes.question', 'Question')}</SelectItem>
                              <SelectItem value="keyword">{t('answerCatalog.guidanceTypes.keyword', 'Keyword')}</SelectItem>
                              <SelectItem value="synonym">{t('answerCatalog.guidanceTypes.synonym', 'Synonym')}</SelectItem>
                              <SelectItem value="negative_keyword">{t('answerCatalog.guidanceTypes.negative_keyword', 'Negative')}</SelectItem>
                              <SelectItem value="note">{t('answerCatalog.guidanceTypes.note', 'Note')}</SelectItem>
                            </SelectContent>
                          </Select>
                          <Input value={item.text} onChange={(event) => updateGuidanceCandidate(index, { text: event.target.value })} />
                          <Input
                            type="number"
                            step="0.1"
                            value={item.weight}
                            onChange={(event) => updateGuidanceCandidate(index, { weight: Number(event.target.value) || 1 })}
                          />
                          <Button
                            size="icon"
                            variant="ghost"
                            onClick={() => setGuidanceCandidates((items) => items.filter((_, itemIndex) => itemIndex !== index))}
                          >
                            <Trash2Icon className="h-4 w-4 text-red-500" />
                          </Button>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              </div>
            ) : null}

            {activeReviewStep === 'confirm' && (
              <div className="grid gap-4">
                <div className="grid gap-3 md:grid-cols-3">
                  <Metric
                    label={t('answerCatalog.sources.confirmSourceType', 'Source Type')}
                    value={0}
                    displayValue={t(`answerCatalog.sources.types.${sourceType}`, sourceType)}
                  />
                  <Metric
                    label={t('answerCatalog.sources.confirmDraftCount', 'Drafts to Create')}
                    value={estimatedDraftCount}
                  />
                  <Metric
                    label={t('answerCatalog.sources.confirmHints', 'Hint Basis')}
                    value={estimatedHintBasisCount}
                  />
                </div>
                {exceedsExcelRowLimit && (
                  <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm leading-6 text-amber-800">
                    {t('answerCatalog.sources.excelRowLimit', 'Row-per-answer candidate creation currently supports up to 1000 rows. Use one dataset answer candidate or reduce the selected sheet.')}
                  </div>
                )}
                <div className="rounded-md border bg-muted/10 p-4">
                  {createdAnswer ? (
                    <div className="flex min-w-0 items-center gap-2 text-sm text-muted-foreground">
                      <CheckCircle2Icon className="h-4 w-4 text-green-600" />
                      <span className="truncate">{createdAnswer.title}</span>
                      <Badge variant="outline">{createdAnswer.answer_id}</Badge>
                    </div>
                  ) : (
                    <div className="grid gap-2 text-sm leading-6 text-muted-foreground">
                      <div>{t('answerCatalog.sources.reviewHint', 'Answer candidates are created unpublished so they can be reviewed before serving.')}</div>
                      {sourceType !== 'excel' && !candidate && (
                        <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-amber-800">
                          {t('answerCatalog.sources.autoPreviewOnCreateHint', 'Source preview was skipped. The source will be analyzed automatically when candidates are created.')}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            )}

            <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-4">
              <Button
                variant="outline"
                onClick={() => goToRelativeReviewStep(-1)}
                disabled={!canGoPreviousStep}
              >
                {t('answerCatalog.sources.previousStep', 'Previous Step')}
              </Button>
              {canGoNextStep ? (
                <Button
                  onClick={() => goToRelativeReviewStep(1)}
                  disabled={nextReviewStep?.disabled}
                >
                  {t('answerCatalog.sources.nextStep', 'Next Step')}
                </Button>
              ) : (
                <Button onClick={handleCreateDraft} disabled={!canCreateDraft}>
                  {isSubmitting ? <Loader2Icon className="h-4 w-4 animate-spin" /> : <PlusIcon className="h-4 w-4" />}
                  {t('answerCatalog.sources.createDraft', 'Create Answer Candidates')}
                </Button>
              )}
            </div>
          </div>
        </div>
      </div>

    </div>
  )
}

function Metric({ label, value, displayValue }: { label: string; value: number; displayValue?: string }) {
  return (
    <div className="rounded-md border bg-background p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 text-lg font-semibold">{displayValue || value.toLocaleString()}</div>
    </div>
  )
}

function ReviewStepNav({
  steps,
  activeStep,
  onStepChange,
}: {
  steps: ReviewStepItem[]
  activeStep: ReviewStep
  onStepChange: (step: ReviewStep) => void
}) {
  return (
    <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
      {steps.map((step) => {
        const isActive = step.id === activeStep
        return (
          <button
            key={step.id}
            type="button"
            disabled={step.disabled}
            onClick={() => onStepChange(step.id)}
            className={`min-h-24 rounded-md border p-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 ${
              isActive
                ? 'border-emerald-500 bg-emerald-50 text-emerald-950 dark:bg-emerald-950/20 dark:text-emerald-50'
                : 'bg-background hover:border-emerald-300 hover:bg-emerald-50/60 dark:hover:bg-emerald-950/10'
            } ${step.disabled ? 'cursor-not-allowed opacity-50 hover:border-border hover:bg-background' : ''}`}
          >
            <div className="text-sm font-semibold">{step.label}</div>
            <div className="mt-1 line-clamp-2 text-xs leading-5 text-muted-foreground">{step.description}</div>
          </button>
        )
      })}
    </div>
  )
}

function SourceGuideHint({
  label,
  title,
  description,
}: {
  label: string
  title: string
  description: string
}) {
  return (
    <TooltipProvider delayDuration={150}>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            className="inline-flex h-7 items-center gap-1.5 rounded-md border bg-background px-2 text-xs text-muted-foreground transition-colors hover:border-emerald-300 hover:bg-emerald-50 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 dark:hover:bg-emerald-950/20"
            aria-label={`${label}: ${title}`}
          >
            <HelpCircleIcon className="h-3.5 w-3.5" />
            <span className="font-medium text-foreground">{label}</span>
          </button>
        </TooltipTrigger>
        <TooltipContent side="bottom" align="start" className="max-w-sm">
          <div className="space-y-1">
            <div className="text-sm font-semibold">{title}</div>
            <div className="text-xs leading-5 text-muted-foreground">{description}</div>
          </div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}

const asObject = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}

const asStringArray = (value: unknown) =>
  Array.isArray(value) ? value.map((item) => String(item)).filter(Boolean) : []

const asNumber = (value: unknown) => {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

const formatSnapshotValue = (value: unknown) => {
  if (value === null || value === undefined || value === '') return ''
  if (typeof value === 'boolean') return value ? 'true' : 'false'
  if (typeof value === 'number') return value.toLocaleString()
  if (typeof value === 'string') return value
  return JSON.stringify(value)
}

function SourceSnapshotHistory({
  snapshots,
  isLoading,
  onRefresh,
}: {
  snapshots: AnswerSourceSnapshot[]
  isLoading: boolean
  onRefresh: () => void
}) {
  const { t } = useTranslation()
  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="font-semibold">{t('answerCatalog.sources.snapshotHistory', 'Source Processing Records')}</div>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">
            {t('answerCatalog.sources.snapshotHistoryDesc', 'Review which source created answer candidates, how it was mapped, and what source snapshot was stored for audit.')}
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={onRefresh} disabled={isLoading}>
          {isLoading ? <Loader2Icon className="h-4 w-4 animate-spin" /> : <EyeIcon className="h-4 w-4" />}
          {t('common.refresh', 'Refresh')}
        </Button>
      </div>

      {snapshots.length === 0 ? (
        <div className="rounded-md border border-dashed bg-background p-4 text-sm text-muted-foreground">
          {t('answerCatalog.sources.noSnapshots', 'No source processing records have been recorded yet.')}
        </div>
      ) : (
        <div className="grid gap-3">
          {snapshots.map((snapshot) => (
            <SourceSnapshotCard key={snapshot.snapshot_id} snapshot={snapshot} />
          ))}
        </div>
      )}
    </div>
  )
}

function SourceSnapshotCard({ snapshot }: { snapshot: AnswerSourceSnapshot }) {
  const { t } = useTranslation()
  const profile = asObject(snapshot.profile)
  const structured = asObject(profile.structured)
  const metadata = asObject(snapshot.metadata)
  const columns = asStringArray(structured.columns)
  const mapping = asObject(structured.mapping)
  const mappingItems = Object.entries(mapping)
    .map(([role, column]) => [role, formatSnapshotValue(column)] as const)
    .filter(([, column]) => Boolean(column))
  const guidanceColumns = asStringArray(structured.guidance_columns)
  const rowCount = asNumber(structured.row_count ?? structured.rowCount)
  const answerIds = snapshot.created_answer_ids || []
  const visibleAnswerIds = answerIds.slice(0, 8)
  const metadataItems = Object.entries(metadata)
    .filter(([key, value]) => !['source_profile', 'raw_content'].includes(key) && formatSnapshotValue(value))
    .slice(0, 12)
  const title = snapshot.title || snapshot.file_name || snapshot.source_uri || snapshot.snapshot_id
  const sourcePath = snapshot.file_name || snapshot.source_uri || '-'
  const createdAt = snapshot.create_time ? new Date(snapshot.create_time).toLocaleString() : '-'

  return (
    <div className="rounded-md border bg-background p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline">{snapshot.source_type}</Badge>
            <Badge variant="outline">{snapshot.status}</Badge>
            {structured.kind && <Badge variant="outline">{formatSnapshotValue(structured.kind)}</Badge>}
          </div>
          <div className="mt-2 truncate text-sm font-semibold" title={title}>
            {title}
          </div>
          <div className="mt-1 truncate font-mono text-xs text-muted-foreground">
            {snapshot.snapshot_id}
          </div>
        </div>
        <div className="text-right text-xs text-muted-foreground">
          <div>{createdAt}</div>
          <div className="mt-1 font-mono">{snapshot.content_hash.slice(0, 12)}</div>
        </div>
      </div>

      <div className="mt-4 grid gap-2 md:grid-cols-2 xl:grid-cols-4">
        <SnapshotMetric label={t('answerCatalog.sources.snapshotCreatedAnswers', 'Created Answers')} value={answerIds.length.toLocaleString()} />
        <SnapshotMetric label={t('answerCatalog.sources.snapshotContentLength', 'Source Size')} value={`${snapshot.content_length.toLocaleString()} chars`} />
        <SnapshotMetric label={t('answerCatalog.sources.snapshotRows', 'Rows')} value={rowCount ? rowCount.toLocaleString() : '-'} />
        <SnapshotMetric label={t('answerCatalog.sources.snapshotColumns', 'Columns')} value={columns.length ? columns.length.toLocaleString() : '-'} />
      </div>

      <div className="mt-4 grid gap-3 lg:grid-cols-2">
        <SnapshotField label={t('answerCatalog.sources.snapshotSource', 'Source')} value={sourcePath} />
        <SnapshotField label={t('answerCatalog.sources.snapshotTask', 'Task')} value={snapshot.task_id || '-'} />
      </div>

      {(mappingItems.length > 0 || guidanceColumns.length > 0 || columns.length > 0) && (
        <div className="mt-4 grid gap-3 lg:grid-cols-3">
          <SnapshotPillList
            title={t('answerCatalog.sources.snapshotMapping', 'Field Mapping')}
            items={mappingItems.map(([role, column]) => `${t(`answerCatalog.sources.mappingRoles.${role}`, role)}: ${column}`)}
          />
          <SnapshotPillList
            title={t('answerCatalog.sources.snapshotGuidanceColumns', 'Finding Hint Columns')}
            items={guidanceColumns}
          />
          <SnapshotPillList
            title={t('answerCatalog.sources.snapshotDetectedColumns', 'Detected Columns')}
            items={columns.slice(0, 16)}
            overflowCount={Math.max(columns.length - 16, 0)}
          />
        </div>
      )}

      <div className="mt-4 grid gap-2">
        <details className="rounded-md border bg-muted/10 p-3">
          <summary className="cursor-pointer text-sm font-medium">
            {t('answerCatalog.sources.snapshotAnswerIds', 'Created Answer IDs')} ({answerIds.length.toLocaleString()})
          </summary>
          <div className="mt-3 flex flex-wrap gap-1">
            {visibleAnswerIds.length === 0 ? (
              <span className="text-xs text-muted-foreground">-</span>
            ) : visibleAnswerIds.map((answerId) => (
              <Badge key={answerId} variant="outline" className="font-mono">{answerId}</Badge>
            ))}
            {answerIds.length > visibleAnswerIds.length && (
              <Badge variant="outline">
                {t('answerCatalog.sources.snapshotMoreAnswers', '+{{count}} more', { count: answerIds.length - visibleAnswerIds.length })}
              </Badge>
            )}
          </div>
        </details>

        <details className="rounded-md border bg-muted/10 p-3">
          <summary className="cursor-pointer text-sm font-medium">
            {t('answerCatalog.sources.snapshotPreview', 'Stored Source Preview')}
          </summary>
          <pre className="mt-3 max-h-48 overflow-auto whitespace-pre-wrap rounded-md bg-background p-3 text-xs leading-5 text-muted-foreground">
            {snapshot.content_preview || '-'}
          </pre>
        </details>

        <details className="rounded-md border bg-muted/10 p-3">
          <summary className="cursor-pointer text-sm font-medium">
            {t('answerCatalog.sources.snapshotMetadata', 'Processing Metadata')}
          </summary>
          {metadataItems.length === 0 ? (
            <div className="mt-3 text-xs text-muted-foreground">
              {t('answerCatalog.sources.snapshotNoMetadata', 'No additional metadata was stored.')}
            </div>
          ) : (
            <div className="mt-3 grid gap-2 md:grid-cols-2">
              {metadataItems.map(([key, value]) => (
                <SnapshotField key={key} label={key} value={formatSnapshotValue(value)} />
              ))}
            </div>
          )}
        </details>
      </div>
    </div>
  )
}

function SnapshotMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border bg-muted/10 p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 truncate text-sm font-semibold" title={value}>{value}</div>
    </div>
  )
}

function SnapshotField({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 rounded-md border bg-background p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 truncate font-mono text-xs" title={value}>{value}</div>
    </div>
  )
}

function SnapshotPillList({
  title,
  items,
  overflowCount = 0,
}: {
  title: string
  items: string[]
  overflowCount?: number
}) {
  return (
    <div className="rounded-md border bg-muted/10 p-3">
      <div className="mb-2 text-xs font-medium text-muted-foreground">{title}</div>
      <div className="flex flex-wrap gap-1">
        {items.length === 0 ? (
          <span className="text-xs text-muted-foreground">-</span>
        ) : items.map((item) => (
          <Badge key={item} variant="outline" className="max-w-full truncate" title={item}>{item}</Badge>
        ))}
        {overflowCount > 0 && <Badge variant="outline">+{overflowCount.toLocaleString()}</Badge>}
      </div>
    </div>
  )
}

function StructuredMappingSelect({
  role,
  columns,
  value,
  onChange,
}: {
  role: StructuredMappingRole
  columns: string[]
  value: string
  onChange: (value: string) => void
}) {
  const { t } = useTranslation()
  return (
    <div className="grid gap-1">
      <Label>{t(`answerCatalog.sources.mappingRoles.${role}`, role)}</Label>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem value="none">{t('common.none', 'None')}</SelectItem>
          {columns.map((column) => (
            <SelectItem key={column} value={column}>{column}</SelectItem>
          ))}
        </SelectContent>
      </Select>
      <div className="min-h-8 text-xs leading-4 text-muted-foreground">
        {t(`answerCatalog.sources.mappingRoleHelp.${role}`, '')}
      </div>
    </div>
  )
}

function ExcelAnswerMappingPreview({
  preview,
  mapping,
  guidanceColumns,
  baseTitle,
}: {
  preview: AnswerExcelPreviewResponse
  mapping: Partial<Record<StructuredMappingRole, string>>
  guidanceColumns: string[]
  baseTitle: string
}) {
  const { t } = useTranslation()
  const sampleRows = preview.profile.sample_rows.slice(0, 3)
  const valueForRole = (row: Record<string, unknown>, role: StructuredMappingRole) => {
    const column = mapping[role]
    if (!column) return ''
    const value = row[column]
    if (value === null || value === undefined) return ''
    return String(value).trim()
  }
  const formatValue = (value: string) => value || '-'
  const rowTitle = (row: Record<string, unknown>, index: number) =>
    valueForRole(row, 'title')
    || valueForRole(row, 'question')
    || valueForRole(row, 'id')
    || `${baseTitle || preview.file_name} #${index + 1}`
  const hintBasis = [
    mapping.question && t('answerCatalog.sources.mappingRoles.question', 'Representative Question'),
    mapping.title && t('answerCatalog.sources.mappingRoles.title', 'Title'),
    mapping.category && t('answerCatalog.sources.mappingRoles.category', 'Category'),
    mapping.answer && t('answerCatalog.sources.mappingRoles.answer', 'Answer Body'),
    ...guidanceColumns,
  ].filter(Boolean) as string[]

  return (
    <div className="grid gap-3 rounded-md border bg-background p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <div className="text-sm font-semibold">{t('answerCatalog.sources.rowPreviewTitle', 'Row Mapping Preview')}</div>
          <div className="mt-1 text-xs leading-5 text-muted-foreground">
            {t('answerCatalog.sources.rowPreviewDesc', 'This preview shows how sample rows will become answer candidates. It does not create answers yet.')}
          </div>
        </div>
        <Badge variant="outline">
          {t('answerCatalog.sources.hintBasisCount', '{{count}} hint basis fields', { count: hintBasis.length })}
        </Badge>
      </div>
      <div className="overflow-x-auto rounded-md border">
        <table className="min-w-full divide-y text-xs">
          <thead className="bg-muted/40">
            <tr>
              <th className="whitespace-nowrap px-3 py-2 text-left font-medium">{t('answerCatalog.sources.sourceRow', 'Source Row')}</th>
              <th className="min-w-48 px-3 py-2 text-left font-medium">{t('answerCatalog.sources.mappingRoles.title', 'Title')}</th>
              <th className="min-w-48 px-3 py-2 text-left font-medium">{t('answerCatalog.sources.mappingRoles.question', 'Representative Question')}</th>
              <th className="min-w-64 px-3 py-2 text-left font-medium">{t('answerCatalog.sources.mappingRoles.answer', 'Answer Body')}</th>
              <th className="whitespace-nowrap px-3 py-2 text-left font-medium">{t('answerCatalog.sources.mappingRoles.category', 'Category')}</th>
              <th className="whitespace-nowrap px-3 py-2 text-left font-medium">{t('answerCatalog.sources.mappingRoles.status', 'Status')}</th>
              <th className="whitespace-nowrap px-3 py-2 text-left font-medium">{t('answerCatalog.sources.validity', 'Validity')}</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {sampleRows.length === 0 ? (
              <tr>
                <td className="px-3 py-3 text-muted-foreground" colSpan={7}>
                  {t('answerCatalog.sources.noSampleRows', 'No sample rows detected.')}
                </td>
              </tr>
            ) : (
              sampleRows.map((row, index) => {
                const validFrom = valueForRole(row, 'valid_from')
                const validUntil = valueForRole(row, 'valid_until')
                return (
                  <tr key={`mapping-preview-${index}`}>
                    <td className="whitespace-nowrap px-3 py-2 align-top">
                      {preview.data_start_row + index}
                      {valueForRole(row, 'id') && (
                        <div className="mt-1 max-w-32 truncate text-muted-foreground" title={valueForRole(row, 'id')}>
                          {valueForRole(row, 'id')}
                        </div>
                      )}
                    </td>
                    <td className="max-w-72 truncate px-3 py-2 align-top" title={rowTitle(row, index)}>
                      {rowTitle(row, index)}
                    </td>
                    <td className="max-w-72 truncate px-3 py-2 align-top" title={valueForRole(row, 'question')}>
                      {formatValue(valueForRole(row, 'question'))}
                    </td>
                    <td className="max-w-96 truncate px-3 py-2 align-top" title={valueForRole(row, 'answer')}>
                      {formatValue(valueForRole(row, 'answer'))}
                    </td>
                    <td className="max-w-40 truncate px-3 py-2 align-top" title={valueForRole(row, 'category')}>
                      {formatValue(valueForRole(row, 'category'))}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 align-top">
                      {formatValue(valueForRole(row, 'status'))}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 align-top">
                      {validFrom || validUntil ? `${validFrom || '-'} ~ ${validUntil || '-'}` : '-'}
                    </td>
                  </tr>
                )
              })
            )}
          </tbody>
        </table>
      </div>
      <div className="text-xs leading-5 text-muted-foreground">
        {t('answerCatalog.sources.rowPreviewHelp', 'Generated candidates are opened later in the Answers menu for individual review and publishing.')}
      </div>
    </div>
  )
}

function ExcelFindingHintSummary({
  mapping,
  guidanceColumns,
  rowCount,
}: {
  mapping: Partial<Record<StructuredMappingRole, string>>
  guidanceColumns: string[]
  rowCount: number
}) {
  const { t } = useTranslation()
  const derivedHints = [
    mapping.question && {
      label: t('answerCatalog.sources.mappingRoles.question', 'Representative Question'),
      description: t('answerCatalog.sources.questionHintRule', 'Saved as a high-weight question hint for each row.'),
    },
    mapping.title && {
      label: t('answerCatalog.sources.mappingRoles.title', 'Title'),
      description: t('answerCatalog.sources.titleHintRule', 'Also used as a keyword hint so short title searches can find the answer.'),
    },
    mapping.category && {
      label: t('answerCatalog.sources.mappingRoles.category', 'Category'),
      description: t('answerCatalog.sources.categoryHintRule', 'Added as a tag and keyword hint for filtering and lookup.'),
    },
    mapping.answer && {
      label: t('answerCatalog.sources.mappingRoles.answer', 'Answer Body'),
      description: t('answerCatalog.sources.answerHintRule', 'Used as a low-weight note hint for context, not as a representative question.'),
    },
    ...guidanceColumns.map((column) => ({
      label: column,
      description: t('answerCatalog.sources.extraHintRule', 'Added as an additional keyword hint for each row.'),
    })),
  ].filter(Boolean) as { label: string; description: string }[]

  return (
    <div className="grid gap-4 rounded-md border bg-muted/10 p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <div className="text-sm font-semibold">{t('answerCatalog.sources.excelHintsTitle', 'Excel Finding Hint Generation')}</div>
          <div className="mt-1 text-xs leading-5 text-muted-foreground">
            {t('answerCatalog.sources.excelHintsDesc', 'For Excel row-per-answer creation, finding hints are generated from the selected columns per row. Manual shared hints are not applied because they would be copied to every generated candidate.')}
          </div>
        </div>
        <Badge variant="outline">
          {t('answerCatalog.sources.rows', 'Rows')}: {rowCount.toLocaleString()}
        </Badge>
      </div>
      <div className="grid gap-2 md:grid-cols-2">
        {derivedHints.length === 0 ? (
          <div className="rounded-md border border-dashed bg-background p-3 text-sm text-muted-foreground">
            {t('answerCatalog.sources.noExcelHintBasis', 'No finding hint columns are selected yet. Map a representative question, title, category, answer body, or extra hint column.')}
          </div>
        ) : (
          derivedHints.map((item) => (
            <div key={item.label} className="rounded-md border bg-background p-3">
              <div className="text-sm font-semibold">{item.label}</div>
              <div className="mt-1 text-xs leading-5 text-muted-foreground">{item.description}</div>
            </div>
          ))
        )}
      </div>
      <div className="rounded-md border bg-background p-3 text-xs leading-5 text-muted-foreground">
        {t('answerCatalog.sources.excelHintsReviewHelp', 'After candidates are created, each candidate can still be edited in the Answers menu. Add answer-specific synonyms or exclusions there when needed.')}
      </div>
    </div>
  )
}

function ExcelPreviewResult({ preview }: { preview: AnswerExcelPreviewResponse }) {
  const { t } = useTranslation()
  const visibleColumns = preview.columns.slice(0, 8)
  const hiddenColumnCount = Math.max(preview.columns.length - visibleColumns.length, 0)
  const sampleRows = preview.profile.sample_rows.slice(0, 5)
  const formatValue = (value: unknown) => {
    if (value === null || value === undefined || value === '') return '-'
    if (typeof value === 'object') return JSON.stringify(value)
    return String(value)
  }

  return (
    <div className="grid gap-3 rounded-md border bg-background p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <div className="text-sm font-semibold">{t('answerCatalog.sources.excelPreviewResult', 'Excel Preview Result')}</div>
          <div className="mt-1 text-xs leading-5 text-muted-foreground">
            {t('answerCatalog.sources.excelPreviewResultDesc', 'Preview reads the workbook on the server and shows detected columns, sample rows, and automatic mapping hints. Answer candidates are not created until you click Review Mapping and Create Answer Candidates.')}
          </div>
        </div>
        <div className="flex flex-wrap gap-1">
          <Badge variant="outline">{preview.selected_sheet}</Badge>
          <Badge variant="outline">
            {t('answerCatalog.sources.headerRow', 'Header Row')} {preview.header_row}
          </Badge>
          <Badge variant="outline">
            {t('answerCatalog.sources.dataStartRow', 'Data Start Row')} {preview.data_start_row}
          </Badge>
        </div>
      </div>

      <div className="overflow-x-auto rounded-md border">
        <table className="min-w-full divide-y text-xs">
          <thead className="bg-muted/40">
            <tr>
              {visibleColumns.map((column) => (
                <th key={column} className="whitespace-nowrap px-3 py-2 text-left font-medium">
                  {column}
                </th>
              ))}
              {hiddenColumnCount > 0 && (
                <th className="whitespace-nowrap px-3 py-2 text-left font-medium">
                  +{hiddenColumnCount}
                </th>
              )}
            </tr>
          </thead>
          <tbody className="divide-y">
            {sampleRows.length === 0 ? (
              <tr>
                <td className="px-3 py-3 text-muted-foreground" colSpan={Math.max(visibleColumns.length + (hiddenColumnCount > 0 ? 1 : 0), 1)}>
                  {t('answerCatalog.sources.noSampleRows', 'No sample rows detected.')}
                </td>
              </tr>
            ) : (
              sampleRows.map((row, rowIndex) => (
                <tr key={`sample-${rowIndex}`}>
                  {visibleColumns.map((column) => (
                    <td key={column} className="max-w-72 truncate px-3 py-2 align-top" title={formatValue(row[column])}>
                      {formatValue(row[column])}
                    </td>
                  ))}
                  {hiddenColumnCount > 0 && (
                    <td className="px-3 py-2 text-muted-foreground">
                      {t('answerCatalog.sources.moreColumns', '{{count}} more', { count: hiddenColumnCount })}
                    </td>
                  )}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-4">
        {preview.profile.fields.slice(0, 8).map((field) => (
          <div key={field.name} className="rounded-md border bg-muted/10 p-2">
            <div className="truncate text-xs font-medium" title={field.name}>{field.name}</div>
            <div className="mt-2 flex flex-wrap gap-1">
              <Badge variant="outline">{field.semantic_role}</Badge>
              <Badge variant="outline">{field.inferred_type}</Badge>
            </div>
            <div className="mt-2 text-xs text-muted-foreground">
              {t('answerCatalog.sources.distinctValues', 'Distinct')}: {field.distinct_count.toLocaleString()}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function PreviewList({ title, items }: { title: string; items: string[] }) {
  return (
    <div className="rounded-md border bg-background p-3">
      <div className="mb-2 text-sm font-medium">{title}</div>
      {items.length === 0 ? (
        <div className="text-xs text-muted-foreground">-</div>
      ) : (
        <div className="flex flex-wrap gap-1">
          {items.map((item) => (
            <Badge key={item} variant="outline">{item}</Badge>
          ))}
        </div>
      )}
    </div>
  )
}

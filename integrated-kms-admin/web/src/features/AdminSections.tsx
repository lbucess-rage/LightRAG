import { type ClipboardEvent, FormEvent, type KeyboardEvent, type ReactNode, useEffect, useMemo, useState } from 'react'
import { DayPicker, type DateRange } from 'react-day-picker'
import 'react-day-picker/style.css'
import { ko } from 'date-fns/locale/ko'
import {
  ArchiveIcon,
  BookOpenIcon,
  CalendarIcon,
  CheckCircleIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  ClipboardIcon,
  ClockIcon,
  DatabaseIcon,
  DownloadIcon,
  EditIcon,
  EyeOffIcon,
  FileTextIcon,
  FolderIcon,
  FolderSearchIcon,
  GlobeIcon,
  HelpCircleIcon,
  ImageIcon,
  KeyRoundIcon,
  LayersIcon,
  LinkIcon,
  NetworkIcon,
  PlusIcon,
  RefreshCwIcon,
  RotateCwIcon,
  SaveIcon,
  SearchIcon,
  ShieldIcon,
  TagIcon,
  Trash2Icon,
  UploadIcon,
  UsersIcon,
  XIcon
} from 'lucide-react'
import { api } from '@/api/client'
import TenantSelect from '@/components/TenantSelect'
import WorkspaceSelect, { modeLabel, type Workspace, type WorkspaceMode } from '@/components/WorkspaceSelect'
import Button from '@/components/ui/Button'
import Input from '@/components/ui/Input'
import Textarea from '@/components/ui/Textarea'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card'
import {
  DEFAULT_FAQ_WORKSPACE,
  DEFAULT_KMS_WORKSPACE,
  DEFAULT_TENANT_ID,
  normalizeFaqWorkspace,
  normalizeKmsWorkspace
} from '@/config'
import { RelatedHelp } from '@/features/Help'
import FaqBulkCreate from '@/features/FaqBulkCreate'
import FaqTerminologyManager from '@/features/FaqTerminologyManager'
import { selectClass } from '@/lib/form'
import { PASSWORD_MIN_LENGTH, createUserDisabledReason, passwordRuleFeedback } from '@/lib/passwordPolicy'
import { compactDateRange, deltaPercent, fillHourRows, ratio, toCountRows, type CountRow } from '@/lib/stats'
import { canChooseWorkspace, resolveEffectiveWorkspaceScope } from '@/lib/workspaceAccess'
import { useAuthStore } from '@/stores/auth'
import { useWorkspaceScopeStore } from '@/stores/workspaceScope'

type Category = {
  category_id: string
  tenant_id?: string
  parent_id: string | null
  name: string
  path: string
  sort_order: number
  is_active: boolean
  direct_knowledge_count?: number
  total_knowledge_count?: number
}

type User = {
  user_id: string
  role: string
  display_name?: string | null
  is_active: boolean
  tenant_id?: string | null
  tenant_name?: string | null
  kms_workspace?: string | null
  faq_workspace?: string | null
  last_login_at?: string | null
  create_time?: string | null
  update_time?: string | null
}

type ApiClient = {
  client_id: string
  display_name: string
  api_key_hint: string
  api_key_revealable?: boolean
  is_active: boolean
  tenant_id?: string | null
  tenant_name?: string | null
  kms_workspace: string
  faq_workspace: string
  scopes: string[]
  rate_limit_per_minute: number
  last_used_at?: string | null
  last_search_at?: string | null
  call_count?: number
  create_time?: string | null
  update_time?: string | null
}

type Tenant = {
  tenant_id: string
  name: string
  kms_workspace: string
  faq_workspace: string
  kms_workspace_exists?: boolean | null
  faq_workspace_exists?: boolean | null
  is_active: boolean
  create_time?: string | null
  update_time?: string | null
}

type ExternalSearchLog = {
  search_id: string
  query: string
  include_generative: boolean
  include_faq: boolean
  kms_workspace?: string | null
  faq_workspace?: string | null
  latency_ms?: number | null
  client_trace_id?: string | null
  result_summary?: Record<string, unknown> | null
  create_time?: string | null
}

type ExternalSearchSamplePreset = {
  key: string
  label: string
  description: string
  endpoint: 'sync' | 'stream'
  payload: Record<string, unknown>
}

type AuditHistory = {
  audit_id: string
  actor_type: string
  actor_id: string
  action: string
  target_type: string
  target_id: string
  detail?: Record<string, unknown> | null
  create_time?: string | null
}

type KmsDocument = {
  id: string
  content_summary?: string
  content_length?: number
  status?: string
  created_at?: string
  updated_at?: string
  track_id?: string
  chunks_count?: number
  error_msg?: string | null
  file_path?: string
  doc_nm?: string | null
}

type FaqAnswer = {
  answer_id: string
  title: string
  body?: string
  approved_summary?: string | null
  status: string
  version?: number
  valid_from?: string | null
  valid_until?: string | null
  priority?: number
  tags?: string[]
  update_time?: string | null
}

const KNOWLEDGE_DOCUMENT_PAGE_SIZE = 200
const KNOWLEDGE_FAQ_PAGE_SIZE = 100
const KNOWLEDGE_MAX_PAGE_FETCHES = 500

type KnowledgePageFetchOptions<T> = {
  endpoint: string
  params: URLSearchParams
  pageSize: number
  itemKey: string
  totalPages: (data: any, pageSize: number) => number | null
}

async function fetchAllKnowledgePages<T>({
  endpoint,
  params,
  pageSize,
  itemKey,
  totalPages
}: KnowledgePageFetchOptions<T>) {
  const items: T[] = []
  let lastData: any = {}
  for (let page = 1; page <= KNOWLEDGE_MAX_PAGE_FETCHES; page += 1) {
    const pageParams = new URLSearchParams(params)
    pageParams.set('page', String(page))
    pageParams.set('page_size', String(pageSize))
    const response = await api.get(`${endpoint}?${pageParams.toString()}`)
    const data = response.data || {}
    lastData = data
    const pageItems = Array.isArray(data[itemKey]) ? data[itemKey] as T[] : []
    items.push(...pageItems)
    const knownTotalPages = totalPages(data, pageSize)
    if (knownTotalPages !== null) {
      if (page >= knownTotalPages) break
    } else if (pageItems.length < pageSize) {
      break
    }
  }
  return { items, lastData }
}

const kmsDocumentTotalPages = (data: any) => {
  const value = Number(data?.pagination?.total_pages)
  return Number.isFinite(value) && value > 0 ? value : null
}

const faqAnswerTotalPages = (data: any, pageSize: number) => {
  const total = Number(data?.total)
  const effectivePageSize = Number(data?.page_size || pageSize)
  if (!Number.isFinite(total) || total <= 0 || !Number.isFinite(effectivePageSize) || effectivePageSize <= 0) {
    return null
  }
  return Math.ceil(total / effectivePageSize)
}

type FaqGuidance = {
  guidance_id: string
  answer_id: string
  workspace: string
  guidance_type: string
  text: string
  weight: number
  metadata?: Record<string, unknown>
  create_time?: string | null
}

type KnowledgeListRow = {
  id: string
  title: string
  kind: 'faq' | 'document'
  source: string
  status?: string
  category: string
  enabled: boolean
  validFrom?: string | null
  validUntil?: string | null
  metricLabel: string
  metricValue: number
  updated?: string | null
  workspace: string
  summary?: string
  job?: Job
  document?: KmsDocument
  answer?: FaqAnswer
  ledgerItem?: any
  linked?: boolean
}

type Job = {
  job_id: string
  item_id?: string | null
  job_type?: string | null
  status: string
  progress: number
  message?: string | null
  lightrag_task_id?: string | null
  rollback_status?: string | null
  knowledge_title?: string | null
  knowledge_type?: string | null
  create_time?: string | null
  update_time?: string | null
  metadata?: Record<string, unknown> | string | null
}

type JobEvent = {
  event_id?: string
  job_id: string
  event_type?: string | null
  message?: string | null
  progress?: number | null
  detail?: Record<string, unknown> | null
  create_time?: string | null
}

type StreamLog = {
  time: string
  level: 'INFO' | 'WARN' | 'ERROR'
  message: string
}

function categoryDepth(category: Category) {
  return Math.max(0, category.path.split('/').filter(Boolean).length - 1)
}

type KnowledgeSourceType =
  | 'faq'
  | 'faq_source_draft'
  | 'text'
  | 'texts'
  | 'upload'
  | 'scan'
  | 'quick_image'
  | 'url'
  | 'url_batch'
  | 'board'
  | 'multimodal'

const knowledgeSources: Array<{
  type: KnowledgeSourceType
  label: string
  workspace: 'KMS' | 'FAQ'
  description: string
  icon: typeof FileTextIcon
}> = [
  {
    type: 'faq',
    label: 'FAQ 답변',
    workspace: 'FAQ',
    description: '질문에 바로 노출할 승인형 답변을 추가합니다.',
    icon: HelpCircleIcon
  },
  {
    type: 'faq_source_draft',
    label: 'FAQ 소스 초안',
    workspace: 'FAQ',
    description: '원문과 가이드 후보를 함께 저장해 검수 가능한 답변 초안을 만듭니다.',
    icon: BookOpenIcon
  },
  {
    type: 'text',
    label: '텍스트',
    workspace: 'KMS',
    description: '짧은 본문 하나를 생성형 KMS 문서로 지식화합니다.',
    icon: FileTextIcon
  },
  {
    type: 'texts',
    label: '여러 텍스트',
    workspace: 'KMS',
    description: '여러 본문을 한 번에 문서 후보로 등록합니다.',
    icon: LayersIcon
  },
  {
    type: 'upload',
    label: '파일 업로드',
    workspace: 'KMS',
    description: 'PDF, 문서, 텍스트 파일을 LightRAG upload 경로로 전송합니다.',
    icon: UploadIcon
  },
  {
    type: 'multimodal',
    label: '멀티모달 문서',
    workspace: 'KMS',
    description: '이미지, 표, 수식이 포함된 문서를 multimodal 처리합니다.',
    icon: DatabaseIcon
  },
  {
    type: 'quick_image',
    label: '이미지',
    workspace: 'KMS',
    description: '이미지 1장을 VLM 기반 quick image 지식으로 등록합니다.',
    icon: ImageIcon
  },
  {
    type: 'url',
    label: 'URL',
    workspace: 'KMS',
    description: '웹 페이지 하나를 수집하여 문서와 멀티모달 후보로 지식화합니다.',
    icon: LinkIcon
  },
  {
    type: 'url_batch',
    label: 'URL 묶음',
    workspace: 'KMS',
    description: '여러 URL을 각각 비동기 작업으로 등록합니다.',
    icon: GlobeIcon
  },
  {
    type: 'board',
    label: '게시판 API',
    workspace: 'KMS',
    description: '외부 게시판/목록 API를 field mapping으로 수집합니다.',
    icon: DatabaseIcon
  },
  {
    type: 'scan',
    label: '입력 폴더 스캔',
    workspace: 'KMS',
    description: 'LightRAG input directory scan 작업을 실행합니다.',
    icon: FolderSearchIcon
  }
]

const knowledgeSourceGroups: Array<{ label: string; types: KnowledgeSourceType[] }> = [
  { label: '문서·텍스트', types: ['upload', 'text', 'texts', 'scan'] },
  { label: '웹·연동', types: ['url', 'url_batch', 'board'] },
  { label: '멀티모달', types: ['multimodal', 'quick_image'] },
  { label: 'FAQ', types: ['faq', 'faq_source_draft'] }
]

const knowledgeSourceApiLabels: Record<KnowledgeSourceType, string> = {
  faq: 'POST /api/answers',
  faq_source_draft: 'POST /api/answers/source-draft',
  text: 'POST /documents/text',
  texts: 'POST /documents/texts',
  upload: 'POST /documents/upload',
  scan: 'POST /documents/scan',
  quick_image: 'POST /documents/quick-image',
  url: 'POST /api/url/ingest',
  url_batch: 'POST /api/url/ingest-batch',
  board: 'POST /api/board/ingest',
  multimodal: 'POST /api/multimodal/process'
}

const initialKnowledgeForm = {
  title: '',
  body: '',
  category_id: '',
  enabled: true,
  valid_from: '',
  valid_until: '',
  file_source: '',
  urls: '',
  url: '',
  image_prompt: '',
  document_prompt: '',
  table_prompt: '',
  parser: 'pymupdf',
  board_api_url: '',
  board_method: 'GET',
  board_headers: '{}',
  board_params: '{}',
  board_body: '{}',
  board_mapping:
    '{\n  "items_path": "",\n  "title_field": "title",\n  "body_field": "content",\n  "id_field": "id",\n  "date_field": "created_at"\n}',
  faq_source_type: 'plain',
  faq_source_uri: '',
  faq_file_name: '',
  approved_summary: '',
  guidance: '',
  tags: '',
  priority: '0'
}

const initialExistingLinkForm = {
  category_id: '',
  enabled: true,
  valid_from: '',
  valid_until: '',
  include_kms: true,
  include_faq: true,
  link_all: true,
  max_items: '1000'
}

function parseJsonField(value: string, label: string) {
  if (!value.trim()) {
    return undefined
  }
  try {
    const parsed = JSON.parse(value)
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed
    }
  } catch {
    // handled below
  }
  throw new Error(`${label} 값은 JSON object 형식이어야 합니다.`)
}

function splitLines(value: string) {
  return value
    .split(/\n+/)
    .map((item) => item.trim())
    .filter(Boolean)
}

function splitTags(value: string) {
  return value
    .split(/[,#\n]+/)
    .map((item) => item.trim())
    .filter(Boolean)
}

function uniqueTags(tags: string[]) {
  const seen = new Set<string>()
  return tags.filter((tag) => {
    const key = tag.toLowerCase()
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function TagInput({
  value,
  onChange,
  placeholder = '태그 입력 후 Enter'
}: {
  value: string
  onChange: (value: string) => void
  placeholder?: string
}) {
  const [draft, setDraft] = useState('')
  const tags = useMemo(() => uniqueTags(splitTags(value)), [value])

  const applyTags = (nextTags: string[]) => {
    onChange(uniqueTags(nextTags).join(', '))
  }

  const commit = (raw = draft) => {
    const additions = splitTags(raw)
    if (!additions.length) return
    applyTags([...tags, ...additions])
    setDraft('')
  }

  const remove = (index: number) => {
    applyTags(tags.filter((_, tagIndex) => tagIndex !== index))
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if ((event.nativeEvent as { isComposing?: boolean }).isComposing) return
    if (event.key === 'Enter' || event.key === ',') {
      event.preventDefault()
      commit()
    }
    if (event.key === 'Backspace' && !draft && tags.length) {
      event.preventDefault()
      remove(tags.length - 1)
    }
  }

  const handlePaste = (event: ClipboardEvent<HTMLInputElement>) => {
    const text = event.clipboardData.getData('text')
    if (!/[,#\n]/.test(text)) return
    event.preventDefault()
    commit(text)
  }

  return (
    <div className="col" style={{ gap: 6 }}>
      <div
        className="row wrap"
        style={{
          gap: 6,
          minHeight: 38,
          padding: '5px 8px',
          border: '1px solid var(--border-default)',
          borderRadius: 'var(--radius-md)',
          background: '#fff'
        }}
      >
        {tags.map((tag, index) => (
          <span key={tag} className="badge blue" style={{ maxWidth: '100%' }}>
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{tag}</span>
            <button
              type="button"
              onClick={() => remove(index)}
              aria-label={`${tag} 삭제`}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                border: 0,
                background: 'transparent',
                color: 'inherit',
                padding: 0,
                cursor: 'pointer'
              }}
            >
              <XIcon className="size-3" />
            </button>
          </span>
        ))}
        <input
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={handleKeyDown}
          onBlur={() => commit()}
          onPaste={handlePaste}
          placeholder={tags.length ? '' : placeholder}
          aria-label="태그 입력"
          style={{
            flex: '1 1 160px',
            minWidth: 120,
            height: 26,
            border: 0,
            outline: 0,
            background: 'transparent',
            color: 'var(--fg-primary)'
          }}
        />
      </div>
      <div className="muted" style={{ fontSize: 11.5 }}>
        Enter 또는 쉼표로 추가하고, Backspace로 마지막 태그를 삭제합니다.
      </div>
    </div>
  )
}

function pad2(value: number) {
  return String(value).padStart(2, '0')
}

function parseLocalDateTime(value?: string | null) {
  if (!value) return undefined
  const [datePart, timePart = '00:00'] = value.split('T')
  const [year, month, day] = datePart.split('-').map(Number)
  const [hour = 0, minute = 0] = timePart.split(':').map(Number)
  if (!year || !month || !day) return undefined
  return new Date(year, month - 1, day, hour, minute)
}

function timePart(value: string | undefined, fallback: string) {
  return value?.split('T')[1]?.slice(0, 5) || fallback
}

function toLocalDateTimeValue(date: Date, time: string) {
  const [hour = '00', minute = '00'] = time.split(':')
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}T${hour}:${minute}`
}

function shortKoreanDateTime(value?: string) {
  const date = parseLocalDateTime(value)
  if (!date) return '제한 없음'
  return `${date.getFullYear()}.${pad2(date.getMonth() + 1)}.${pad2(date.getDate())} ${pad2(date.getHours())}:${pad2(date.getMinutes())}`
}

function formatFileSize(size: number) {
  if (size < 1024) return `${size} B`
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`
  return `${(size / 1024 / 1024).toFixed(1)} MB`
}

function FormSection({
  title,
  description,
  children
}: {
  title: string
  description?: string
  children: ReactNode
}) {
  return (
    <section className="knowledge-form-section">
      <div className="knowledge-form-section-head">
        <div className="t">{title}</div>
        {description && <div className="sub">{description}</div>}
      </div>
      <div className="knowledge-form-section-body">{children}</div>
    </section>
  )
}

function FieldHelp({ children }: { children: ReactNode }) {
  return <div className="field-help">{children}</div>
}

function PromptTextarea({
  label,
  value,
  onChange,
  placeholder,
  help
}: {
  label: string
  value: string
  onChange: (value: string) => void
  placeholder: string
  help: string
}) {
  return (
    <label className="field prompt-field">
      <span>{label}</span>
      <Textarea
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        style={{ minHeight: 104 }}
      />
      <FieldHelp>{help}</FieldHelp>
    </label>
  )
}

function DateRangeTimePicker({
  validFrom,
  validUntil,
  onChange
}: {
  validFrom: string
  validUntil: string
  onChange: (patch: { valid_from?: string; valid_until?: string }) => void
}) {
  const [open, setOpen] = useState(false)
  const fromDate = parseLocalDateTime(validFrom)
  const toDate = parseLocalDateTime(validUntil)
  const fromTime = timePart(validFrom, '00:00')
  const untilTime = timePart(validUntil, '23:59')
  const selectedRange: DateRange | undefined = fromDate || toDate ? { from: fromDate, to: toDate } : undefined

  const applyRange = (range?: DateRange) => {
    onChange({
      valid_from: range?.from ? toLocalDateTimeValue(range.from, fromTime) : '',
      valid_until: range?.to ? toLocalDateTimeValue(range.to, untilTime) : ''
    })
  }

  const applyTime = (key: 'valid_from' | 'valid_until', time: string) => {
    const currentDate = parseLocalDateTime(key === 'valid_from' ? validFrom : validUntil) || new Date()
    onChange({ [key]: toLocalDateTimeValue(currentDate, time) })
  }

  const summary = validFrom || validUntil
    ? `${shortKoreanDateTime(validFrom)} ~ ${shortKoreanDateTime(validUntil)}`
    : '기간 제한 없음'

  return (
    <div className="date-range-field">
      <button type="button" className="date-range-trigger" onClick={() => setOpen((value) => !value)}>
        <CalendarIcon className="size-4" />
        <span>{summary}</span>
        <ChevronDownIcon className="size-4" />
      </button>
      <FieldHelp>기간을 지정하지 않으면 즉시 사용 가능하며 만료일 없이 검색 후보에 포함됩니다.</FieldHelp>
      {open && (
        <div className="date-range-popover">
          <DayPicker
            mode="range"
            locale={ko}
            selected={selectedRange}
            onSelect={applyRange}
            numberOfMonths={1}
            weekStartsOn={1}
          />
          <div className="date-time-grid">
            <label className="field">
              <span>시작 시간</span>
              <Input
                type="time"
                value={fromTime}
                onChange={(event) => applyTime('valid_from', event.target.value)}
              />
            </label>
            <label className="field">
              <span>종료 시간</span>
              <Input
                type="time"
                value={untilTime}
                onChange={(event) => applyTime('valid_until', event.target.value)}
              />
            </label>
          </div>
          <div className="row" style={{ justifyContent: 'space-between', gap: 8 }}>
            <Button type="button" size="sm" variant="ghost" onClick={() => onChange({ valid_from: '', valid_until: '' })}>
              기간 해제
            </Button>
            <Button type="button" size="sm" variant="outline" onClick={() => setOpen(false)}>
              적용
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}

function apiErrorMessage(error: unknown, fallback: string) {
  const detail = (error as { response?: { data?: { detail?: unknown } } })?.response?.data?.detail
  if (typeof detail === 'string') return detail
  if (detail && typeof detail === 'object') return JSON.stringify(detail)
  if (error instanceof Error && error.message) return error.message
  return fallback
}

function badgeTone(status?: string) {
  const normalized = String(status || '').toLowerCase()
  if (['processed', 'completed', 'ready', 'published', 'success'].includes(normalized)) return 'green'
  if (['processing', 'running', 'pending', 'draft'].includes(normalized)) return 'blue'
  if (['failed', 'error', 'cancelled'].includes(normalized)) return 'red'
  if (['archived', 'expired', 'review'].includes(normalized)) return 'amber'
  return 'gray'
}

function statusLabel(status?: string) {
  const normalized = String(status || '').toLowerCase()
  const labels: Record<string, string> = {
    processed: '처리완료',
    processing: '처리중',
    pending: '대기',
    failed: '실패',
    completed: '완료',
    running: '진행중',
    cancelled: '취소',
    draft: '초안',
    published: '게시',
    archived: '보관',
    expired: '만료',
    ready: '활성'
  }
  return labels[normalized] || status || '알 수 없음'
}

function isRunningJob(job?: Pick<Job, 'status'> | null) {
  return ['pending', 'running', 'processing'].includes(String(job?.status || '').toLowerCase())
}

function jobProgressMessage(job: Job) {
  const metadata = jobMetadata(job)
  const lastTask = metadata.last_task && typeof metadata.last_task === 'object' ? metadata.last_task as Record<string, unknown> : null
  const taskMessage = typeof lastTask?.message === 'string' ? lastTask.message : ''
  return job.message || taskMessage || 'LightRAG 작업 상태를 확인 중입니다.'
}

function normalizeUiRole(role?: string) {
  const raw = String(role || 'user').toLowerCase()
  return raw === 'viewer' ? 'user' : raw
}

function roleMeta(role?: string) {
  const normalized = normalizeUiRole(role)
  const roles: Record<string, { label: string; tone: string; description: string }> = {
    admin: {
      label: '시스템 관리자',
      tone: 'blue',
      description: '사용자, 외부 연동, 시스템 운영을 포함한 전체 관리 권한'
    },
    manager: {
      label: '지식 관리자',
      tone: 'green',
      description: '지정된 워크스페이스의 지식 등록, 수정, 지식화 작업 권한'
    },
    user: {
      label: '일반 사용자',
      tone: 'gray',
      description: '지정된 KMS/FAQ 워크스페이스의 통합 검색만 사용하는 기본 계정'
    }
  }
  return roles[normalized] || roles.user
}

function shortDate(value?: string | null) {
  if (!value) return '-'
  return String(value).replace('T', ' ').slice(0, 16)
}

function prettyJson(value: unknown) {
  if (value === null || value === undefined || value === '') return '-'
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

const externalSearchSamplePresets: ExternalSearchSamplePreset[] = [
  {
    key: 'integrated-basic',
    label: '통합 검색 기본',
    description: '생성형 KMS 답변과 FAQ 후보를 함께 조회합니다.',
    endpoint: 'sync',
    payload: {
      query: '카드 인증이 실패할 때 어떻게 해야 하나요?',
      category_ids: [],
      include_generative: true,
      include_faq: true,
      kms_options: {
        mode: 'mix',
        response_type: 'Brief answer: MAXIMUM 5 bullet points using \'- \' (hyphen+space). Each point is one concise line. Fewer is better.',
        top_k: 40,
        chunk_top_k: 20,
        include_references: true,
        include_chunk_content: true,
        highlight_entities: true,
        enable_rerank: true
      },
      faq_options: {
        top_k: 5,
        min_score: 0.18,
        retrieval_mode: 'keyword',
        include_candidates: true
      },
      client_trace_id: 'sample-integrated-basic'
    }
  },
  {
    key: 'generative-only',
    label: '생성형만',
    description: 'FAQ를 제외하고 LightRAG 생성형 답변과 근거만 확인합니다.',
    endpoint: 'sync',
    payload: {
      query: 'PC 고장 시 조치 방법을 알려줘',
      category_ids: [],
      include_generative: true,
      include_faq: false,
      kms_options: {
        mode: 'mix',
        top_k: 30,
        chunk_top_k: 12,
        include_references: true,
        include_chunk_content: true,
        highlight_entities: true,
        enable_rerank: true
      },
      client_trace_id: 'sample-generative-only'
    }
  },
  {
    key: 'faq-only',
    label: 'FAQ만',
    description: '승인형 FAQ 답변 후보만 조회합니다.',
    endpoint: 'sync',
    payload: {
      query: '회원가입 방법이 궁금합니다',
      category_ids: [],
      include_generative: false,
      include_faq: true,
      faq_options: {
        top_k: 10,
        min_score: 0.12,
        strategy: 'balanced',
        retrieval_mode: 'keyword',
        include_candidates: true
      },
      client_trace_id: 'sample-faq-only'
    }
  },
  {
    key: 'category-filter',
    label: '카테고리 제한',
    description: '선택한 카테고리와 하위 카테고리 범위의 유효한 지식만 검색합니다.',
    endpoint: 'sync',
    payload: {
      query: '이핏 충전 방법',
      category_ids: ['category_id_here'],
      include_generative: true,
      include_faq: true,
      kms_options: {
        mode: 'mix',
        top_k: 20,
        chunk_top_k: 10,
        include_references: true,
        include_chunk_content: true
      },
      faq_options: {
        top_k: 5,
        min_score: 0.18,
        include_candidates: true
      },
      client_trace_id: 'sample-category-filter'
    }
  },
  {
    key: 'streaming',
    label: '스트리밍',
    description: 'NDJSON 이벤트로 생성형 답변 조각, FAQ 결과, 완료 이벤트를 확인합니다.',
    endpoint: 'stream',
    payload: {
      query: '전화기 설정 방법을 알려줘',
      category_ids: [],
      include_generative: true,
      include_faq: true,
      kms_options: {
        mode: 'mix',
        top_k: 20,
        chunk_top_k: 8,
        include_references: true,
        include_chunk_content: true
      },
      faq_options: {
        top_k: 5,
        min_score: 0.18,
        include_candidates: true
      },
      client_trace_id: 'sample-streaming'
    }
  }
]

const externalSearchParameterDocs = [
  {
    name: 'query',
    required: '필수',
    type: 'string',
    description: '사용자 질문입니다. 내부 검색 로그와 외부 client_trace_id 추적의 기준이 됩니다.'
  },
  {
    name: 'category_ids',
    required: '선택',
    type: 'string[]',
    description: 'GET /api/external/categories에서 받은 category_id 배열입니다. 선택한 카테고리와 하위 카테고리 지식만 후보가 됩니다.'
  },
  {
    name: 'include_generative',
    required: '선택',
    type: 'boolean',
    description: '생성형 KMS 답변 포함 여부입니다. 기본값은 true입니다.'
  },
  {
    name: 'include_faq',
    required: '선택',
    type: 'boolean',
    description: 'FAQ KMS 답변 후보 포함 여부입니다. 기본값은 true입니다.'
  },
  {
    name: 'kms_options',
    required: '선택',
    type: 'object',
    description: '생성형 검색 옵션입니다. mode, top_k, chunk_top_k, include_references, include_chunk_content, enable_rerank 등을 지정합니다.'
  },
  {
    name: 'faq_options',
    required: '선택',
    type: 'object',
    description: 'FAQ 검색 옵션입니다. top_k, min_score, retrieval_mode, include_candidates 등을 지정합니다.'
  },
  {
    name: 'client_trace_id',
    required: '선택',
    type: 'string',
    description: '외부 시스템의 요청 추적 ID입니다. 검색 로그에 저장되어 장애 추적과 대사에 사용됩니다.'
  }
]

const externalSearchResponseDocs = [
  ['search_id', '어드민 통합 검색 로그 ID'],
  ['generative_answer', '생성형 KMS 답변, 주요 키워드, 근거 refs'],
  ['faq_results', 'FAQ KMS 답변 후보 목록'],
  ['keywords', '통합 검색 결과 기준 주요 키워드'],
  ['references', '통합 근거 목록'],
  ['trace.eligibility', '카테고리, 사용 여부, 유효기간 적용 결과와 제외 사유'],
  ['latency_ms', '어드민 API 기준 처리 시간']
]

function impactCount(impact: Record<string, unknown> | undefined, key: string) {
  const value = impact?.[key]
  if (Array.isArray(value)) return value.length
  if (typeof value === 'number') return value
  return 0
}

function deletionSummaryEntries(preview: any) {
  return Object.entries(preview?.summary || {}).filter(([, value]) => typeof value === 'number' || typeof value === 'string')
}

type JobPipelineStep = {
  name: string
  done: string
  live: string
}

const defaultJobPipeline: JobPipelineStep[] = [
  { name: '작업 생성', done: '어드민 작업 원장 등록', live: '작업 준비 중' },
  { name: 'LightRAG 요청', done: 'LightRAG API 호출 완료', live: 'LightRAG API 호출 중' },
  { name: '진행 상태 추적', done: 'task/track 상태 동기화', live: '진행 상태 동기화 중' },
  { name: '원장 동기화', done: '참조 ID와 상태 반영', live: '어드민 원장 반영 중' }
]

const jobPipelines: Record<string, JobPipelineStep[]> = {
  upload_document: [
    { name: '파일 수신', done: '파일 업로드 완료', live: '파일 업로드 중' },
    { name: '작업 큐 등록', done: 'track_id 발급', live: '큐 등록 중' },
    { name: '문서 파싱', done: '본문 추출 완료', live: '문서 파싱 중' },
    { name: '청크·임베딩', done: '청크와 벡터 생성', live: '청크·임베딩 생성 중' },
    { name: '엔티티·관계 추출', done: '그래프 추출 완료', live: '엔티티·관계 추출 중' },
    { name: '인덱스 반영', done: 'KMS 인덱스 반영', live: '인덱스 반영 중' }
  ],
  ingest_text: [
    { name: '텍스트 수신', done: '텍스트 본문 등록', live: '텍스트 수신 중' },
    { name: '작업 큐 등록', done: 'task/track 등록 완료', live: '큐 등록 중' },
    { name: '청크 분할', done: '청크 분할 완료', live: '청크 분할 중' },
    { name: '임베딩 생성', done: '벡터 생성 완료', live: '임베딩 생성 중' },
    { name: '엔티티·관계 추출', done: '그래프 추출 완료', live: '그래프 추출 중' },
    { name: '원장 동기화', done: '문서 ref 저장 완료', live: '원장 동기화 중' }
  ],
  ingest_texts: [
    { name: '다중 텍스트 수신', done: '여러 본문 등록', live: '텍스트 수신 중' },
    { name: '작업 큐 등록', done: 'task/track 등록 완료', live: '큐 등록 중' },
    { name: '청크 분할', done: '본문별 청크 분할 완료', live: '청크 분할 중' },
    { name: '임베딩 생성', done: '벡터 생성 완료', live: '임베딩 생성 중' },
    { name: '엔티티·관계 추출', done: '그래프 추출 완료', live: '그래프 추출 중' },
    { name: '원장 동기화', done: '문서 refs 저장 완료', live: '원장 동기화 중' }
  ],
  ingest_url: [
    { name: 'URL 검증', done: 'URL 접근 확인', live: 'URL 검증 중' },
    { name: '본문 추출', done: '웹 본문 추출 완료', live: '본문 추출 중' },
    { name: '청크·임베딩', done: '청크와 벡터 생성', live: '청크·임베딩 생성 중' },
    { name: '엔티티·관계 추출', done: '그래프 추출 완료', live: '그래프 추출 중' },
    { name: '원장 동기화', done: '문서 ref 저장 완료', live: '원장 동기화 중' }
  ],
  ingest_url_batch: [
    { name: 'URL 목록 검증', done: 'URL 목록 검증 완료', live: 'URL 목록 검증 중' },
    { name: '중복 필터', done: '중복 처리 옵션 적용', live: '중복 확인 중' },
    { name: '본문 추출', done: 'URL별 본문 추출 완료', live: '본문 추출 중' },
    { name: '청크·임베딩', done: 'URL별 벡터 생성 완료', live: '청크·임베딩 생성 중' },
    { name: '원장 동기화', done: '문서 refs 저장 완료', live: '원장 동기화 중' }
  ],
  ingest_board: [
    { name: '게시판 API 탐색', done: '게시글 목록 수집', live: '게시판 API 탐색 중' },
    { name: '필드 매핑 적용', done: 'title/body/date 매핑 적용', live: '필드 매핑 검증 중' },
    { name: '레코드 수집', done: '게시글 레코드 수집 완료', live: '레코드 수집 중' },
    { name: '청크·임베딩', done: '청크와 벡터 생성', live: '청크·임베딩 생성 중' },
    { name: '원장 동기화', done: '문서 refs 저장 완료', live: '원장 동기화 중' }
  ],
  ingest_multimodal: [
    { name: '문서 파싱', done: '멀티모달 문서 파싱 완료', live: '문서 파싱 중' },
    { name: '이미지·표·수식 추출', done: '멀티모달 요소 추출', live: '이미지·표·수식 추출 중' },
    { name: '청크·임베딩', done: '텍스트/멀티모달 벡터 생성', live: '멀티모달 임베딩 중' },
    { name: '엔티티·관계 추출', done: '그래프 추출 완료', live: '그래프 추출 중' },
    { name: '원장 동기화', done: '문서 ref 저장 완료', live: '원장 동기화 중' }
  ],
  ingest_quick_image: [
    { name: '이미지 수신', done: '이미지 업로드 완료', live: '이미지 업로드 중' },
    { name: '비전 캡션 생성', done: '이미지 설명 생성', live: '비전 분석 중' },
    { name: '임베딩 생성', done: '벡터 생성 완료', live: '임베딩 생성 중' },
    { name: '원장 동기화', done: '문서 ref 저장 완료', live: '원장 동기화 중' }
  ],
  scan_input_dir: [
    { name: '입력 폴더 스캔', done: '입력 폴더 탐색 완료', live: '입력 폴더 스캔 중' },
    { name: '신규 파일 식별', done: '신규/기존 파일 비교 완료', live: '변경 파일 확인 중' },
    { name: '일괄 큐 등록', done: '파일별 task 등록', live: '큐 등록 중' },
    { name: '원장 동기화', done: '작업 상태 반영', live: '작업 상태 동기화 중' }
  ],
  faq_answer: [
    { name: '답변 수신', done: 'FAQ 답변 본문 수신', live: 'FAQ 답변 확인 중' },
    { name: 'FAQ 등록', done: 'LightRAG FAQ 답변 등록', live: 'LightRAG FAQ 등록 중' },
    { name: '참조 연결', done: 'answer_id 연결 완료', live: 'FAQ 참조 연결 중' },
    { name: '원장 반영', done: '어드민 작업 이력 반영', live: '작업 이력 반영 중' }
  ],
  faq_source_draft: [
    { name: '소스 수신', done: 'FAQ 소스 초안 수신', live: 'FAQ 소스 확인 중' },
    { name: '초안 등록', done: 'LightRAG FAQ 소스 초안 등록', live: 'LightRAG FAQ 등록 중' },
    { name: '참조 연결', done: 'answer_id 연결 완료', live: 'FAQ 참조 연결 중' },
    { name: '원장 반영', done: '어드민 작업 이력 반영', live: '작업 이력 반영 중' }
  ]
}

function jobMetadata(job: Job) {
  if (!job.metadata) return {}
  if (typeof job.metadata === 'string') {
    try {
      return JSON.parse(job.metadata)
    } catch {
      return {}
    }
  }
  return job.metadata
}

function jobPipeline(job: Job) {
  return jobPipelines[String(job.job_type || '')] || defaultJobPipeline
}

function jobPhase(job: Job, steps: JobPipelineStep[]) {
  const status = String(job.status || '').toLowerCase()
  if (['completed', 'ready', 'processed', 'success'].includes(status)) return steps.length
  if (['failed', 'error', 'cancelled', 'archived'].includes(status)) {
    return Math.max(0, Math.min(steps.length - 1, Math.round((Number(job.progress || 0) / 100) * steps.length)))
  }
  return Math.max(0, Math.min(steps.length - 1, Math.floor((Number(job.progress || 0) / 100) * steps.length)))
}

function jobLogRows(job: Job, events: JobEvent[]) {
  if (events.length) {
    return events.map((event) => ({
      time: shortDate(event.create_time),
      level: String(event.event_type || '').includes('rollback') ? 'WARN' : 'INFO',
      message: event.message || event.event_type || '이벤트 기록'
    }))
  }
  const metadata = jobMetadata(job)
  const tasks = Array.isArray(metadata.last_tasks) ? metadata.last_tasks : metadata.last_task ? [metadata.last_task] : []
  return [
    { time: shortDate(job.create_time), level: 'INFO', message: `${job.job_type || '작업'} 생성` },
    ...(job.lightrag_task_id ? [{ time: shortDate(job.update_time), level: 'INFO', message: `LightRAG task ${job.lightrag_task_id}` }] : []),
    ...tasks.map((task: any) => ({
      time: shortDate(job.update_time),
      level: task.status === 'failed' ? 'ERROR' : 'INFO',
      message: `${task.task_id || 'task'} · ${task.status || '-'} · ${Number(task.progress || 0).toFixed(0)}%`
    })),
    ...(job.message ? [{ time: shortDate(job.update_time), level: badgeTone(job.status) === 'red' ? 'ERROR' : 'INFO', message: job.message }] : [])
  ]
}

function dateInputValue(value?: string | null) {
  if (!value) return ''
  return String(value).slice(0, 16)
}

type KmsDocumentDetail = {
  workspace: string
  preview: KmsDocument & {
    content?: string | null
    chunks?: Array<{
      id: string
      chunk_order_index?: number | null
      tokens?: number | null
      content?: string | null
      structured_content?: unknown
    }>
    raw_kind?: string | null
    mime_type?: string | null
  }
  entities?: Array<{
    entity_id: string
    entity_type?: string | null
    description?: string | null
    degree?: number
    source_id?: string | null
    file_path?: string | null
  }>
  relations?: Array<{
    source_id: string
    target_id: string
    keywords?: string | null
    description?: string | null
    weight?: number | null
  }>
  entity_types?: Array<{ entity_type: string; count: number }>
  errors?: Array<{ source: string; detail: unknown }>
}

type KmsChunkDetail = {
  workspace?: string
  chunk_id: string
  doc_id?: string | null
  file_path?: string | null
  chunk_order_index?: number | null
  tokens?: number | null
  content: string
  content_length: number
  chunk_type: string
  structured_content?: unknown
  llm_cache_list?: string[]
  document?: {
    doc_id?: string | null
    file_path?: string | null
    status?: string | null
    chunks_count?: number | null
  } | null
  entities?: Array<{
    entity_id: string
    entity_type?: string | null
    description?: string | null
    degree?: number
  }>
  relations?: Array<{
    source_id: string
    target_id: string
    keywords?: string | null
    description?: string | null
    weight?: number | null
  }>
  deletion_impact?: Record<string, unknown>
}

const initialDocumentReingestForm = {
  title: '',
  body: '',
  category_id: '',
  enabled: true,
  valid_from: '',
  valid_until: '',
  file_source: '',
  delete_previous: true
}

type ModalProps = {
  title: string
  icon?: typeof FileTextIcon
  onClose: () => void
  children: ReactNode
  footer?: ReactNode
  lg?: boolean
  xl?: boolean
}

function Modal({ title, icon: Icon, onClose, children, footer, lg, xl }: ModalProps) {
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose])

  return (
    <div className="overlay" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div className={`modal${xl ? ' xl' : lg ? ' lg' : ''}`}>
        <div className="modal-h">
          {Icon && <Icon className="size-5" style={{ color: 'var(--accent)' }} />}
          <span className="t">{title}</span>
          <button className="x" type="button" onClick={onClose} aria-label="닫기">
            <XIcon className="size-5" />
          </button>
        </div>
        <div className="modal-b">{children}</div>
        {footer && <div className="modal-f">{footer}</div>}
      </div>
    </div>
  )
}

function StatusBadge({ status }: { status?: string }) {
  const tone = badgeTone(status)
  const dot = ['green', 'blue'].includes(tone)
  return <span className={`badge ${tone}`}>{dot && <span className="d" />}{statusLabel(status)}</span>
}

function TypeBadge({ type }: { type?: string }) {
  const normalized = String(type || '').toLowerCase()
  if (normalized.includes('faq')) {
    return (
      <span className="badge blue">
        <BookOpenIcon className="size-3" /> FAQ
      </span>
    )
  }
  return (
    <span className="badge gray">
      <FileTextIcon className="size-3" /> 문서
    </span>
  )
}

type KnowledgeCreateModalProps = {
  sourceType: KnowledgeSourceType
  setSourceType: (type: KnowledgeSourceType) => void
  form: typeof initialKnowledgeForm
  updateForm: (patch: Partial<typeof initialKnowledgeForm>) => void
  file: File | null
  setFile: (file: File | null) => void
  categories: Category[]
  formError: string
  submitting: boolean
  canSubmit: boolean
  onSubmit: (event: FormEvent) => void
  onClose: () => void
}

function KnowledgeCreateModal({
  sourceType,
  setSourceType,
  form,
  updateForm,
  file,
  setFile,
  categories,
  formError,
  submitting,
  canSubmit,
  onSubmit,
  onClose
}: KnowledgeCreateModalProps) {
  const requiresBody = ['faq', 'faq_source_draft', 'text', 'texts'].includes(sourceType)
  const requiresFile = ['upload', 'quick_image', 'multimodal'].includes(sourceType)
  const requiresTitle = sourceType !== 'scan'
  const activeSource = knowledgeSources.find((source) => source.type === sourceType) || knowledgeSources[0]
  const ActiveIcon = activeSource.icon
  const showPromptFields = ['url', 'url_batch', 'board', 'quick_image', 'multimodal'].includes(sourceType)
  const fileAccept = sourceType === 'quick_image'
    ? 'image/*'
    : sourceType === 'multimodal'
      ? '.pdf,.doc,.docx,.ppt,.pptx,.png,.jpg,.jpeg,.webp,.tif,.tiff'
      : '.pdf,.doc,.docx,.txt,.md,.csv,.xlsx,.ppt,.pptx'
  const fileHelp = sourceType === 'quick_image'
    ? '이미지 1장을 VLM 기반 quick image 지식으로 등록합니다.'
    : sourceType === 'multimodal'
      ? '이미지, 표, 수식이 포함된 문서를 멀티모달 지식으로 처리합니다.'
      : '문서 파일을 선택하면 LightRAG 문서 업로드 작업이 생성됩니다.'

  return (
    <Modal
      xl
      title="지식 추가"
      icon={PlusIcon}
      onClose={onClose}
      footer={
        <>
          <Button type="button" variant="outline" onClick={onClose}>
            취소
          </Button>
          <Button type="submit" form="knowledge-create-form" disabled={!canSubmit}>
            <PlusIcon className="size-4" /> {submitting ? '등록 중' : '지식 추가'}
          </Button>
        </>
      }
    >
      <form id="knowledge-create-form" className="knowledge-create-form col" style={{ gap: 16 }} onSubmit={onSubmit}>
        <div className="grid" style={{ gridTemplateColumns: '232px minmax(0, 1fr)', gap: 18, alignItems: 'start' }}>
          <div className="col" style={{ gap: 2 }}>
            {knowledgeSourceGroups.map((group) => (
              <div key={group.label} className="col" style={{ gap: 2 }}>
                <div className="eyebrow" style={{ fontSize: 9.5, padding: '10px 6px 4px' }}>
                  {group.label}
                </div>
                {group.types.map((type) => {
                  const source = knowledgeSources.find((item) => item.type === type)
                  if (!source) return null
                  const Icon = source.icon
                  const active = source.type === sourceType
                  return (
                    <button
                      key={source.type}
                      type="button"
                      className="row"
                      style={{
                        gap: 10,
                        width: '100%',
                        padding: '9px 10px',
                        borderRadius: 'var(--radius-md)',
                        border: `1px solid ${active ? 'var(--accent)' : 'transparent'}`,
                        background: active ? 'var(--accent-soft)' : 'transparent',
                        color: active ? 'var(--accent)' : 'var(--fg-primary-soft)',
                        cursor: 'pointer',
                        textAlign: 'left'
                      }}
                      onClick={() => setSourceType(source.type)}
                    >
                      <Icon className="size-4" style={{ color: active ? 'var(--accent)' : 'var(--fg-secondary)', flexShrink: 0 }} />
                      <span style={{ fontSize: 13, fontWeight: active ? 700 : 500 }}>{source.label}</span>
                      {source.workspace === 'FAQ' && <span className="badge blue">FAQ</span>}
                    </button>
                  )
                })}
              </div>
            ))}
          </div>

          <div className="col" style={{ gap: 16, minWidth: 0 }}>
            <div className="row" style={{ gap: 10, paddingBottom: 14, borderBottom: '1px solid var(--border-subtle)' }}>
              <div style={{ width: 38, height: 38, borderRadius: 9, background: 'var(--accent-soft)', color: 'var(--accent)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                <ActiveIcon className="size-5" />
              </div>
              <div className="grow" style={{ minWidth: 0 }}>
                <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--fg-primary)' }}>{activeSource.label}</div>
                <div className="muted" style={{ fontSize: 12, lineHeight: 1.5 }}>{activeSource.description}</div>
              </div>
              <span className="badge outline mono" style={{ fontSize: 10.5 }}>
                {knowledgeSourceApiLabels[sourceType]}
              </span>
            </div>

            <div className="row" style={{ gap: 10, padding: 12, background: 'var(--accent-soft)', borderRadius: 'var(--radius-md)', border: '1px solid #c9d8f7' }}>
              <ShieldIcon className="size-4" style={{ color: 'var(--accent)', flexShrink: 0, marginTop: 1 }} />
              <div style={{ fontSize: 12, color: 'var(--fg-primary-soft)', lineHeight: 1.55 }}>
                카테고리, 유효기간, 사용 여부는 어드민 원장에 먼저 저장되고 통합 검색 시 유효한 지식만 후보로 전달됩니다.
              </div>
            </div>

        <div className="grid" style={{ gridTemplateColumns: '1fr 1fr', gap: 14 }}>
          <label className="field">
            <span>카테고리</span>
            <select
              className={selectClass}
              value={form.category_id}
              onChange={(event) => updateForm({ category_id: event.target.value })}
            >
              <option value="">카테고리 없음</option>
              {categories
                .filter((category) => category.is_active)
                .map((category) => (
                  <option key={category.category_id} value={category.category_id}>
                    {'　'.repeat(categoryDepth(category))}
                    {category.name}
                  </option>
                ))}
            </select>
          </label>
          <label className="field">
            <span>제목</span>
            <Input
              value={form.title}
              onChange={(event) => updateForm({ title: event.target.value })}
              placeholder={sourceType === 'scan' ? '작업명(선택)' : '제목'}
              required={requiresTitle}
            />
          </label>
        </div>

        {requiresBody && (
          <label className="field">
            <span>{sourceType === 'texts' ? '여러 텍스트' : sourceType.startsWith('faq') ? '답변 본문' : '본문'}</span>
            <Textarea
              value={form.body}
              onChange={(event) => updateForm({ body: event.target.value })}
              placeholder={sourceType === 'texts' ? '여러 텍스트를 줄 단위로 입력' : '내용'}
              style={{ minHeight: 150 }}
            />
          </label>
        )}

        {sourceType.startsWith('faq') && (
          <div className="col" style={{ gap: 12 }}>
            <div className="grid" style={{ gridTemplateColumns: '1fr 1fr', gap: 14 }}>
              <label className="field">
                <span>답변 요약</span>
                <Textarea
                  value={form.approved_summary}
                  onChange={(event) => updateForm({ approved_summary: event.target.value })}
                  placeholder="검색 결과에 함께 보여줄 요약 또는 검수 메모"
                  style={{ minHeight: 92 }}
                />
              </label>
              <label className="field">
                <span>질문·키워드 후보</span>
                <Textarea
                  value={form.guidance}
                  onChange={(event) => updateForm({ guidance: event.target.value })}
                  placeholder="사용자 질문 또는 키워드를 줄 단위로 입력"
                  style={{ minHeight: 92 }}
                />
              </label>
            </div>
            <div className="grid" style={{ gridTemplateColumns: sourceType === 'faq_source_draft' ? '1fr 1fr 120px' : '1fr', gap: 12 }}>
              <div className="field">
                <span>태그</span>
                <TagInput
                  value={form.tags}
                  onChange={(tags) => updateForm({ tags })}
                  placeholder="태그 입력"
                />
              </div>
              {sourceType === 'faq_source_draft' && (
                <>
                  <label className="field">
                    <span>소스 URI</span>
                    <Input
                      value={form.faq_source_uri}
                      onChange={(event) => updateForm({ faq_source_uri: event.target.value })}
                      placeholder="문서 URL, 파일 경로, 원본 식별자"
                    />
                  </label>
                  <label className="field">
                    <span>우선순위</span>
                    <Input
                      type="number"
                      value={form.priority}
                      onChange={(event) => updateForm({ priority: event.target.value })}
                    />
                  </label>
                </>
              )}
            </div>
            {sourceType === 'faq_source_draft' && (
              <div className="grid" style={{ gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <label className="field">
                  <span>소스 유형</span>
                  <select
                    className={selectClass}
                    value={form.faq_source_type}
                    onChange={(event) => updateForm({ faq_source_type: event.target.value })}
                  >
                    <option value="plain">일반 텍스트</option>
                    <option value="markdown">Markdown</option>
                    <option value="html">HTML</option>
                    <option value="url">URL</option>
                    <option value="file">파일</option>
                    <option value="structured">구조화 데이터</option>
                  </select>
                </label>
                <label className="field">
                  <span>파일명</span>
                  <Input
                    value={form.faq_file_name}
                    onChange={(event) => updateForm({ faq_file_name: event.target.value })}
                    placeholder="선택"
                  />
                </label>
              </div>
            )}
          </div>
        )}

        {sourceType === 'text' && (
          <label className="field">
            <span>출처명</span>
            <Input
              value={form.file_source}
              onChange={(event) => updateForm({ file_source: event.target.value })}
              placeholder="출처명(선택)"
            />
          </label>
        )}

        {sourceType === 'url' && (
          <div className="grid" style={{ gridTemplateColumns: '1fr 1fr', gap: 14 }}>
            <label className="field">
              <span>URL</span>
              <Input value={form.url} onChange={(event) => updateForm({ url: event.target.value })} placeholder="URL" />
            </label>
            <label className="field">
              <span>문서 출처명</span>
              <Input
                value={form.file_source}
                onChange={(event) => updateForm({ file_source: event.target.value })}
                placeholder="문서 출처명(선택)"
              />
            </label>
          </div>
        )}

        {sourceType === 'url_batch' && (
          <label className="field">
            <span>URL 목록</span>
            <Textarea
              value={form.urls}
              onChange={(event) => updateForm({ urls: event.target.value })}
              placeholder="URL을 줄 단위로 입력"
              style={{ minHeight: 120 }}
            />
          </label>
        )}

        {sourceType === 'board' && (
          <div className="col" style={{ gap: 12 }}>
            <div className="grid" style={{ gridTemplateColumns: '120px 1fr', gap: 10 }}>
              <select
                className={selectClass}
                value={form.board_method}
                onChange={(event) => updateForm({ board_method: event.target.value })}
              >
                <option value="GET">GET</option>
                <option value="POST">POST</option>
              </select>
              <Input
                value={form.board_api_url}
                onChange={(event) => updateForm({ board_api_url: event.target.value })}
                placeholder="게시판 API URL"
              />
            </div>
            <label className="field">
              <span>필드 매핑 JSON</span>
              <Textarea
                className="mono"
                value={form.board_mapping}
                onChange={(event) => updateForm({ board_mapping: event.target.value })}
                style={{ minHeight: 120, fontSize: 12 }}
              />
              <FieldHelp>게시판 API 응답에서 목록, 제목, 본문, ID, 작성일 필드를 어느 경로에서 읽을지 지정합니다.</FieldHelp>
            </label>
            <div className="grid" style={{ gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 }}>
              <label className="field">
                <span>Header JSON</span>
                <Textarea
                  className="mono"
                  value={form.board_headers}
                  onChange={(event) => updateForm({ board_headers: event.target.value })}
                  placeholder='{"Authorization": "Bearer ..."}'
                  style={{ minHeight: 90, fontSize: 12 }}
                />
              </label>
              <label className="field">
                <span>Parameter JSON</span>
                <Textarea
                  className="mono"
                  value={form.board_params}
                  onChange={(event) => updateForm({ board_params: event.target.value })}
                  placeholder='{"page": 1, "size": 50}'
                  style={{ minHeight: 90, fontSize: 12 }}
                />
              </label>
              <label className="field">
                <span>Body JSON</span>
                <Textarea
                  className="mono"
                  value={form.board_body}
                  onChange={(event) => updateForm({ board_body: event.target.value })}
                  placeholder='{"keyword": ""}'
                  style={{ minHeight: 90, fontSize: 12 }}
                />
              </label>
            </div>
          </div>
        )}

        {requiresFile && (
          <div className="field">
            <span>파일</span>
            <label className={`file-picker${file ? ' has-file' : ''}`}>
              <input
                key={file ? `${file.name}-${file.size}-${file.lastModified}` : 'empty-file'}
                className="file-picker-input"
                type="file"
                aria-label="파일 선택"
                accept={fileAccept}
                onChange={(event) => setFile(event.target.files?.[0] || null)}
              />
              <span className="file-picker-icon">
                <UploadIcon className="size-5" />
              </span>
              <span className="file-picker-body">
                <b>{file ? file.name : '파일 선택'}</b>
                <small>{file ? `${formatFileSize(file.size)} · 다시 선택하려면 클릭` : '클릭해서 로컬 파일을 선택하세요.'}</small>
              </span>
              <span className="file-picker-action">찾아보기</span>
            </label>
            <div className="row" style={{ justifyContent: 'space-between', gap: 8 }}>
              <FieldHelp>{fileHelp}</FieldHelp>
              {file && (
                <Button type="button" size="sm" variant="ghost" onClick={() => setFile(null)}>
                  선택 해제
                </Button>
              )}
            </div>
          </div>
        )}

        {showPromptFields && (
          <FormSection
            title="처리 지시"
            description="선택 입력입니다. 원본에서 어떤 정보를 더 중요하게 추출할지 지시합니다."
          >
            <div className="knowledge-prompt-grid">
              <PromptTextarea
                label="문서 처리 지시"
                value={form.document_prompt}
                onChange={(value) => updateForm({ document_prompt: value })}
                placeholder="예: 고객 응대 절차, 예외 조건, 단계별 처리 방법을 우선 추출해 주세요."
                help="문서 본문과 제목, 문단 구조를 해석할 때 적용됩니다."
              />
              <PromptTextarea
                label="이미지 처리 지시"
                value={form.image_prompt}
                onChange={(value) => updateForm({ image_prompt: value })}
                placeholder="예: 장비명, 버튼 위치, 화면 문구, 오류 코드를 빠짐없이 설명해 주세요."
                help="PDF 이미지, 첨부 이미지, 캡처 화면의 설명 생성에 적용됩니다."
              />
              <PromptTextarea
                label="표 처리 지시"
                value={form.table_prompt}
                onChange={(value) => updateForm({ table_prompt: value })}
                placeholder="예: 열/행 의미와 조건별 차이를 유지해 요약해 주세요."
                help="표를 텍스트 지식으로 변환할 때 적용됩니다."
              />
            </div>
          </FormSection>
        )}

        {['board', 'multimodal'].includes(sourceType) && (
          <label className="field">
            <span>파서</span>
            <select className={selectClass} value={form.parser} onChange={(event) => updateForm({ parser: event.target.value })}>
              <option value="pymupdf">PyMuPDF</option>
              <option value="docling">Docling</option>
            </select>
          </label>
        )}

        <FormSection
          title="검색 사용 조건"
          description="통합 검색에서 후보로 사용할 기간과 사용 여부를 설정합니다."
        >
          <DateRangeTimePicker
            validFrom={form.valid_from}
            validUntil={form.valid_until}
            onChange={updateForm}
          />
          <label className="knowledge-enabled-row">
            <input
              type="checkbox"
              checked={form.enabled}
              onChange={(event) => updateForm({ enabled: event.target.checked })}
            />
            <span>
              <b>답변 후보에 사용</b>
              <small>꺼두면 원장에는 저장되지만 통합 검색 후보에서 제외됩니다.</small>
            </span>
          </label>
        </FormSection>
        {formError && (
          <div className="badge red" style={{ justifyContent: 'flex-start', whiteSpace: 'normal', borderRadius: 'var(--radius-md)', padding: 10 }}>
            {formError}
          </div>
        )}
          </div>
        </div>
      </form>
    </Modal>
  )
}

function KmsDocumentExplorer({ detail, onClose }: { detail: KmsDocumentDetail; onClose: () => void }) {
  const [tab, setTab] = useState<'doc' | 'chunk' | 'graph'>('doc')
  const [selectedChunkId, setSelectedChunkId] = useState<string | null>(null)
  const [chunkDetail, setChunkDetail] = useState<KmsChunkDetail | null>(null)
  const [chunkLoading, setChunkLoading] = useState(false)
  const [chunkSaving, setChunkSaving] = useState(false)
  const [chunkError, setChunkError] = useState('')
  const [chunkEditContent, setChunkEditContent] = useState('')
  const [clearStructuredContent, setClearStructuredContent] = useState(false)
  const [deletionDraft, setDeletionDraft] = useState<any>(null)
  const [deletionPreview, setDeletionPreview] = useState<any>(null)
  const [deletionResult, setDeletionResult] = useState<any>(null)
  const [deletionJobs, setDeletionJobs] = useState<any[]>([])
  const [deletionLoading, setDeletionLoading] = useState(false)
  const [deletionError, setDeletionError] = useState('')
  const [restorePreview, setRestorePreview] = useState<any>(null)
  const [restoreResult, setRestoreResult] = useState<any>(null)
  const [restoreLoadingJob, setRestoreLoadingJob] = useState<string | null>(null)
  const [graphEntities, setGraphEntities] = useState<any[]>(detail.entities || [])
  const [graphRelations, setGraphRelations] = useState<any[]>(detail.relations || [])
  const [graphEntityTypes, setGraphEntityTypes] = useState<any[]>(detail.entity_types || [])
  const [graphEntityPagination, setGraphEntityPagination] = useState<any>(detail.entity_pagination || {})
  const [graphRelationPagination, setGraphRelationPagination] = useState<any>(detail.relation_pagination || {})
  const [graphEntitySearch, setGraphEntitySearch] = useState('')
  const [graphEntityType, setGraphEntityType] = useState('')
  const [graphRelationSearch, setGraphRelationSearch] = useState('')
  const [graphEntityPage, setGraphEntityPage] = useState(1)
  const [graphRelationPage, setGraphRelationPage] = useState(1)
  const [graphLoading, setGraphLoading] = useState(false)
  const [graphError, setGraphError] = useState('')
  const [relatedEntityId, setRelatedEntityId] = useState<string | null>(null)
  const [relatedEntities, setRelatedEntities] = useState<any[]>([])
  const [relatedLoading, setRelatedLoading] = useState(false)
  const preview = detail.preview
  const chunks = preview.chunks || []
  const title = preview.file_path || preview.doc_nm || preview.id

  const loadDeletionJobs = async () => {
    try {
      const response = await api.get('/api/knowledge/kms-deletions/jobs', {
        params: { kms_workspace: detail.workspace, limit: 5 }
      })
      setDeletionJobs(response.data.jobs || [])
    } catch {
      setDeletionJobs([])
    }
  }

  useEffect(() => {
    loadDeletionJobs()
  }, [detail.workspace])

  const openChunkDetail = async (chunkId: string) => {
    setSelectedChunkId(chunkId)
    setChunkLoading(true)
    setChunkError('')
    try {
      const response = await api.get(`/api/knowledge/kms-chunks/${encodeURIComponent(chunkId)}`, {
        params: { kms_workspace: detail.workspace }
      })
      setChunkDetail(response.data)
      setChunkEditContent(response.data.content || '')
      setClearStructuredContent(false)
    } catch (error) {
      setChunkError(apiErrorMessage(error, '청크 상세 조회 중 오류가 발생했습니다.'))
    } finally {
      setChunkLoading(false)
    }
  }

  const saveChunkDetail = async () => {
    if (!chunkDetail) return
    setChunkSaving(true)
    setChunkError('')
    try {
      const response = await api.patch(
        `/api/knowledge/kms-chunks/${encodeURIComponent(chunkDetail.chunk_id)}`,
        {
          content: chunkEditContent,
          clear_structured_content: clearStructuredContent,
          invalidate_cache: true
        },
        { params: { kms_workspace: detail.workspace } }
      )
      setChunkDetail(response.data)
      setChunkEditContent(response.data.content || '')
      setClearStructuredContent(false)
    } catch (error) {
      setChunkError(apiErrorMessage(error, '청크 수정 중 오류가 발생했습니다.'))
    } finally {
      setChunkSaving(false)
    }
  }

  const previewDeletion = async (draft: any) => {
    setDeletionDraft(draft)
    setDeletionPreview(null)
    setDeletionResult(null)
    setRestorePreview(null)
    setRestoreResult(null)
    setDeletionError('')
    setDeletionLoading(true)
    try {
      const response = await api.post('/api/knowledge/kms-deletions/preview', draft.payload, {
        params: { kms_workspace: detail.workspace }
      })
      setDeletionPreview(response.data)
    } catch (error) {
      setDeletionError(apiErrorMessage(error, '삭제 영향도 조회 중 오류가 발생했습니다.'))
    } finally {
      setDeletionLoading(false)
    }
  }

  const executeDeletion = async () => {
    if (!deletionDraft || !deletionPreview?.executable) return
    const confirmed = window.confirm(`${deletionDraft.label} 삭제를 실행하시겠습니까? 삭제 스냅샷이 생성되면 복구 preview를 사용할 수 있습니다.`)
    if (!confirmed) return
    setDeletionLoading(true)
    setDeletionError('')
    try {
      const response = await api.post('/api/knowledge/kms-deletions/execute', deletionDraft.payload, {
        params: { kms_workspace: detail.workspace }
      })
      setDeletionResult(response.data)
      if (deletionDraft.payload.target_type === 'chunk') {
        setChunkDetail(null)
        setSelectedChunkId(null)
      }
      await loadDeletionJobs()
    } catch (error) {
      setDeletionError(apiErrorMessage(error, '삭제 실행 중 오류가 발생했습니다.'))
    } finally {
      setDeletionLoading(false)
    }
  }

  const previewRestore = async (jobId: string) => {
    setRestoreLoadingJob(jobId)
    setRestorePreview(null)
    setRestoreResult(null)
    setDeletionError('')
    try {
      const response = await api.post(
        `/api/knowledge/kms-deletions/jobs/${encodeURIComponent(jobId)}/restore/preview`,
        { overwrite: false, invalidate_cache: true },
        { params: { kms_workspace: detail.workspace } }
      )
      setRestorePreview(response.data)
    } catch (error) {
      setDeletionError(apiErrorMessage(error, '복구 영향도 조회 중 오류가 발생했습니다.'))
    } finally {
      setRestoreLoadingJob(null)
    }
  }

  const executeRestore = async (jobId: string) => {
    const confirmed = window.confirm(`${jobId} 삭제 스냅샷을 복구하시겠습니까?`)
    if (!confirmed) return
    setRestoreLoadingJob(jobId)
    setDeletionError('')
    try {
      const response = await api.post(
        `/api/knowledge/kms-deletions/jobs/${encodeURIComponent(jobId)}/restore/execute`,
        { overwrite: false, invalidate_cache: true },
        { params: { kms_workspace: detail.workspace } }
      )
      setRestoreResult(response.data)
      await loadDeletionJobs()
    } catch (error) {
      setDeletionError(apiErrorMessage(error, '삭제 스냅샷 복구 중 오류가 발생했습니다.'))
    } finally {
      setRestoreLoadingJob(null)
    }
  }

  const chunkDeletionDraft = (chunkId: string) => ({
    label: `청크 ${chunkId}`,
    payload: {
      target_type: 'chunk',
      policy: 'force_delete_chunks',
      ids: [chunkId],
      relations: [],
      delete_llm_cache: false,
      invalidate_cache: true
    }
  })

  const entityDeletionDraft = (entityId: string) => ({
    label: `엔티티 ${entityId}`,
    payload: {
      target_type: 'entity',
      policy: 'cascade_safe',
      ids: [entityId],
      relations: [],
      invalidate_cache: true
    }
  })

  const relationDeletionDraft = (sourceId: string, targetId: string) => ({
    label: `관계 ${sourceId} -> ${targetId}`,
    payload: {
      target_type: 'relation',
      policy: 'cascade_safe',
      ids: [],
      relations: [{ source_id: sourceId, target_id: targetId }],
      invalidate_cache: true
    }
  })

  const loadGraphEntityTypes = async () => {
    try {
      const response = await api.get('/api/knowledge/kms-entity-types', {
        params: { kms_workspace: detail.workspace }
      })
      setGraphEntityTypes(response.data.types || [])
    } catch (error) {
      setGraphError(apiErrorMessage(error, '엔티티 타입 조회 중 오류가 발생했습니다.'))
    }
  }

  const loadGraphEntities = async (page = graphEntityPage) => {
    setGraphLoading(true)
    setGraphError('')
    try {
      const response = await api.post(
        '/api/knowledge/kms-entities',
        {
          page,
          page_size: 12,
          search: graphEntitySearch.trim() || undefined,
          entity_type: graphEntityType || undefined,
          sort_field: 'entity_id',
          sort_direction: 'asc'
        },
        { params: { kms_workspace: detail.workspace } }
      )
      setGraphEntities(response.data.entities || [])
      setGraphEntityPagination(response.data.pagination || {})
    } catch (error) {
      setGraphError(apiErrorMessage(error, '엔티티 조회 중 오류가 발생했습니다.'))
    } finally {
      setGraphLoading(false)
    }
  }

  const loadGraphRelations = async (page = graphRelationPage) => {
    setGraphLoading(true)
    setGraphError('')
    try {
      const response = await api.post(
        '/api/knowledge/kms-relations',
        {
          page,
          page_size: 12,
          search: graphRelationSearch.trim() || undefined,
          sort_field: 'source_id',
          sort_direction: 'asc'
        },
        { params: { kms_workspace: detail.workspace } }
      )
      setGraphRelations(response.data.relations || [])
      setGraphRelationPagination(response.data.pagination || {})
    } catch (error) {
      setGraphError(apiErrorMessage(error, '관계 조회 중 오류가 발생했습니다.'))
    } finally {
      setGraphLoading(false)
    }
  }

  const searchGraphEntities = (event?: FormEvent) => {
    event?.preventDefault()
    setGraphEntityPage(1)
    setRelatedEntityId(null)
    setRelatedEntities([])
    void loadGraphEntities(1)
  }

  const searchGraphRelations = (event?: FormEvent) => {
    event?.preventDefault()
    setGraphRelationPage(1)
    void loadGraphRelations(1)
  }

  const openRelatedEntities = async (entityId: string) => {
    setRelatedEntityId(entityId)
    setRelatedEntities([])
    setRelatedLoading(true)
    setGraphError('')
    try {
      const response = await api.get(`/api/knowledge/kms-entities/${encodeURIComponent(entityId)}/related`, {
        params: { kms_workspace: detail.workspace }
      })
      setRelatedEntities(response.data.related || [])
    } catch (error) {
      setGraphError(apiErrorMessage(error, '관련 엔티티 조회 중 오류가 발생했습니다.'))
    } finally {
      setRelatedLoading(false)
    }
  }

  useEffect(() => {
    if (tab !== 'graph') return
    void loadGraphEntityTypes()
    void loadGraphEntities(graphEntityPage)
    void loadGraphRelations(graphRelationPage)
  }, [tab, graphEntityPage, graphRelationPage, graphEntityType, detail.workspace])

  return (
    <Modal lg title="생성형 KMS 탐색" icon={LayersIcon} onClose={onClose} footer={<Button onClick={onClose}>닫기</Button>}>
      <div className="row" style={{ gap: 10, marginBottom: 16 }}>
        <div style={{ width: 40, height: 40, borderRadius: 10, background: 'var(--accent-soft)', color: 'var(--accent)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
          <FileTextIcon className="size-5" />
        </div>
        <div className="grow" style={{ minWidth: 0 }}>
          <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--fg-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{title}</div>
          <div className="muted mono" style={{ fontSize: 12 }}>
            {preview.id} · {chunks.length || preview.chunks_count || 0} chunks · {detail.workspace}
          </div>
        </div>
        <StatusBadge status={preview.status} />
      </div>
      <div className="tabs" style={{ marginBottom: 16 }}>
        <button className={tab === 'doc' ? 'on' : ''} onClick={() => setTab('doc')}>
          <FileTextIcon className="size-4" /> 문서
        </button>
        <button className={tab === 'chunk' ? 'on' : ''} onClick={() => setTab('chunk')}>
          <LayersIcon className="size-4" /> 청크 <span className="ct">{chunks.length || preview.chunks_count || 0}</span>
        </button>
        <button className={tab === 'graph' ? 'on' : ''} onClick={() => setTab('graph')}>
          <NetworkIcon className="size-4" /> 엔티티·관계
        </button>
      </div>

      {(deletionDraft || deletionJobs.length > 0 || deletionError) && (
        <div className="grid" style={{ gridTemplateColumns: 'minmax(0, 1.2fr) minmax(300px, 0.8fr)', gap: 12, marginBottom: 16, alignItems: 'start' }}>
          <div style={{ padding: 13, borderRadius: 'var(--radius-md)', border: '1px solid var(--border-default)', background: '#fff' }}>
            <div className="row" style={{ gap: 8, marginBottom: 10 }}>
              <ShieldIcon className="size-4" style={{ color: 'var(--warning)' }} />
              <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--fg-primary)' }}>삭제 영향도</span>
              {deletionDraft && <span className="badge outline">{deletionDraft.label}</span>}
              <div className="grow" />
              {deletionPreview && (
                <Button type="button" size="sm" variant="outline" onClick={executeDeletion} disabled={deletionLoading || !deletionPreview.executable}>
                  <Trash2Icon className={deletionLoading ? 'spin size-4' : 'size-4'} /> 삭제 실행
                </Button>
              )}
            </div>
            {deletionLoading && <div className="empty" style={{ padding: 14 }}><RefreshCwIcon className="spin size-4" /> 처리 중입니다.</div>}
            {deletionError && (
              <div className="badge red" style={{ justifyContent: 'flex-start', whiteSpace: 'normal', borderRadius: 'var(--radius-md)', padding: 9 }}>
                {deletionError}
              </div>
            )}
            {deletionPreview && (
              <div className="col" style={{ gap: 10 }}>
                <div className="row wrap" style={{ gap: 6 }}>
                  <span className={`badge ${deletionPreview.executable ? 'green' : 'amber'}`}>{deletionPreview.executable ? '실행 가능' : '미리보기만 가능'}</span>
                  <span className="badge gray">{deletionPreview.target_type}</span>
                  <span className="badge gray">{deletionPreview.policy}</span>
                  {deletionPreview.job_id && <span className="badge outline mono">{deletionPreview.job_id}</span>}
                </div>
                <div className="grid" style={{ gridTemplateColumns: 'repeat(4, 1fr)', gap: 8 }}>
                  {deletionSummaryEntries(deletionPreview).slice(0, 8).map(([key, value]) => (
                    <div key={key} style={{ padding: 9, borderRadius: 'var(--radius-md)', background: 'var(--bg-subtle)' }}>
                      <div className="eyebrow" style={{ marginBottom: 3 }}>{key}</div>
                      <div className="num" style={{ fontSize: 16, fontWeight: 800, color: 'var(--fg-primary)' }}>{String(value)}</div>
                    </div>
                  ))}
                </div>
                {Boolean(deletionPreview.warnings?.length) && (
                  <div style={{ padding: 9, borderRadius: 'var(--radius-md)', background: 'var(--warning-soft)', color: '#9a5b08', fontSize: 12, lineHeight: 1.5 }}>
                    {deletionPreview.warnings.join(' ')}
                  </div>
                )}
                {deletionResult && (
                  <div style={{ padding: 9, borderRadius: 'var(--radius-md)', background: 'var(--success-soft)', color: 'var(--success)', fontSize: 12, lineHeight: 1.5 }}>
                    삭제 실행 완료: {deletionResult.job_id || 'snapshot 없음'} · {deletionResult.status}
                  </div>
                )}
              </div>
            )}
            {restorePreview && (
              <div style={{ marginTop: 10, padding: 10, borderRadius: 'var(--radius-md)', background: 'var(--bg-subtle)', fontSize: 12 }}>
                <b>복구 미리보기</b> · {restorePreview.job_id} · {restorePreview.executable ? '실행 가능' : '실행 불가'}
                <pre className="mono" style={{ marginTop: 8, maxHeight: 120, overflow: 'auto' }}>{prettyJson({ counts: restorePreview.counts, conflicts: restorePreview.conflicts, warnings: restorePreview.warnings })}</pre>
              </div>
            )}
            {restoreResult && (
              <div style={{ marginTop: 10, padding: 10, borderRadius: 'var(--radius-md)', background: 'var(--success-soft)', color: 'var(--success)', fontSize: 12 }}>
                복구 실행 완료: {restoreResult.job_id} · {prettyJson(restoreResult.restored)}
              </div>
            )}
          </div>
          <div style={{ padding: 13, borderRadius: 'var(--radius-md)', border: '1px solid var(--border-default)', background: '#fff' }}>
            <div className="row" style={{ gap: 8, marginBottom: 10 }}>
              <RotateCwIcon className="size-4" style={{ color: 'var(--accent)' }} />
              <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--fg-primary)' }}>삭제 스냅샷</span>
              <div className="grow" />
              <Button type="button" size="sm" variant="ghost" onClick={loadDeletionJobs}>
                <RefreshCwIcon className="size-4" />
              </Button>
            </div>
            <div className="col" style={{ gap: 7 }}>
              {deletionJobs.map((job) => (
                <div key={job.job_id} style={{ padding: 9, borderRadius: 'var(--radius-md)', background: 'var(--bg-subtle)' }}>
                  <div className="row" style={{ gap: 6 }}>
                    <span className="badge gray">{job.target_type}</span>
                    <span className="badge outline">{job.policy}</span>
                    <span className="grow mono muted" style={{ fontSize: 10.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{job.job_id}</span>
                  </div>
                  <div className="row" style={{ gap: 6, marginTop: 7 }}>
                    <Button type="button" size="sm" variant="ghost" onClick={() => previewRestore(job.job_id)} disabled={restoreLoadingJob === job.job_id}>
                      <EyeOffIcon className={restoreLoadingJob === job.job_id ? 'spin size-4' : 'size-4'} /> 복구 미리보기
                    </Button>
                    <Button type="button" size="sm" variant="outline" onClick={() => executeRestore(job.job_id)} disabled={restoreLoadingJob === job.job_id}>
                      <RotateCwIcon className={restoreLoadingJob === job.job_id ? 'spin size-4' : 'size-4'} /> 복구
                    </Button>
                  </div>
                </div>
              ))}
              {!deletionJobs.length && <div className="empty" style={{ padding: 14 }}>삭제 스냅샷이 없습니다.</div>}
            </div>
          </div>
        </div>
      )}

      {tab === 'doc' && (
        <div className="col" style={{ gap: 14 }}>
          <div className="grid" style={{ gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
            {[
              ['문서 ID', preview.id],
              ['상태', statusLabel(preview.status)],
              ['Track', preview.track_id || '-'],
              ['청크 수', String(preview.chunks_count || chunks.length || 0)],
              ['본문 길이', String(preview.content_length || 0)],
              ['수정일', shortDate(preview.updated_at)]
            ].map(([label, value]) => (
              <div key={label} style={{ padding: 14, borderRadius: 'var(--radius-md)', background: 'var(--bg-subtle)' }}>
                <div className="eyebrow" style={{ marginBottom: 6 }}>
                  {label}
                </div>
                <div className="mono" style={{ fontSize: 13, fontWeight: 600, color: 'var(--fg-primary)', wordBreak: 'break-all' }}>
                  {value}
                </div>
              </div>
            ))}
          </div>
          <div className="card" style={{ padding: 'var(--pad-card)' }}>
            <div className="eyebrow" style={{ marginBottom: 8 }}>
              문서 미리보기
            </div>
            <div className="rich">
              <p style={{ whiteSpace: 'pre-wrap' }}>{preview.content || preview.content_summary || '미리보기 본문이 없습니다.'}</p>
            </div>
          </div>
        </div>
      )}

      {tab === 'chunk' && (
        <div className="grid" style={{ gridTemplateColumns: 'minmax(0, 0.92fr) minmax(360px, 1.08fr)', gap: 14, alignItems: 'start' }}>
          <div className="col" style={{ gap: 10 }}>
            {chunks.map((chunk, index) => (
              <div
                key={chunk.id || index}
                style={{
                  border: `1px solid ${selectedChunkId === chunk.id ? 'var(--accent)' : 'var(--border-default)'}`,
                  borderRadius: 'var(--radius-md)',
                  overflow: 'hidden',
                  background: selectedChunkId === chunk.id ? 'var(--accent-soft)' : '#fff'
                }}
              >
                <div className="row" style={{ gap: 8, padding: '9px 12px', background: 'var(--bg-subtle)', fontSize: 12 }}>
                  <span className="mono" style={{ fontWeight: 700, color: 'var(--accent)' }}>{chunk.id || `chunk-${index + 1}`}</span>
                  <span className="muted">순서 {chunk.chunk_order_index ?? index + 1}</span>
                  <div className="grow" />
                  <span className="num muted">{chunk.tokens || 0} tokens</span>
                </div>
                <div style={{ padding: '11px 13px', fontSize: 13, lineHeight: 1.6, color: 'var(--fg-primary-soft)', whiteSpace: 'pre-wrap' }}>
                  {chunk.content || '청크 본문이 없습니다.'}
                </div>
                {chunk.id && (
                  <div className="row" style={{ gap: 6, padding: '0 12px 12px' }}>
                    <Button type="button" size="sm" variant="outline" onClick={() => openChunkDetail(chunk.id)} disabled={chunkLoading && selectedChunkId === chunk.id}>
                      <LayersIcon className={chunkLoading && selectedChunkId === chunk.id ? 'spin size-4' : 'size-4'} /> 상세
                    </Button>
                  </div>
                )}
              </div>
            ))}
            {!chunks.length && <div className="empty" style={{ padding: 18 }}>조회된 청크가 없습니다.</div>}
          </div>

          <div className="card" style={{ padding: 'var(--pad-card)', minHeight: 360 }}>
            {!chunkDetail && !chunkLoading && (
              <div className="empty" style={{ padding: 32 }}>
                청크를 선택하면 LightRAG 청크 상세, 연결 엔티티·관계, 삭제 영향도를 확인할 수 있습니다.
              </div>
            )}
            {chunkLoading && (
              <div className="empty" style={{ padding: 32 }}>
                <RefreshCwIcon className="spin size-4" /> 청크 상세를 불러오는 중입니다.
              </div>
            )}
            {chunkDetail && !chunkLoading && (
              <div className="col" style={{ gap: 14 }}>
                <div className="row" style={{ gap: 8 }}>
                  <span className="badge blue">{chunkDetail.chunk_type || 'text'}</span>
                  <span className="mono" style={{ fontSize: 12, fontWeight: 700, color: 'var(--fg-primary)', wordBreak: 'break-all' }}>{chunkDetail.chunk_id}</span>
                  <div className="grow" />
                  <span className="num muted">{chunkDetail.tokens || 0} tokens</span>
                </div>
                <div className="grid" style={{ gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
                  {[
                    ['문서', chunkDetail.doc_id || '-'],
                    ['순서', String(chunkDetail.chunk_order_index ?? '-')],
                    ['본문 길이', String(chunkDetail.content_length || 0)]
                  ].map(([label, value]) => (
                    <div key={label} style={{ padding: 10, borderRadius: 'var(--radius-md)', background: 'var(--bg-subtle)' }}>
                      <div className="eyebrow" style={{ marginBottom: 5 }}>{label}</div>
                      <div className="mono" style={{ fontSize: 11.5, wordBreak: 'break-all', color: 'var(--fg-primary)' }}>{value}</div>
                    </div>
                  ))}
                </div>

                <label className="field">
                  <span>청크 본문</span>
                  <Textarea
                    value={chunkEditContent}
                    onChange={(event) => setChunkEditContent(event.target.value)}
                    style={{ minHeight: 180, fontFamily: 'var(--mono)', fontSize: 12.5 }}
                  />
                </label>
                <div className="row wrap" style={{ gap: 10 }}>
                  <label className="check">
                    <input type="checkbox" checked={clearStructuredContent} onChange={(event) => setClearStructuredContent(event.target.checked)} />
                    structured content 제거
                  </label>
                  <div className="grow" />
                  <Button type="button" size="sm" variant="outline" onClick={() => previewDeletion(chunkDeletionDraft(chunkDetail.chunk_id))} disabled={deletionLoading}>
                    <Trash2Icon className={deletionLoading ? 'spin size-4' : 'size-4'} /> 삭제 영향
                  </Button>
                  <Button type="button" size="sm" onClick={saveChunkDetail} disabled={chunkSaving}>
                    <SaveIcon className={chunkSaving ? 'spin size-4' : 'size-4'} /> 청크 저장
                  </Button>
                </div>

                {chunkError && (
                  <div className="badge red" style={{ justifyContent: 'flex-start', whiteSpace: 'normal', borderRadius: 'var(--radius-md)', padding: 10 }}>
                    {chunkError}
                  </div>
                )}

                <div className="grid" style={{ gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                  <div>
                    <div className="eyebrow" style={{ marginBottom: 8 }}>연결 엔티티 {chunkDetail.entities?.length || 0}</div>
                    <div className="col" style={{ gap: 6 }}>
                      {(chunkDetail.entities || []).slice(0, 8).map((entity) => (
                        <div key={entity.entity_id} className="row" style={{ gap: 7, padding: 8, border: '1px solid var(--border-default)', borderRadius: 'var(--radius-md)' }}>
                          <span className="badge blue">{entity.entity_type || 'ENTITY'}</span>
                          <span className="grow" style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 12.5, fontWeight: 600 }}>{entity.entity_id}</span>
                          <span className="num muted">{entity.degree || 0}</span>
                          <Button type="button" size="sm" variant="ghost" onClick={() => previewDeletion(entityDeletionDraft(entity.entity_id))} disabled={deletionLoading}>
                            <Trash2Icon className="size-4" />
                          </Button>
                        </div>
                      ))}
                      {!chunkDetail.entities?.length && <div className="empty" style={{ padding: 12 }}>연결 엔티티가 없습니다.</div>}
                    </div>
                  </div>
                  <div>
                    <div className="eyebrow" style={{ marginBottom: 8 }}>연결 관계 {chunkDetail.relations?.length || 0}</div>
                    <div className="col" style={{ gap: 6 }}>
                      {(chunkDetail.relations || []).slice(0, 8).map((relation, index) => (
                        <div key={`${relation.source_id}-${relation.target_id}-${index}`} className="col" style={{ gap: 5, padding: 8, border: '1px solid var(--border-default)', borderRadius: 'var(--radius-md)', fontSize: 12 }}>
                          <div className="row wrap" style={{ gap: 5 }}>
                            <span className="badge blue">{relation.source_id}</span>
                            <ChevronRightIcon className="size-3 muted" />
                            <span className="badge gray">{relation.target_id}</span>
                            <div className="grow" />
                            <Button type="button" size="sm" variant="ghost" onClick={() => previewDeletion(relationDeletionDraft(relation.source_id, relation.target_id))} disabled={deletionLoading}>
                              <Trash2Icon className="size-4" />
                            </Button>
                          </div>
                          {(relation.keywords || relation.description) && <div className="muted">{relation.keywords || relation.description}</div>}
                        </div>
                      ))}
                      {!chunkDetail.relations?.length && <div className="empty" style={{ padding: 12 }}>연결 관계가 없습니다.</div>}
                    </div>
                  </div>
                </div>

                <div className="grid" style={{ gridTemplateColumns: 'repeat(4, 1fr)', gap: 8 }}>
                  {[
                    ['삭제 엔티티', impactCount(chunkDetail.deletion_impact, 'entities_to_delete')],
                    ['갱신 엔티티', impactCount(chunkDetail.deletion_impact, 'entities_to_update')],
                    ['삭제 관계', impactCount(chunkDetail.deletion_impact, 'relations_to_delete')],
                    ['갱신 관계', impactCount(chunkDetail.deletion_impact, 'relations_to_update')]
                  ].map(([label, value]) => (
                    <div key={String(label)} style={{ padding: 10, borderRadius: 'var(--radius-md)', background: 'var(--bg-subtle)' }}>
                      <div className="eyebrow" style={{ marginBottom: 4 }}>{String(label)}</div>
                      <div className="num" style={{ fontSize: 18, fontWeight: 800, color: 'var(--fg-primary)' }}>{Number(value).toLocaleString()}</div>
                    </div>
                  ))}
                </div>

                <details>
                  <summary className="eyebrow" style={{ cursor: 'pointer', marginBottom: 8 }}>structured content / 삭제 영향도 JSON</summary>
                  <pre className="mono" style={{ maxHeight: 240, overflow: 'auto', padding: 12, borderRadius: 'var(--radius-md)', background: 'var(--bg-subtle)', fontSize: 11.5 }}>
                    {prettyJson({ structured_content: chunkDetail.structured_content, deletion_impact: chunkDetail.deletion_impact })}
                  </pre>
                </details>
              </div>
            )}
          </div>
        </div>
      )}

      {tab === 'graph' && (
        <div className="col" style={{ gap: 14 }}>
          <div className="row wrap" style={{ gap: 8 }}>
            <span className="badge blue">전체 엔티티 {(graphEntityTypes || []).reduce((sum, item) => sum + Number(item.count || 0), 0).toLocaleString()}</span>
            <span className="badge gray">엔티티 페이지 {graphEntityPagination.page || graphEntityPage} / {graphEntityPagination.total_pages || 1}</span>
            <span className="badge gray">관계 페이지 {graphRelationPagination.page || graphRelationPage} / {graphRelationPagination.total_pages || 1}</span>
            {graphLoading && <span className="badge outline"><RefreshCwIcon className="spin size-4" /> 조회 중</span>}
            <div className="grow" />
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => {
                void loadGraphEntityTypes()
                void loadGraphEntities(graphEntityPage)
                void loadGraphRelations(graphRelationPage)
              }}
              disabled={graphLoading}
            >
              <RefreshCwIcon className={graphLoading ? 'spin size-4' : 'size-4'} /> 새로고침
            </Button>
          </div>

          <div className="grid" style={{ gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)', gap: 16, alignItems: 'start' }}>
            <div className="col" style={{ gap: 12 }}>
              <div style={{ padding: 13, borderRadius: 'var(--radius-md)', border: '1px solid var(--border-default)', background: '#fff' }}>
                <div className="row" style={{ gap: 8, marginBottom: 10 }}>
                  <NetworkIcon className="size-4" style={{ color: 'var(--accent)' }} />
                  <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--fg-primary)' }}>
                    엔티티 {Number(graphEntityPagination.total_count ?? graphEntities.length).toLocaleString()}
                  </span>
                </div>
                <form className="grid" style={{ gridTemplateColumns: 'minmax(0, 1fr) 160px auto', gap: 8 }} onSubmit={searchGraphEntities}>
                  <Input
                    placeholder="엔티티명 검색"
                    value={graphEntitySearch}
                    onChange={(event) => setGraphEntitySearch(event.target.value)}
                  />
                  <select
                    className={selectClass}
                    value={graphEntityType}
                    onChange={(event) => {
                      setGraphEntityType(event.target.value)
                      setGraphEntityPage(1)
                    }}
                  >
                    <option value="">전체 타입</option>
                    {graphEntityTypes.map((entityType) => (
                      <option key={entityType.entity_type || 'UNKNOWN'} value={entityType.entity_type || 'UNKNOWN'}>
                        {entityType.entity_type || 'UNKNOWN'} ({entityType.count})
                      </option>
                    ))}
                  </select>
                  <Button type="submit" size="sm" disabled={graphLoading}>
                    <SearchIcon className="size-4" /> 조회
                  </Button>
                </form>
                <div className="row wrap" style={{ gap: 6, marginTop: 10 }}>
                  {graphEntityTypes.slice(0, 8).map((entityType) => {
                    const typeValue = entityType.entity_type || 'UNKNOWN'
                    return (
                      <button
                        key={typeValue}
                        type="button"
                        className={`badge ${graphEntityType === typeValue ? 'blue' : 'outline'}`}
                        onClick={() => {
                          setGraphEntityType(graphEntityType === typeValue ? '' : typeValue)
                          setGraphEntityPage(1)
                        }}
                      >
                        {typeValue} <span className="num">{entityType.count}</span>
                      </button>
                    )
                  })}
                  {graphEntityType && (
                    <button type="button" className="badge gray" onClick={() => setGraphEntityType('')}>
                      필터 해제
                    </button>
                  )}
                </div>
              </div>

              <div className="col" style={{ gap: 7 }}>
                {graphEntities.map((entity) => (
                  <div key={entity.entity_id} className="col" style={{ gap: 7, padding: '10px 12px', border: '1px solid var(--border-default)', borderRadius: 'var(--radius-md)', background: '#fff' }}>
                    <div className="row" style={{ gap: 8 }}>
                      <span style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--accent)', flexShrink: 0 }} />
                      <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--fg-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{entity.entity_id}</span>
                      {entity.entity_type && <span className="badge gray">{entity.entity_type}</span>}
                      <div className="grow" />
                      <span className="muted num" style={{ fontSize: 11.5 }}>연결 {entity.degree || 0}</span>
                    </div>
                    {(entity.description || entity.source_id) && (
                      <div className="muted" style={{ fontSize: 11.5, lineHeight: 1.45, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {entity.description || entity.source_id}
                      </div>
                    )}
                    <div className="row" style={{ gap: 6 }}>
                      <Button type="button" size="sm" variant="ghost" onClick={() => openRelatedEntities(entity.entity_id)} disabled={relatedLoading && relatedEntityId === entity.entity_id}>
                        <NetworkIcon className={relatedLoading && relatedEntityId === entity.entity_id ? 'spin size-4' : 'size-4'} /> 관련
                      </Button>
                      <Button type="button" size="sm" variant="ghost" onClick={() => previewDeletion(entityDeletionDraft(entity.entity_id))} disabled={deletionLoading}>
                        <Trash2Icon className="size-4" /> 삭제 영향
                      </Button>
                    </div>
                  </div>
                ))}
                {!graphEntities.length && <div className="empty" style={{ padding: 18 }}>엔티티 결과가 없습니다.</div>}
              </div>

              <div className="row" style={{ gap: 8 }}>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => setGraphEntityPage((page) => Math.max(1, page - 1))}
                  disabled={graphLoading || !graphEntityPagination.has_prev}
                >
                  이전
                </Button>
                <span className="badge gray">{graphEntityPagination.page || graphEntityPage} / {graphEntityPagination.total_pages || 1}</span>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => setGraphEntityPage((page) => page + 1)}
                  disabled={graphLoading || !graphEntityPagination.has_next}
                >
                  다음
                </Button>
              </div>

              {relatedEntityId && (
                <div style={{ padding: 13, borderRadius: 'var(--radius-md)', border: '1px solid var(--border-default)', background: 'var(--bg-subtle)' }}>
                  <div className="row" style={{ gap: 8, marginBottom: 10 }}>
                    <NetworkIcon className="size-4" style={{ color: 'var(--accent)' }} />
                    <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--fg-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      관련 엔티티: {relatedEntityId}
                    </span>
                    <div className="grow" />
                    <Button type="button" size="sm" variant="ghost" onClick={() => setRelatedEntityId(null)}>
                      <XIcon className="size-4" />
                    </Button>
                  </div>
                  {relatedLoading && <div className="empty" style={{ padding: 12 }}><RefreshCwIcon className="spin size-4" /> 관련 엔티티를 조회 중입니다.</div>}
                  {!relatedLoading && (
                    <div className="col" style={{ gap: 6 }}>
                      {relatedEntities.map((entity) => (
                        <div key={entity.entity_id} className="row" style={{ gap: 7, padding: 8, borderRadius: 'var(--radius-md)', background: '#fff' }}>
                          <span className="badge blue">{entity.entity_type || 'ENTITY'}</span>
                          <span className="grow" style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 12.5, fontWeight: 600 }}>{entity.entity_id}</span>
                          <span className="num muted">{entity.degree || 0}</span>
                          <Button type="button" size="sm" variant="ghost" onClick={() => previewDeletion(entityDeletionDraft(entity.entity_id))} disabled={deletionLoading}>
                            <Trash2Icon className="size-4" />
                          </Button>
                        </div>
                      ))}
                      {!relatedEntities.length && <div className="empty" style={{ padding: 12 }}>관련 엔티티가 없습니다.</div>}
                    </div>
                  )}
                </div>
              )}
            </div>

            <div className="col" style={{ gap: 12 }}>
              <div style={{ padding: 13, borderRadius: 'var(--radius-md)', border: '1px solid var(--border-default)', background: '#fff' }}>
                <div className="row" style={{ gap: 8, marginBottom: 10 }}>
                  <LinkIcon className="size-4" style={{ color: 'var(--accent)' }} />
                  <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--fg-primary)' }}>
                    관계 {Number(graphRelationPagination.total_count ?? graphRelations.length).toLocaleString()}
                  </span>
                </div>
                <form className="grid" style={{ gridTemplateColumns: 'minmax(0, 1fr) auto', gap: 8 }} onSubmit={searchGraphRelations}>
                  <Input
                    placeholder="출발/도착/키워드 검색"
                    value={graphRelationSearch}
                    onChange={(event) => setGraphRelationSearch(event.target.value)}
                  />
                  <Button type="submit" size="sm" disabled={graphLoading}>
                    <SearchIcon className="size-4" /> 조회
                  </Button>
                </form>
              </div>

              <div className="col" style={{ gap: 7 }}>
                {graphRelations.map((relation, index) => (
                  <div key={`${relation.source_id}-${relation.target_id}-${index}`} className="col" style={{ gap: 6, padding: '10px 12px', border: '1px solid var(--border-default)', borderRadius: 'var(--radius-md)', background: '#fff', fontSize: 12.5 }}>
                    <div className="row wrap" style={{ gap: 6 }}>
                      <span className="badge blue">{relation.source_id}</span>
                      <ChevronRightIcon className="size-3 muted" />
                      <span className="badge gray">{relation.target_id}</span>
                      <div className="grow" />
                      {typeof relation.weight === 'number' && <span className="num muted">{relation.weight.toFixed(2)}</span>}
                      <Button type="button" size="sm" variant="ghost" onClick={() => previewDeletion(relationDeletionDraft(relation.source_id, relation.target_id))} disabled={deletionLoading}>
                        <Trash2Icon className="size-4" />
                      </Button>
                    </div>
                    {(relation.keywords || relation.description) && (
                      <div className="muted" style={{ fontSize: 11.5, lineHeight: 1.45 }}>
                        {relation.keywords || relation.description}
                      </div>
                    )}
                    {relation.source_chunk_id && <span className="mono muted" style={{ fontSize: 10.5 }}>{relation.source_chunk_id}</span>}
                  </div>
                ))}
                {!graphRelations.length && <div className="empty" style={{ padding: 18 }}>관계 결과가 없습니다.</div>}
              </div>

              <div className="row" style={{ gap: 8 }}>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => setGraphRelationPage((page) => Math.max(1, page - 1))}
                  disabled={graphLoading || !graphRelationPagination.has_prev}
                >
                  이전
                </Button>
                <span className="badge gray">{graphRelationPagination.page || graphRelationPage} / {graphRelationPagination.total_pages || 1}</span>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => setGraphRelationPage((page) => page + 1)}
                  disabled={graphLoading || !graphRelationPagination.has_next}
                >
                  다음
                </Button>
              </div>
            </div>
          </div>

          {(graphError || Boolean(detail.errors?.length)) && (
            <div style={{ padding: 12, borderRadius: 'var(--radius-md)', background: 'var(--warning-soft)', color: '#9a5b08', fontSize: 12 }}>
              {graphError || `일부 그래프 정보를 불러오지 못했습니다. ${detail.errors?.map((error) => error.source).join(', ')}`}
            </div>
          )}
        </div>
      )}
    </Modal>
  )
}

function KmsDocumentReingestModal({
  detail,
  form,
  updateForm,
  categories,
  submitting,
  error,
  onSubmit,
  onClose
}: {
  detail: KmsDocumentDetail
  form: typeof initialDocumentReingestForm
  updateForm: (patch: Partial<typeof initialDocumentReingestForm>) => void
  categories: Category[]
  submitting: boolean
  error: string
  onSubmit: (event: FormEvent) => void
  onClose: () => void
}) {
  const preview = detail.preview
  const oldTitle = preview.file_path || preview.doc_nm || preview.id

  return (
    <Modal
      lg
      title="문서 재지식화"
      icon={RotateCwIcon}
      onClose={onClose}
      footer={
        <>
          <Button type="button" variant="outline" onClick={onClose}>
            취소
          </Button>
          <Button type="submit" form="document-reingest-form" disabled={submitting || !form.title.trim() || !form.body.trim()}>
            <RotateCwIcon className={submitting ? 'spin size-4' : 'size-4'} /> {submitting ? '재지식화 중' : '재지식화'}
          </Button>
        </>
      }
    >
      <form id="document-reingest-form" className="col" style={{ gap: 14 }} onSubmit={onSubmit}>
        <div className="row" style={{ gap: 10, padding: 12, borderRadius: 'var(--radius-md)', background: 'var(--accent-soft)', border: '1px solid #c9d8f7' }}>
          <ShieldIcon className="size-4" style={{ color: 'var(--accent)', flexShrink: 0 }} />
          <div style={{ fontSize: 12, color: 'var(--fg-primary-soft)', lineHeight: 1.55 }}>
            새 본문을 먼저 LightRAG에 지식화하고, 새 문서가 확인된 뒤 기존 문서를 정리합니다. 실패하면 기존 문서는 유지됩니다.
          </div>
        </div>

        <div className="grid" style={{ gridTemplateColumns: '1fr 1fr', gap: 14 }}>
          <div style={{ padding: 12, borderRadius: 'var(--radius-md)', background: 'var(--bg-subtle)' }}>
            <div className="eyebrow" style={{ marginBottom: 6 }}>기존 문서</div>
            <div className="mono" style={{ fontSize: 12, wordBreak: 'break-all', color: 'var(--fg-primary)' }}>{preview.id}</div>
            <div className="muted" style={{ marginTop: 6, fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{oldTitle}</div>
          </div>
          <label className="field">
            <span>카테고리</span>
            <select className={selectClass} value={form.category_id} onChange={(event) => updateForm({ category_id: event.target.value })}>
              <option value="">카테고리 없음</option>
              {categories
                .filter((category) => category.is_active)
                .map((category) => (
                  <option key={category.category_id} value={category.category_id}>
                    {'　'.repeat(categoryDepth(category))}
                    {category.name}
                  </option>
                ))}
            </select>
          </label>
        </div>

        <div className="grid" style={{ gridTemplateColumns: '1fr 1fr', gap: 14 }}>
          <label className="field">
            <span>새 제목</span>
            <Input value={form.title} onChange={(event) => updateForm({ title: event.target.value })} />
          </label>
          <label className="field">
            <span>새 출처명</span>
            <Input value={form.file_source} onChange={(event) => updateForm({ file_source: event.target.value })} />
          </label>
        </div>

        <label className="field">
          <span>수정 본문</span>
          <Textarea
            value={form.body}
            onChange={(event) => updateForm({ body: event.target.value })}
            style={{ minHeight: 220, fontFamily: 'var(--mono)' }}
          />
        </label>

        <div className="grid" style={{ gridTemplateColumns: '1fr 1fr', gap: 14 }}>
          <label className="field">
            <span>유효 시작</span>
            <Input type="datetime-local" value={form.valid_from} onChange={(event) => updateForm({ valid_from: event.target.value })} />
          </label>
          <label className="field">
            <span>유효 종료</span>
            <Input type="datetime-local" value={form.valid_until} onChange={(event) => updateForm({ valid_until: event.target.value })} />
          </label>
        </div>

        <div className="row wrap" style={{ gap: 16 }}>
          <label className="check">
            <input type="checkbox" checked={form.enabled} onChange={(event) => updateForm({ enabled: event.target.checked })} />
            답변 후보에 사용
          </label>
          <label className="check">
            <input type="checkbox" checked={form.delete_previous} onChange={(event) => updateForm({ delete_previous: event.target.checked })} />
            성공 후 기존 문서 정리
          </label>
        </div>

        {error && (
          <div className="badge red" style={{ justifyContent: 'flex-start', whiteSpace: 'normal', borderRadius: 'var(--radius-md)', padding: 10 }}>
            {error}
          </div>
        )}
      </form>
    </Modal>
  )
}

function FaqAnswerSettings({
  answer,
  onClose,
  onSave,
  guidance,
  guidanceLoading,
  onCreateGuidance,
  onDeleteGuidance
}: {
  answer: FaqAnswer
  onClose: () => void
  onSave: (answerId: string, payload: Record<string, unknown>, rebuild: boolean) => Promise<void>
  guidance: FaqGuidance[]
  guidanceLoading: boolean
  onCreateGuidance: (answerId: string, payload: { guidance_type: string; text: string; weight: number }) => Promise<void>
  onDeleteGuidance: (answerId: string, guidanceId: string) => Promise<void>
}) {
  const [form, setForm] = useState({
    title: answer.title || '',
    body: answer.body || '',
    approved_summary: answer.approved_summary || '',
    status: answer.status || 'draft',
    valid_from: dateInputValue(answer.valid_from),
    valid_until: dateInputValue(answer.valid_until),
    tags: (answer.tags || []).join(', ')
  })
  const [guidanceForm, setGuidanceForm] = useState({
    guidance_type: 'keyword',
    text: '',
    weight: '1'
  })
  const [saving, setSaving] = useState(false)
  const [guidanceSaving, setGuidanceSaving] = useState(false)
  const [dirty, setDirty] = useState(false)
  const update = (patch: Partial<typeof form>) => {
    setForm((value) => ({ ...value, ...patch }))
    setDirty(true)
  }
  const submit = async (rebuild: boolean) => {
    setSaving(true)
    try {
      await onSave(
        answer.answer_id,
        {
          title: form.title,
          body: form.body,
          approved_summary: form.approved_summary || null,
          status: form.status,
          valid_from: form.valid_from || null,
          valid_until: form.valid_until || null,
          tags: splitTags(form.tags)
        },
        rebuild
      )
    } finally {
      setSaving(false)
    }
  }
  const addGuidance = async () => {
    if (!guidanceForm.text.trim()) return
    setGuidanceSaving(true)
    try {
      await onCreateGuidance(answer.answer_id, {
        guidance_type: guidanceForm.guidance_type,
        text: guidanceForm.text.trim(),
        weight: Number(guidanceForm.weight || 1)
      })
      setGuidanceForm({ guidance_type: 'keyword', text: '', weight: '1' })
      setDirty(true)
    } finally {
      setGuidanceSaving(false)
    }
  }
  const removeGuidance = async (guidanceId: string) => {
    setGuidanceSaving(true)
    try {
      await onDeleteGuidance(answer.answer_id, guidanceId)
      setDirty(true)
    } finally {
      setGuidanceSaving(false)
    }
  }

  return (
    <Modal
      lg
      title="FAQ 답변 항목 설정"
      icon={BookOpenIcon}
      onClose={onClose}
      footer={
        <>
          <Button type="button" variant="outline" onClick={onClose}>
            취소
          </Button>
          <Button type="button" variant="outline" disabled={saving} onClick={() => submit(false)}>
            <SaveIcon className="size-4" /> 저장
          </Button>
          <Button type="button" disabled={saving} onClick={() => submit(true)}>
            <RotateCwIcon className={saving ? 'spin size-4' : 'size-4'} /> 저장 · 벡터 재생성
          </Button>
        </>
      }
    >
      <div className="row" style={{ gap: 10, marginBottom: 16, flexWrap: 'wrap' }}>
        <StatusBadge status={answer.status} />
        <span className="badge blue">
          <LayersIcon className="size-3" /> 벡터 인덱스
        </span>
        <span className="muted mono" style={{ fontSize: 12 }}>{answer.answer_id}</span>
        <div className="grow" />
        <span className="muted" style={{ fontSize: 12 }}>버전 {answer.version || 1}</span>
      </div>
      <div className="col" style={{ gap: 14 }}>
        <label className="field">
          <span>질문 또는 대표 제목</span>
          <Input value={form.title} onChange={(event) => update({ title: event.target.value })} />
        </label>
        <div className="grid" style={{ gridTemplateColumns: '1fr 1fr 1fr', gap: 14 }}>
          <label className="field">
            <span>게시 상태</span>
            <select className={selectClass} value={form.status} onChange={(event) => update({ status: event.target.value })}>
              <option value="draft">초안</option>
              <option value="published">게시</option>
              <option value="archived">보관</option>
              <option value="expired">만료</option>
            </select>
          </label>
          <label className="field">
            <span>유효 시작</span>
            <Input type="datetime-local" value={form.valid_from} onChange={(event) => update({ valid_from: event.target.value })} />
          </label>
          <label className="field">
            <span>유효 종료</span>
            <Input type="datetime-local" value={form.valid_until} onChange={(event) => update({ valid_until: event.target.value })} />
          </label>
        </div>
        <label className="field">
          <span>답변 본문</span>
          <Textarea value={form.body} onChange={(event) => update({ body: event.target.value })} style={{ minHeight: 160 }} />
        </label>
        <label className="field">
          <span>요약</span>
          <Textarea value={form.approved_summary} onChange={(event) => update({ approved_summary: event.target.value })} style={{ minHeight: 70 }} />
        </label>
        <div className="field">
          <span>태그·키워드</span>
          <TagInput value={form.tags} onChange={(tags) => update({ tags })} placeholder="태그 또는 키워드 입력" />
        </div>
        <div style={{ height: 2 }} />
        <div className="row" style={{ marginBottom: -4 }}>
          <span className="eyebrow">매칭 가이드</span>
          <div className="grow" />
          <span className="muted" style={{ fontSize: 11.5 }}>
            답변 후보 점수 계산과 벡터 재생성에 활용됩니다.
          </span>
        </div>
        <div className="grid" style={{ gridTemplateColumns: '150px minmax(0, 1fr) 100px auto', gap: 8 }}>
          <select
            className={selectClass}
            value={guidanceForm.guidance_type}
            onChange={(event) => setGuidanceForm((value) => ({ ...value, guidance_type: event.target.value }))}
          >
            <option value="keyword">키워드</option>
            <option value="question">질문 예시</option>
            <option value="synonym">동의어</option>
            <option value="negative_keyword">제외 키워드</option>
            <option value="note">운영 메모</option>
          </select>
          <Input
            value={guidanceForm.text}
            onChange={(event) => setGuidanceForm((value) => ({ ...value, text: event.target.value }))}
            placeholder="예: 환불, 취소 수수료, 결제 취소"
          />
          <Input
            type="number"
            min="0"
            max="10"
            step="0.1"
            value={guidanceForm.weight}
            onChange={(event) => setGuidanceForm((value) => ({ ...value, weight: event.target.value }))}
          />
          <Button type="button" variant="outline" onClick={addGuidance} disabled={guidanceSaving || !guidanceForm.text.trim()}>
            <PlusIcon className={guidanceSaving ? 'spin size-4' : 'size-4'} /> 추가
          </Button>
        </div>
        <div style={{ border: '1px solid var(--border-default)', borderRadius: 'var(--radius-md)', overflow: 'hidden' }}>
          <table className="tbl">
            <thead>
              <tr>
                <th style={{ paddingLeft: 12 }}>유형</th>
                <th>내용</th>
                <th>가중치</th>
                <th>생성일</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {guidance.map((item) => (
                <tr key={item.guidance_id}>
                  <td style={{ paddingLeft: 12 }}><span className="badge gray">{item.guidance_type}</span></td>
                  <td style={{ color: 'var(--fg-primary)' }}>{item.text}</td>
                  <td className="num">{Number(item.weight || 0).toFixed(1)}</td>
                  <td className="num muted" style={{ fontSize: 12 }}>{shortDate(item.create_time)}</td>
                  <td>
                    <Button type="button" size="sm" variant="ghost" onClick={() => removeGuidance(item.guidance_id)} disabled={guidanceSaving}>
                      <Trash2Icon className="size-4" /> 삭제
                    </Button>
                  </td>
                </tr>
              ))}
              {guidanceLoading && (
                <tr>
                  <td colSpan={5} className="empty" style={{ padding: 18 }}>매칭 가이드를 불러오는 중입니다.</td>
                </tr>
              )}
              {!guidanceLoading && !guidance.length && (
                <tr>
                  <td colSpan={5} className="empty" style={{ padding: 18 }}>등록된 매칭 가이드가 없습니다.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        {dirty && (
          <div style={{ display: 'flex', gap: 10, padding: 13, borderRadius: 'var(--radius-md)', background: 'var(--accent-soft)', border: '1px solid #c9d8f7', fontSize: 12.5, color: 'var(--fg-primary-soft)', lineHeight: 1.55 }}>
            <RefreshCwIcon className="size-4" style={{ color: 'var(--accent)', flexShrink: 0, marginTop: 1 }} />
            <span>
              변경 내용은 저장 후 FAQ 답변 API에 반영됩니다. 본문이나 요약을 바꾼 경우 벡터 재생성을 함께 실행해야 검색 후보 품질이 유지됩니다.
            </span>
          </div>
        )}
      </div>
    </Modal>
  )
}

function ExistingKnowledgeLinkModal({
  form,
  updateForm,
  categories,
  unlinkedDocumentCount,
  unlinkedFaqCount,
  submitting,
  error,
  result,
  onSubmit,
  onClose
}: {
  form: typeof initialExistingLinkForm
  updateForm: (patch: Partial<typeof initialExistingLinkForm>) => void
  categories: Category[]
  unlinkedDocumentCount: number
  unlinkedFaqCount: number
  submitting: boolean
  error: string
  result: any
  onSubmit: (event: FormEvent) => void
  onClose: () => void
}) {
  const targetCount =
    (form.include_kms ? unlinkedDocumentCount : 0) +
    (form.include_faq ? unlinkedFaqCount : 0)
  const canSubmit = form.link_all
    ? form.include_kms || form.include_faq
    : targetCount > 0
  return (
    <Modal
      lg
      title="기존 지식 연결"
      icon={LinkIcon}
      onClose={onClose}
      footer={
        <>
          <Button type="button" variant="outline" onClick={onClose}>닫기</Button>
          <Button type="submit" form="existing-link-form" disabled={submitting || !canSubmit}>
            <LinkIcon className={submitting ? 'spin size-4' : 'size-4'} /> 원장에 연결
          </Button>
        </>
      }
    >
      <form id="existing-link-form" className="col" style={{ gap: 16 }} onSubmit={onSubmit}>
        <div style={{ display: 'flex', gap: 10, padding: 13, borderRadius: 'var(--radius-md)', background: 'var(--accent-soft)', border: '1px solid #c9d8f7', color: 'var(--fg-primary-soft)', fontSize: 12.5, lineHeight: 1.55 }}>
          <ShieldIcon className="size-4" style={{ color: 'var(--accent)', flexShrink: 0, marginTop: 1 }} />
          <span>
            기존 LightRAG 문서와 FAQ 답변을 재지식화하지 않고 어드민 원장에 연결합니다.
            연결 후 카테고리, 유효기간, 사용 여부가 통합 검색 후보 선정에 적용됩니다.
          </span>
        </div>

        <div className="grid" style={{ gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <label
            className="row"
            style={{
              gap: 10,
              padding: 12,
              border: '1px solid var(--border-default)',
              borderRadius: 'var(--radius-md)',
              background: form.link_all ? 'var(--accent-soft)' : '#fff',
              cursor: 'pointer'
            }}
          >
            <input type="radio" checked={form.link_all} onChange={() => updateForm({ link_all: true })} />
            <span className="col" style={{ gap: 3 }}>
              <span style={{ fontSize: 13.5, fontWeight: 700, color: 'var(--fg-primary)' }}>워크스페이스 전체</span>
              <span className="muted" style={{ fontSize: 11.5 }}>LightRAG API에서 전체 페이지를 조회해 미연결 항목만 연결합니다.</span>
            </span>
          </label>
          <label
            className="row"
            style={{
              gap: 10,
              padding: 12,
              border: '1px solid var(--border-default)',
              borderRadius: 'var(--radius-md)',
              background: !form.link_all ? 'var(--accent-soft)' : '#fff',
              cursor: 'pointer'
            }}
          >
            <input type="radio" checked={!form.link_all} onChange={() => updateForm({ link_all: false })} />
            <span className="col" style={{ gap: 3 }}>
              <span style={{ fontSize: 13.5, fontWeight: 700, color: 'var(--fg-primary)' }}>현재 목록</span>
              <span className="muted" style={{ fontSize: 11.5 }}>현재 화면에 불러온 미연결 항목만 연결합니다.</span>
            </span>
          </label>
        </div>

        <div className="grid" style={{ gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <label className="row" style={{ gap: 10, padding: 12, border: '1px solid var(--border-default)', borderRadius: 'var(--radius-md)' }}>
            <input type="checkbox" checked={form.include_kms} onChange={(event) => updateForm({ include_kms: event.target.checked })} />
            <FileTextIcon className="size-4" style={{ color: 'var(--accent)' }} />
            <span className="grow">
              <span style={{ display: 'block', fontSize: 13.5, fontWeight: 700, color: 'var(--fg-primary)' }}>KMS 문서</span>
              <span className="muted" style={{ fontSize: 11.5 }}>현재 목록 미연결 {unlinkedDocumentCount.toLocaleString()}건</span>
            </span>
          </label>
          <label className="row" style={{ gap: 10, padding: 12, border: '1px solid var(--border-default)', borderRadius: 'var(--radius-md)' }}>
            <input type="checkbox" checked={form.include_faq} onChange={(event) => updateForm({ include_faq: event.target.checked })} />
            <BookOpenIcon className="size-4" style={{ color: 'var(--accent)' }} />
            <span className="grow">
              <span style={{ display: 'block', fontSize: 13.5, fontWeight: 700, color: 'var(--fg-primary)' }}>FAQ 답변</span>
              <span className="muted" style={{ fontSize: 11.5 }}>현재 목록 미연결 {unlinkedFaqCount.toLocaleString()}건</span>
            </span>
          </label>
        </div>

        <div className="grid" style={{ gridTemplateColumns: 'minmax(0,1fr) 160px', gap: 12 }}>
          <label className="field">
            <span>기본 카테고리</span>
            <select className={selectClass} value={form.category_id} onChange={(event) => updateForm({ category_id: event.target.value })}>
              <option value="">카테고리 없음</option>
              {categories.map((category) => (
                <option key={category.category_id} value={category.category_id}>
                  {'　'.repeat(categoryDepth(category))}{category.name}
                </option>
              ))}
            </select>
            <FieldHelp>연결 후 개별 지식의 카테고리는 목록에서 다시 수정할 수 있습니다.</FieldHelp>
          </label>
          <label className="field">
            <span>최대 연결 수</span>
            <Input
              type="number"
              min="1"
              max="5000"
              value={form.max_items}
              onChange={(event) => updateForm({ max_items: event.target.value })}
            />
            <FieldHelp>전체 연결 시 API 페이지 조회 상한입니다.</FieldHelp>
          </label>
        </div>

        <div className="form-section">
          <div className="form-section-title">
            <CalendarIcon className="size-4" /> 검색 사용 조건
          </div>
          <DateRangeTimePicker validFrom={form.valid_from} validUntil={form.valid_until} onChange={updateForm} />
          <label className="check" style={{ marginTop: 10 }}>
            <input type="checkbox" checked={form.enabled} onChange={(event) => updateForm({ enabled: event.target.checked })} />
            답변 후보에 사용
          </label>
          <FieldHelp>실패 문서나 보관/만료 FAQ는 연결되더라도 자동으로 미사용 처리됩니다.</FieldHelp>
        </div>

        {error && <div className="badge red" style={{ justifyContent: 'flex-start', whiteSpace: 'normal', borderRadius: 'var(--radius-md)', padding: 10 }}>{error}</div>}
        {result && (
          <div className="row wrap" style={{ gap: 8, padding: 12, borderRadius: 'var(--radius-md)', border: '1px solid var(--border-default)', background: 'var(--bg-subtle)' }}>
            <span className="badge green">연결 {Number(result.summary?.linked_count || 0).toLocaleString()}건</span>
            <span className="badge gray">기존 연결 {Number(result.summary?.skipped_count || 0).toLocaleString()}건</span>
            {Number(result.summary?.error_count || 0) > 0 && <span className="badge red">오류 {Number(result.summary?.error_count || 0).toLocaleString()}건</span>}
          </div>
        )}
      </form>
    </Modal>
  )
}

export function KnowledgeManagement() {
  const user = useAuthStore((state) => state.user)
  const [sourceType, setSourceType] = useState<KnowledgeSourceType>('faq')
  const [form, setForm] = useState(initialKnowledgeForm)
  const [file, setFile] = useState<File | null>(null)
  const kmsWorkspace = useWorkspaceScopeStore((state) => state.kmsWorkspace)
  const faqWorkspace = useWorkspaceScopeStore((state) => state.faqWorkspace)
  const setKmsWorkspace = useWorkspaceScopeStore((state) => state.setKmsWorkspace)
  const setFaqWorkspace = useWorkspaceScopeStore((state) => state.setFaqWorkspace)
  const [items, setItems] = useState<any[]>([])
  const [categories, setCategories] = useState<Category[]>([])
  const [documents, setDocuments] = useState<KmsDocument[]>([])
  const [faqAnswers, setFaqAnswers] = useState<FaqAnswer[]>([])
  const [jobs, setJobs] = useState<Job[]>([])
  const [adding, setAdding] = useState(false)
  const [linkingExisting, setLinkingExisting] = useState(false)
  const [existingLinkForm, setExistingLinkForm] = useState(initialExistingLinkForm)
  const [existingLinkSubmitting, setExistingLinkSubmitting] = useState(false)
  const [existingLinkError, setExistingLinkError] = useState('')
  const [existingLinkResult, setExistingLinkResult] = useState<any>(null)
  const [view, setView] = useState<'table' | 'card'>('table')
  const [activeKnowledgeTab, setActiveKnowledgeTab] = useState<'all' | 'faq' | 'document'>('all')
  const [documentStatus, setDocumentStatus] = useState('all')
  const [faqStatus, setFaqStatus] = useState('all')
  const [faqSearch, setFaqSearch] = useState('')
  const [knowledgePage, setKnowledgePage] = useState(1)
  const [knowledgePageSize, setKnowledgePageSize] = useState(10)
  const [faqWorkspaceError, setFaqWorkspaceError] = useState('')
  const [documentDetail, setDocumentDetail] = useState<KmsDocumentDetail | null>(null)
  const [documentDetailLoadingId, setDocumentDetailLoadingId] = useState<string | null>(null)
  const [documentReingestDetail, setDocumentReingestDetail] = useState<KmsDocumentDetail | null>(null)
  const [documentReingestForm, setDocumentReingestForm] = useState(initialDocumentReingestForm)
  const [documentReingestLoadingId, setDocumentReingestLoadingId] = useState<string | null>(null)
  const [documentReingestSubmitting, setDocumentReingestSubmitting] = useState(false)
  const [documentReingestError, setDocumentReingestError] = useState('')
  const [faqEditing, setFaqEditing] = useState<FaqAnswer | null>(null)
  const [faqEditingLoadingId, setFaqEditingLoadingId] = useState<string | null>(null)
  const [faqGuidance, setFaqGuidance] = useState<FaqGuidance[]>([])
  const [faqGuidanceLoading, setFaqGuidanceLoading] = useState(false)
  const [faqCandidateQuery, setFaqCandidateQuery] = useState('')
  const [faqCandidateTopK, setFaqCandidateTopK] = useState('5')
  const [faqCandidateIncludeDrafts, setFaqCandidateIncludeDrafts] = useState(true)
  const [faqCandidateRetrievalMode, setFaqCandidateRetrievalMode] = useState('hybrid')
  const [faqCandidateResult, setFaqCandidateResult] = useState<any>(null)
  const [faqCandidateLoading, setFaqCandidateLoading] = useState(false)
  const [faqCandidateError, setFaqCandidateError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [formError, setFormError] = useState('')
  const [faqBulkCreateOpen, setFaqBulkCreateOpen] = useState(false)
  const [faqTerminologyOpen, setFaqTerminologyOpen] = useState(false)
  const canChooseWorkspaceForUser = canChooseWorkspace(user?.role)
  const { kmsWorkspace: effectiveKmsWorkspace, faqWorkspace: effectiveFaqWorkspace } = resolveEffectiveWorkspaceScope({
    role: user?.role,
    selectedKmsWorkspace: kmsWorkspace,
    selectedFaqWorkspace: faqWorkspace,
    userKmsWorkspace: user?.kms_workspace,
    userFaqWorkspace: user?.faq_workspace
  })

  useEffect(() => {
    if (effectiveKmsWorkspace !== kmsWorkspace) setKmsWorkspace(effectiveKmsWorkspace)
    if (effectiveFaqWorkspace !== faqWorkspace) setFaqWorkspace(effectiveFaqWorkspace)
  }, [effectiveFaqWorkspace, effectiveKmsWorkspace, faqWorkspace, kmsWorkspace, setFaqWorkspace, setKmsWorkspace])

  const load = async (options: { syncRunning?: boolean } = {}) => {
    const scopeParams = new URLSearchParams({
      kms_workspace: effectiveKmsWorkspace,
      faq_workspace: effectiveFaqWorkspace
    })
    const faqParams = new URLSearchParams()
    if (faqStatus !== 'all') faqParams.set('status', faqStatus)
    if (faqSearch.trim()) faqParams.set('search', faqSearch.trim())
    faqParams.set('faq_workspace', effectiveFaqWorkspace)
    const documentParams = new URLSearchParams({
      status: documentStatus,
      kms_workspace: effectiveKmsWorkspace
    })
    if (options.syncRunning ?? true) {
      try {
        await api.post('/api/jobs/sync-running')
      } catch {
        // The list should still render when the background LightRAG task endpoint is temporarily unavailable.
      }
    }
    const [knowledgeResponse, categoryResponse, documentResponse, faqResponse, jobsResponse] = await Promise.all([
      api.get(`/api/knowledge?${scopeParams.toString()}`),
      api.get('/api/categories'),
      fetchAllKnowledgePages<KmsDocument>({
        endpoint: '/api/knowledge/kms-documents',
        params: documentParams,
        pageSize: KNOWLEDGE_DOCUMENT_PAGE_SIZE,
        itemKey: 'documents',
        totalPages: kmsDocumentTotalPages
      }),
      fetchAllKnowledgePages<FaqAnswer>({
        endpoint: '/api/knowledge/faq-answers',
        params: faqParams,
        pageSize: KNOWLEDGE_FAQ_PAGE_SIZE,
        itemKey: 'answers',
        totalPages: faqAnswerTotalPages
      }),
      api.get('/api/jobs')
    ])
    setItems(knowledgeResponse.data.items || [])
    setCategories(categoryResponse.data.categories || [])
    setDocuments(documentResponse.items || [])
    setFaqAnswers(faqResponse.items || [])
    setFaqWorkspaceError(faqResponse.lastData?.workspace_error || '')
    setJobs(jobsResponse.data.jobs || [])
  }

  useEffect(() => {
    load()
  }, [documentStatus, faqStatus, faqSearch, effectiveKmsWorkspace, effectiveFaqWorkspace])

  const updateForm = (patch: Partial<typeof initialKnowledgeForm>) => {
    setForm((value) => ({ ...value, ...patch }))
  }

  const resetKnowledgeForm = () => {
    setForm(initialKnowledgeForm)
    setFile(null)
    setFormError('')
  }

  const commonPayload = () => ({
    title: form.title,
    body: form.body,
    category_id: form.category_id || null,
    enabled: form.enabled,
    valid_from: form.valid_from ? new Date(form.valid_from).toISOString() : null,
    valid_until: form.valid_until ? new Date(form.valid_until).toISOString() : null,
    kms_workspace: effectiveKmsWorkspace,
    faq_workspace: effectiveFaqWorkspace,
    metadata: { source_type: sourceType }
  })

  const commonFormData = () => {
    const data = new FormData()
    data.set('title', form.title)
    data.set('body', form.body)
    data.set('category_id', form.category_id)
    data.set('enabled', String(form.enabled))
    data.set('kms_workspace', effectiveKmsWorkspace)
    data.set('faq_workspace', effectiveFaqWorkspace)
    data.set('metadata', JSON.stringify({ source_type: sourceType }))
    if (form.valid_from) data.set('valid_from', new Date(form.valid_from).toISOString())
    if (form.valid_until) data.set('valid_until', new Date(form.valid_until).toISOString())
    if (file) data.set('file', file)
    return data
  }

  const submitKnowledge = async (event: FormEvent) => {
    event.preventDefault()
    setSubmitting(true)
    setFormError('')
    try {
      const payload = commonPayload()
      if (sourceType === 'faq') {
        await api.post('/api/knowledge/faq', {
          ...payload,
          approved_summary: form.approved_summary || null,
          guidance: splitLines(form.guidance),
          tags: splitTags(form.tags),
          status: 'draft'
        })
      } else if (sourceType === 'faq_source_draft') {
        const guidance = splitLines(form.guidance).map((text) => ({
          guidance_type: text.includes('?') || text.includes('？') ? 'question' : 'keyword',
          text,
          weight: 1,
          source: 'kms_admin_ui',
          metadata: { created_from: 'kms_admin_ui' }
        }))
        await api.post('/api/knowledge/faq-source-draft', {
          ...payload,
          source_type: form.faq_source_type,
          source_uri: form.faq_source_uri || null,
          file_name: form.faq_file_name || null,
          approved_summary: form.approved_summary || null,
          content_format: form.faq_source_type === 'html' ? 'html' : form.faq_source_type === 'plain' ? 'plain' : 'markdown',
          display_policy: 'both',
          status: 'draft',
          priority: Number(form.priority || 0),
          tags: splitTags(form.tags),
          source_profile: {
            source_type: form.faq_source_type,
            source_uri: form.faq_source_uri || null,
            file_name: form.faq_file_name || null,
            guidance_count: guidance.length
          },
          guidance
        })
      } else if (sourceType === 'text') {
        await api.post('/api/knowledge/text', { ...payload, file_source: form.file_source || form.title })
      } else if (sourceType === 'texts') {
        const texts = splitLines(form.body)
        await api.post('/api/knowledge/texts', {
          ...payload,
          texts,
          file_sources: texts.map((_, index) => `${form.title || 'text'}-${index + 1}`)
        })
      } else if (sourceType === 'url') {
        await api.post('/api/knowledge/url', {
          ...payload,
          url: form.url,
          file_path_label: form.file_source || form.title,
          document_prompt: form.document_prompt || null,
          image_prompt: form.image_prompt || null,
          table_prompt: form.table_prompt || null
        })
      } else if (sourceType === 'url_batch') {
        await api.post('/api/knowledge/url-batch', {
          ...payload,
          urls: splitLines(form.urls),
          document_prompt: form.document_prompt || null,
          image_prompt: form.image_prompt || null,
          table_prompt: form.table_prompt || null
        })
      } else if (sourceType === 'board') {
        await api.post('/api/knowledge/board', {
          ...payload,
          api_url: form.board_api_url,
          method: form.board_method,
          headers: parseJsonField(form.board_headers, 'Header'),
          params: parseJsonField(form.board_params, 'Parameter'),
          request_body: parseJsonField(form.board_body, 'Body'),
          field_mapping: parseJsonField(form.board_mapping, 'Field mapping'),
          parser: form.parser,
          document_prompt: form.document_prompt || null,
          image_prompt: form.image_prompt || null,
          table_prompt: form.table_prompt || null
        })
      } else if (sourceType === 'scan') {
        await api.post('/api/knowledge/scan', {
          ...payload,
          title: form.title || '입력 폴더 스캔',
          body: form.body || 'LightRAG input directory scan'
        })
      } else {
        if (!file) {
          throw new Error('파일을 선택해야 합니다.')
        }
        const data = commonFormData()
        if (sourceType === 'quick_image') {
          data.set('image_prompt', form.image_prompt)
          await api.post('/api/knowledge/quick-image', data)
        } else if (sourceType === 'multimodal') {
          data.set('parser', form.parser)
          data.set('process_images', 'true')
          data.set('process_tables', 'true')
          data.set('process_equations', 'true')
          data.set('document_prompt', form.document_prompt)
          data.set('image_prompt', form.image_prompt)
          data.set('table_prompt', form.table_prompt)
          await api.post('/api/knowledge/multimodal', data)
        } else {
          await api.post('/api/knowledge/upload', data)
        }
      }
      resetKnowledgeForm()
      setAdding(false)
      await api.post('/api/jobs/sync-running')
      await load()
    } catch (error) {
      setFormError(apiErrorMessage(error, '지식 추가 중 오류가 발생했습니다.'))
    } finally {
      setSubmitting(false)
    }
  }

  const categoryById = useMemo(
    () => new Map(categories.map((category) => [category.category_id, category.path])),
    [categories]
  )

  const latestJobByItem = useMemo(() => {
    const map = new Map<string, Job>()
    jobs.forEach((job) => {
      if (job.item_id && !map.has(job.item_id)) {
        map.set(job.item_id, job)
      }
    })
    return map
  }, [jobs])

  const knowledgeRows = useMemo<KnowledgeListRow[]>(() => {
    const sourceLabel = (sourceType?: string) =>
      knowledgeSources.find((source) => source.type === sourceType)?.label || sourceType || '관리 원장'

    const faqAnswerById = new Map(faqAnswers.map((answer) => [String(answer.answer_id), answer]))
    const documentById = new Map(documents.map((doc) => [String(doc.id), doc]))
    const ledgerAnswerIds = new Set<string>()
    const ledgerDocumentIds = new Set<string>()

    const ledgerRows = items.map((item) => {
      const sourceType = item.metadata?.source_type || item.knowledge_type
      const kind: KnowledgeListRow['kind'] = String(item.knowledge_type || sourceType).toLowerCase().includes('faq') ? 'faq' : 'document'
      const refs = Array.isArray(item.refs) ? item.refs : []
      const answerRef = refs.find((ref: any) => ref.ref_type === 'answer_id')?.external_id
      const documentRef = refs.find((ref: any) => ref.ref_type === 'doc_id')?.external_id
      if (answerRef) ledgerAnswerIds.add(String(answerRef))
      if (documentRef) ledgerDocumentIds.add(String(documentRef))
      const answer = answerRef ? faqAnswerById.get(String(answerRef)) : undefined
      const document = documentRef ? documentById.get(String(documentRef)) : undefined
      const job = latestJobByItem.get(item.item_id)
      return {
        id: item.item_id,
        title: answer?.title || item.title || '제목 없음',
        kind,
        source: sourceLabel(sourceType),
        status: job?.status || answer?.status || document?.status || item.status,
        category: categoryById.get(item.category_id) || '카테고리 없음',
        enabled: Boolean(item.enabled),
        validFrom: item.valid_from,
        validUntil: item.valid_until,
        metricLabel: answer ? '버전' : document ? '청크' : 'REF',
        metricValue: answer?.version || document?.chunks_count || refs.length,
        updated: item.update_time || answer?.update_time || document?.updated_at || item.create_time,
        workspace: kind === 'faq' ? effectiveFaqWorkspace : effectiveKmsWorkspace,
        summary: item.body || answer?.approved_summary || answer?.body || document?.content_summary || item.description || '',
        job,
        ledgerItem: item,
        linked: true,
        answer,
        document
      }
    })

    const documentRows = documents.filter((doc) => !ledgerDocumentIds.has(String(doc.id))).map((doc) => ({
      id: doc.id,
      title: doc.file_path || doc.doc_nm || doc.id,
      kind: 'document',
      source: 'LightRAG 문서',
      status: doc.status || 'unknown',
      category: '원장 미연결',
      enabled: String(doc.status || '').toLowerCase() === 'processed',
      validFrom: null,
      validUntil: null,
      metricLabel: '청크',
      metricValue: doc.chunks_count || 0,
      updated: doc.updated_at || doc.created_at,
      workspace: effectiveKmsWorkspace,
      summary: doc.content_summary || doc.track_id || '',
      linked: false,
      document: doc
    }))

    const faqRows = faqAnswers.filter((answer) => !ledgerAnswerIds.has(String(answer.answer_id))).map((answer) => ({
      id: answer.answer_id,
      title: answer.title || answer.answer_id,
      kind: 'faq',
      source: 'FAQ 답변 API',
      status: answer.status,
      category: '원장 미연결',
      enabled: !['archived', 'expired'].includes(String(answer.status || '').toLowerCase()),
      validFrom: answer.valid_from,
      validUntil: answer.valid_until,
      metricLabel: '버전',
      metricValue: answer.version || 1,
      updated: answer.update_time,
      workspace: effectiveFaqWorkspace,
      summary: answer.approved_summary || answer.body || '',
      linked: false,
      answer
    }))

    return [...ledgerRows, ...documentRows, ...faqRows]
  }, [
    categoryById,
    documents,
    effectiveFaqWorkspace,
    effectiveKmsWorkspace,
    faqAnswers,
    items,
    latestJobByItem
  ])

  const visibleKnowledgeRows = useMemo(
    () => knowledgeRows.filter((row) => activeKnowledgeTab === 'all' || row.kind === activeKnowledgeTab),
    [activeKnowledgeTab, knowledgeRows]
  )
  const knowledgeTotalPages = Math.max(1, Math.ceil(visibleKnowledgeRows.length / knowledgePageSize))
  const pagedKnowledgeRows = useMemo(
    () => visibleKnowledgeRows.slice((knowledgePage - 1) * knowledgePageSize, knowledgePage * knowledgePageSize),
    [knowledgePage, knowledgePageSize, visibleKnowledgeRows]
  )
  const knowledgeRangeStart = visibleKnowledgeRows.length ? (knowledgePage - 1) * knowledgePageSize + 1 : 0
  const knowledgeRangeEnd = Math.min(visibleKnowledgeRows.length, knowledgePage * knowledgePageSize)

  useEffect(() => {
    setKnowledgePage(1)
  }, [activeKnowledgeTab, documentStatus, effectiveFaqWorkspace, effectiveKmsWorkspace, faqSearch, faqStatus])

  useEffect(() => {
    if (knowledgePage > knowledgeTotalPages) {
      setKnowledgePage(knowledgeTotalPages)
    }
  }, [knowledgePage, knowledgeTotalPages])

  const knowledgeCounts = useMemo(
    () => ({
      all: knowledgeRows.length,
      faq: knowledgeRows.filter((row) => row.kind === 'faq').length,
      document: knowledgeRows.filter((row) => row.kind === 'document').length
    }),
    [knowledgeRows]
  )

  const knowledgeSummary = useMemo(() => {
    const activeCount = knowledgeRows.filter((row) => row.enabled).length
    const processingCount = knowledgeRows.filter((row) => isRunningJob({ status: row.status || '' })).length
    const failedCount = knowledgeRows.filter((row) =>
      ['failed', 'error', 'cancelled', 'rolledback'].includes(String(row.status || '').toLowerCase())
    ).length
    const rollbackCount = jobs.filter((job) => job.rollback_status).length
    return {
      activeCount,
      processingCount,
      failedCount,
      rollbackCount,
      latestJobs: jobs.slice(0, 4)
    }
  }, [jobs, knowledgeRows])

  const runningJobs = useMemo(
    () => jobs.filter(isRunningJob).slice(0, 4),
    [jobs]
  )

  const unlinkedDocumentRows = useMemo(
    () => knowledgeRows.filter((row) => !row.linked && row.document),
    [knowledgeRows]
  )
  const unlinkedFaqRows = useMemo(
    () => knowledgeRows.filter((row) => !row.linked && row.answer),
    [knowledgeRows]
  )
  const unlinkedKnowledgeCount = unlinkedDocumentRows.length + unlinkedFaqRows.length

  const openSourceCreate = (type: KnowledgeSourceType) => {
    setSourceType(type)
    setFormError('')
    setAdding(true)
  }

  const openExistingLink = () => {
    setExistingLinkForm({
      ...initialExistingLinkForm,
      include_kms: unlinkedDocumentRows.length > 0,
      include_faq: unlinkedFaqRows.length > 0
    })
    setExistingLinkError('')
    setExistingLinkResult(null)
    setLinkingExisting(true)
  }

  const documentLinkPayload = (doc: KmsDocument) => ({
    id: doc.id,
    title: doc.file_path || doc.doc_nm || doc.id,
    summary: doc.content_summary || doc.track_id || '',
    status: doc.status || null,
    metadata: {
      file_path: doc.file_path || null,
      doc_nm: doc.doc_nm || null,
      track_id: doc.track_id || null,
      content_length: doc.content_length || null,
      chunks_count: doc.chunks_count || 0,
      created_at: doc.created_at || null,
      updated_at: doc.updated_at || null,
      error_msg: doc.error_msg || null
    }
  })

  const faqLinkPayload = (answer: FaqAnswer) => ({
    id: answer.answer_id,
    title: answer.title || answer.answer_id,
    summary: answer.approved_summary || answer.body || '',
    status: answer.status || null,
    metadata: {
      version: answer.version || 1,
      valid_from: answer.valid_from || null,
      valid_until: answer.valid_until || null,
      priority: answer.priority || 0,
      tags: answer.tags || [],
      update_time: answer.update_time || null
    }
  })

  const submitExistingLink = async (event: FormEvent) => {
    event.preventDefault()
    setExistingLinkSubmitting(true)
    setExistingLinkError('')
    try {
      const response = await api.post('/api/knowledge/link-existing', {
        category_id: existingLinkForm.category_id || null,
        enabled: existingLinkForm.enabled,
        valid_from: existingLinkForm.valid_from ? new Date(existingLinkForm.valid_from).toISOString() : null,
        valid_until: existingLinkForm.valid_until ? new Date(existingLinkForm.valid_until).toISOString() : null,
        kms_workspace: effectiveKmsWorkspace,
        faq_workspace: effectiveFaqWorkspace,
        link_all: existingLinkForm.link_all,
        include_kms: existingLinkForm.include_kms,
        include_faq: existingLinkForm.include_faq,
        max_items: Number(existingLinkForm.max_items || 1000),
        documents: existingLinkForm.link_all
          ? []
          : unlinkedDocumentRows.map((row) => documentLinkPayload(row.document!)),
        faq_answers: existingLinkForm.link_all
          ? []
          : unlinkedFaqRows.map((row) => faqLinkPayload(row.answer!))
      })
      setExistingLinkResult(response.data)
      await load()
    } catch (error) {
      setExistingLinkError(apiErrorMessage(error, '기존 지식 연결 중 오류가 발생했습니다.'))
    } finally {
      setExistingLinkSubmitting(false)
    }
  }

  const syncRunningJobs = async (options: { silent?: boolean } = {}) => {
    if (!options.silent) setSyncing(true)
    try {
      await api.post('/api/jobs/sync-running')
      await load({ syncRunning: false })
    } finally {
      if (!options.silent) setSyncing(false)
    }
  }

  const runningJobCount = jobs.filter(isRunningJob).length

  useEffect(() => {
    if (!runningJobCount) return
    const timer = window.setInterval(() => {
      void syncRunningJobs({ silent: true })
    }, 5000)
    return () => window.clearInterval(timer)
  }, [runningJobCount, effectiveKmsWorkspace, effectiveFaqWorkspace, documentStatus, faqStatus, faqSearch])

  const deleteDocument = async (doc: KmsDocument) => {
    if (!window.confirm(`${doc.file_path || doc.id} 문서를 LightRAG 워크스페이스에서 삭제하시겠습니까?`)) {
      return
    }
    await api.post(`/api/knowledge/kms-documents/${encodeURIComponent(doc.id)}/delete`, {
      delete_file: false,
      delete_llm_cache: false,
      delete_s3_file: false
    }, { params: { kms_workspace: effectiveKmsWorkspace } })
    await load()
  }

  const runFaqAction = async (answer: FaqAnswer, action: 'publish' | 'archive' | 'vectors-rebuild') => {
    await api.post(`/api/knowledge/faq-answers/${encodeURIComponent(answer.answer_id)}/${action}`, undefined, {
      params: { faq_workspace: effectiveFaqWorkspace }
    })
    await load()
  }

  const runFaqCandidateSearch = async (event: FormEvent) => {
    event.preventDefault()
    if (!faqCandidateQuery.trim()) return
    setFaqCandidateLoading(true)
    setFaqCandidateError('')
    try {
      const response = await api.post(
        '/api/knowledge/faq-answers/search',
        {
          query: faqCandidateQuery.trim(),
          top_k: Number(faqCandidateTopK || 5),
          include_drafts: faqCandidateIncludeDrafts,
          include_candidates: true,
          strategy: 'balanced',
          retrieval_mode: faqCandidateRetrievalMode
        },
        { params: { faq_workspace: effectiveFaqWorkspace } }
      )
      setFaqCandidateResult(response.data)
    } catch (error) {
      setFaqCandidateError(apiErrorMessage(error, 'FAQ 후보 검수 중 오류가 발생했습니다.'))
    } finally {
      setFaqCandidateLoading(false)
    }
  }

  const openDocumentDetail = async (doc: KmsDocument) => {
    setDocumentDetailLoadingId(doc.id)
    try {
      const response = await api.get(`/api/knowledge/kms-documents/${encodeURIComponent(doc.id)}/detail`, {
        params: { kms_workspace: effectiveKmsWorkspace }
      })
      setDocumentDetail(response.data)
    } finally {
      setDocumentDetailLoadingId(null)
    }
  }

  const extractedDocumentBody = (detail: KmsDocumentDetail) => {
    const content = detail.preview.content?.trim()
    if (content) return content
    const chunks = detail.preview.chunks || []
    const chunkBody = chunks.map((chunk) => chunk.content).filter(Boolean).join('\n\n').trim()
    if (chunkBody) return chunkBody
    return detail.preview.content_summary || ''
  }

  const openDocumentReingest = async (doc: KmsDocument) => {
    setDocumentReingestLoadingId(doc.id)
    setDocumentReingestError('')
    try {
      const response = await api.get(`/api/knowledge/kms-documents/${encodeURIComponent(doc.id)}/detail`, {
        params: { kms_workspace: effectiveKmsWorkspace }
      })
      const detail = response.data as KmsDocumentDetail
      const title = detail.preview.file_path || detail.preview.doc_nm || doc.file_path || doc.doc_nm || doc.id
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
      setDocumentReingestDetail(detail)
      setDocumentReingestForm({
        ...initialDocumentReingestForm,
        title: `${title} 수정본`,
        body: extractedDocumentBody(detail),
        file_source: `${title}-revision-${timestamp}`
      })
    } finally {
      setDocumentReingestLoadingId(null)
    }
  }

  const closeDocumentReingest = () => {
    setDocumentReingestDetail(null)
    setDocumentReingestForm(initialDocumentReingestForm)
    setDocumentReingestError('')
  }

  const submitDocumentReingest = async (event: FormEvent) => {
    event.preventDefault()
    if (!documentReingestDetail) return
    setDocumentReingestSubmitting(true)
    setDocumentReingestError('')
    try {
      await api.post(
        `/api/knowledge/kms-documents/${encodeURIComponent(documentReingestDetail.preview.id)}/reingest`,
        {
          title: documentReingestForm.title,
          body: documentReingestForm.body,
          category_id: documentReingestForm.category_id || null,
          enabled: documentReingestForm.enabled,
          valid_from: documentReingestForm.valid_from ? new Date(documentReingestForm.valid_from).toISOString() : null,
          valid_until: documentReingestForm.valid_until ? new Date(documentReingestForm.valid_until).toISOString() : null,
          kms_workspace: effectiveKmsWorkspace,
          faq_workspace: effectiveFaqWorkspace,
          file_source: documentReingestForm.file_source || documentReingestForm.title,
          delete_previous: documentReingestForm.delete_previous,
          metadata: { source_type: 'text_revision' }
        },
        { params: { kms_workspace: effectiveKmsWorkspace } }
      )
      closeDocumentReingest()
      await api.post('/api/jobs/sync-running')
      await load()
    } catch (error) {
      setDocumentReingestError(apiErrorMessage(error, '문서 재지식화 중 오류가 발생했습니다.'))
    } finally {
      setDocumentReingestSubmitting(false)
    }
  }

  const openFaqEdit = async (answer: FaqAnswer) => {
    setFaqEditingLoadingId(answer.answer_id)
    setFaqGuidanceLoading(true)
    try {
      const [answerResponse, guidanceResponse] = await Promise.all([
        api.get(`/api/knowledge/faq-answers/${encodeURIComponent(answer.answer_id)}`, {
          params: { faq_workspace: effectiveFaqWorkspace }
        }),
        api.get(`/api/knowledge/faq-answers/${encodeURIComponent(answer.answer_id)}/guidance`, {
          params: { faq_workspace: effectiveFaqWorkspace }
        })
      ])
      setFaqEditing(answerResponse.data)
      setFaqGuidance(guidanceResponse.data.guidance || [])
    } finally {
      setFaqEditingLoadingId(null)
      setFaqGuidanceLoading(false)
    }
  }

  const closeFaqEdit = () => {
    setFaqEditing(null)
    setFaqGuidance([])
  }

  const reloadFaqGuidance = async (answerId: string) => {
    const response = await api.get(`/api/knowledge/faq-answers/${encodeURIComponent(answerId)}/guidance`, {
      params: { faq_workspace: effectiveFaqWorkspace }
    })
    setFaqGuidance(response.data.guidance || [])
  }

  const createFaqGuidance = async (
    answerId: string,
    payload: { guidance_type: string; text: string; weight: number }
  ) => {
    await api.post(`/api/knowledge/faq-answers/${encodeURIComponent(answerId)}/guidance`, payload, {
      params: { faq_workspace: effectiveFaqWorkspace }
    })
    await reloadFaqGuidance(answerId)
  }

  const deleteFaqGuidance = async (answerId: string, guidanceId: string) => {
    await api.delete(
      `/api/knowledge/faq-answers/${encodeURIComponent(answerId)}/guidance/${encodeURIComponent(guidanceId)}`,
      { params: { faq_workspace: effectiveFaqWorkspace } }
    )
    await reloadFaqGuidance(answerId)
  }

  const saveFaqAnswer = async (answerId: string, payload: Record<string, unknown>, rebuild: boolean) => {
    await api.patch(`/api/knowledge/faq-answers/${encodeURIComponent(answerId)}`, payload, {
      params: { faq_workspace: effectiveFaqWorkspace }
    })
    if (rebuild) {
      await api.post(`/api/knowledge/faq-answers/${encodeURIComponent(answerId)}/vectors-rebuild`, undefined, {
        params: { faq_workspace: effectiveFaqWorkspace }
      })
    }
    closeFaqEdit()
    await load()
  }

  const requiresBody = ['faq', 'faq_source_draft', 'text', 'texts'].includes(sourceType)
  const requiresFile = ['upload', 'quick_image', 'multimodal'].includes(sourceType)
  const requiresTitle = sourceType !== 'scan'
  const canSubmit =
    !submitting &&
    (!requiresTitle || form.title.trim()) &&
    (!requiresBody || form.body.trim()) &&
    (sourceType !== 'url' || form.url.trim()) &&
    (sourceType !== 'url_batch' || splitLines(form.urls).length > 0) &&
    (sourceType !== 'board' || (form.board_api_url.trim() && form.board_mapping.trim())) &&
    (!requiresFile || Boolean(file))

  return (
    <div className="content-inner wide fadein">
      <div className="page-head">
        <div>
          <h1>지식 관리</h1>
          <p>FAQ·문서 지식 등록, LightRAG 지식화 진행 상태, KMS/FAQ 원장 연결을 관리합니다.</p>
        </div>
        <div className="sp" />
        <RelatedHelp
          topicIds={[
            'HELP-KNOWLEDGE-001',
            'HELP-KNOWLEDGE-002',
            'HELP-KNOWLEDGE-003',
            'HELP-KNOWLEDGE-004',
            'HELP-KNOWLEDGE-005',
            'HELP-KNOWLEDGE-006',
            'HELP-KNOWLEDGE-007',
            'HELP-KNOWLEDGE-008',
            'HELP-KNOWLEDGE-009',
            'HELP-KNOWLEDGE-010',
            'HELP-KNOWLEDGE-011',
            'HELP-KNOWLEDGE-012',
            'HELP-KNOWLEDGE-013',
            'HELP-KNOWLEDGE-014',
            'HELP-KNOWLEDGE-015',
            'HELP-KNOWLEDGE-016',
            'HELP-KNOWLEDGE-017'
          ]}
        />
        <div className="row" style={{ gap: 8, minWidth: 420 }}>
          <WorkspaceSelect
            value={effectiveKmsWorkspace}
            mode="kms"
            onChange={setKmsWorkspace}
            placeholder="KMS 워크스페이스"
            disabled={!canChooseWorkspaceForUser}
          />
          <WorkspaceSelect
            value={effectiveFaqWorkspace}
            mode="answer_catalog"
            onChange={setFaqWorkspace}
            placeholder="FAQ 워크스페이스"
            disabled={!canChooseWorkspaceForUser}
          />
        </div>
        <Button type="button" variant="outline" onClick={syncRunningJobs} disabled={syncing}>
          <RefreshCwIcon className={syncing ? 'spin size-4' : 'size-4'} /> 진행 상태 동기화
        </Button>
        <Button type="button" variant="outline" onClick={openExistingLink}>
          <LinkIcon className="size-4" /> 기존 지식 연결
        </Button>
        <Button type="button" variant="outline" onClick={() => setFaqTerminologyOpen(true)}>
          <TagIcon className="size-4" /> 공통 용어
        </Button>
        <Button type="button" variant="outline" onClick={() => setFaqBulkCreateOpen(true)}>
          <DatabaseIcon className="size-4" /> FAQ 일괄 생성
        </Button>
        <div className="seg">
          <button className={view === 'table' ? 'on' : ''} type="button" onClick={() => setView('table')}>
            테이블
          </button>
          <button className={view === 'card' ? 'on' : ''} type="button" onClick={() => setView('card')}>
            카드
          </button>
        </div>
        <Button type="button" onClick={() => setAdding(true)}>
          <PlusIcon className="size-4" /> 지식 추가
        </Button>
      </div>

      <div className="kpis" style={{ marginBottom: 'var(--gap)' }}>
        {[
          ['전체 지식', knowledgeCounts.all, '건', DatabaseIcon],
          ['답변 후보 사용', knowledgeSummary.activeCount, '건', CheckCircleIcon],
          ['원장 미연결', unlinkedKnowledgeCount, '건', LinkIcon],
          ['지식화 진행', knowledgeSummary.processingCount, '건', RefreshCwIcon],
          ['실패·롤백', knowledgeSummary.failedCount + knowledgeSummary.rollbackCount, '건', RotateCwIcon]
        ].map(([label, value, unit, Icon]) => (
          <div key={String(label)} className="kpi">
            <div className="k"><span className="ic"><Icon className="size-4" /></span>{String(label)}</div>
            <div className="r"><span className="v">{Number(value).toLocaleString()}</span><span className="u">{String(unit)}</span></div>
          </div>
        ))}
      </div>

      {runningJobs.length > 0 && (
        <div className="card" style={{ marginBottom: 'var(--gap)', borderColor: 'var(--accent)', background: 'var(--accent-soft)' }}>
          <div className="card-h">
            <div>
              <div className="t">진행 중 지식화</div>
              <div className="sub">LightRAG 작업 상태를 5초마다 자동 동기화합니다.</div>
            </div>
            <div className="sp" />
            <span className="badge blue">
              <RefreshCwIcon className={syncing ? 'spin size-3' : 'size-3'} /> {runningJobs.length}건 진행 중
            </span>
            <Button type="button" size="sm" variant="outline" onClick={() => syncRunningJobs()} disabled={syncing}>
              <RefreshCwIcon className={syncing ? 'spin size-4' : 'size-4'} /> 지금 동기화
            </Button>
          </div>
          <div className="card-b">
            <div className="col" style={{ gap: 10 }}>
              {runningJobs.map((job) => {
                const progress = Math.max(0, Math.min(100, Number(job.progress || 0)))
                return (
                  <div key={job.job_id} className="col" style={{ gap: 8, padding: 12, borderRadius: 'var(--radius-md)', border: '1px solid var(--border-default)', background: '#fff' }}>
                    <div className="row" style={{ gap: 8, alignItems: 'flex-start' }}>
                      <StatusBadge status={job.status} />
                      <div className="grow" style={{ minWidth: 0 }}>
                        <div style={{ fontSize: 13.5, fontWeight: 700, color: 'var(--fg-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {job.knowledge_title || job.job_type || job.job_id}
                        </div>
                        <div className="muted" style={{ fontSize: 12, lineHeight: 1.5, marginTop: 3 }}>
                          {jobProgressMessage(job)}
                        </div>
                      </div>
                      <span className="num" style={{ fontSize: 18, fontWeight: 800, color: 'var(--accent)' }}>{progress.toFixed(0)}%</span>
                    </div>
                    <div className={`bar ${badgeTone(job.status) === 'green' ? 'green' : badgeTone(job.status) === 'red' ? 'red' : ''}`} style={{ height: 8 }}>
                      <i style={{ width: `${progress}%` }} />
                    </div>
                    <div className="row wrap" style={{ gap: 8 }}>
                      <span className="badge gray">현재 단계 {statusLabel(job.status)}</span>
                      <span className="badge outline">최근 확인 {shortDate(job.update_time)}</span>
                      <span className="badge outline mono" title={job.lightrag_task_id || job.job_id}>
                        Task {job.lightrag_task_id ? job.lightrag_task_id.slice(0, 8) : job.job_id.slice(0, 8)}
                      </span>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      )}

      <div className="grid" style={{ gridTemplateColumns: 'minmax(0,1fr) 360px', alignItems: 'start', marginBottom: 'var(--gap)' }}>
        <div className="card">
          <div className="card-h">
            <div>
              <div className="t">지식화 방식</div>
              <div className="sub">LightRAG의 문서·URL·게시판·멀티모달·FAQ API를 선택해 등록합니다.</div>
            </div>
          </div>
          <div className="card-b">
            <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 8 }}>
              {knowledgeSources.map((source) => {
                const Icon = source.icon
                return (
                  <button
                    key={source.type}
                    type="button"
                    className="row"
                    style={{
                      minHeight: 68,
                      gap: 10,
                      padding: 12,
                      border: '1px solid var(--border-default)',
                      borderRadius: 'var(--radius-md)',
                      background: source.type === sourceType ? 'var(--accent-soft)' : '#fff',
                      textAlign: 'left',
                      cursor: 'pointer',
                      alignItems: 'flex-start'
                    }}
                    onClick={() => openSourceCreate(source.type)}
                  >
                    <span
                      style={{
                        width: 32,
                        height: 32,
                        display: 'inline-flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        borderRadius: 8,
                        background: source.type === sourceType ? 'var(--accent)' : 'var(--bg-subtle)',
                        color: source.type === sourceType ? '#fff' : 'var(--fg-secondary)',
                        flexShrink: 0
                      }}
                    >
                      <Icon className="size-4" />
                    </span>
                    <span className="col" style={{ gap: 4, minWidth: 0 }}>
                      <span className="row" style={{ gap: 6, fontSize: 13, fontWeight: 700, color: 'var(--fg-primary)' }}>
                        {source.label}
                        <span className={`badge ${source.workspace === 'FAQ' ? 'blue' : 'gray'}`}>{source.workspace}</span>
                      </span>
                      <span className="muted" style={{ fontSize: 11.5, lineHeight: 1.4 }}>
                        {source.description}
                      </span>
                    </span>
                  </button>
                )
              })}
            </div>
          </div>
        </div>

        <div className="card">
          <div className="card-h">
            <div>
              <div className="t">최근 작업</div>
              <div className="sub">지식화·롤백 상태</div>
            </div>
            <div className="sp" />
            <button className="btn btn-ghost btn-sm" type="button" onClick={syncRunningJobs} disabled={syncing}>
              <RefreshCwIcon className={syncing ? 'spin size-4' : 'size-4'} /> 동기화
            </button>
          </div>
          <div className="card-b">
            <div className="col" style={{ gap: 9 }}>
              {knowledgeSummary.latestJobs.map((job) => (
                <div key={job.job_id} className="col" style={{ gap: 6, padding: '9px 10px', border: '1px solid var(--border-default)', borderRadius: 'var(--radius-md)' }}>
                  <div className="row" style={{ gap: 8 }}>
                    <span className={`badge ${badgeTone(job.status)}`}>{statusLabel(job.status)}</span>
                    <span className="grow" style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--fg-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {job.knowledge_title || job.job_type || job.job_id}
                    </span>
                    <span className="num muted" style={{ fontSize: 11.5 }}>{Number(job.progress || 0).toFixed(0)}%</span>
                  </div>
                  <div className={`bar ${badgeTone(job.status) === 'green' ? 'green' : badgeTone(job.status) === 'red' ? 'red' : ''}`}>
                    <i style={{ width: `${Math.min(100, Number(job.progress || 0))}%` }} />
                  </div>
                  <div className="mono muted" style={{ fontSize: 10.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {job.lightrag_task_id || job.job_id}
                  </div>
                </div>
              ))}
              {!knowledgeSummary.latestJobs.length && <div className="empty" style={{ padding: 20 }}>최근 작업이 없습니다.</div>}
            </div>
          </div>
        </div>
      </div>

      <div className="tabs" style={{ marginBottom: 18 }}>
        <button className={activeKnowledgeTab === 'all' ? 'on' : ''} type="button" onClick={() => setActiveKnowledgeTab('all')}>
          전체 <span className="ct">{knowledgeCounts.all}</span>
        </button>
        <button className={activeKnowledgeTab === 'faq' ? 'on' : ''} type="button" onClick={() => setActiveKnowledgeTab('faq')}>
          <BookOpenIcon className="size-4" /> FAQ 지식 <span className="ct">{knowledgeCounts.faq}</span>
        </button>
        <button className={activeKnowledgeTab === 'document' ? 'on' : ''} type="button" onClick={() => setActiveKnowledgeTab('document')}>
          <FileTextIcon className="size-4" /> 문서 지식 <span className="ct">{knowledgeCounts.document}</span>
        </button>
      </div>

      {faqWorkspaceError && (
        <div
          style={{
            display: 'flex',
            gap: 10,
            padding: 12,
            borderRadius: 'var(--radius-md)',
            background: 'var(--warning-soft)',
            color: '#9a5b08',
            fontSize: 12,
            lineHeight: 1.5,
            marginBottom: 16
          }}
        >
          <HelpCircleIcon className="size-4" style={{ flexShrink: 0, marginTop: 1 }} />
          <span>
            선택한 FAQ 워크스페이스가 FAQ 답변 API를 지원하지 않습니다. FAQ 또는 통합 모드 워크스페이스를 선택해야 답변 조회와 추가가 가능합니다.
            <br />
            <span className="mono">{faqWorkspaceError}</span>
          </span>
        </div>
      )}

      {activeKnowledgeTab !== 'document' && (
        <div className="card" style={{ marginBottom: 'var(--gap)' }}>
          <div className="card-h">
            <div>
              <div className="t">FAQ 후보 검수</div>
              <div className="sub">사용자 질문에 대해 선택 답변과 후보 점수를 비교합니다.</div>
            </div>
            <div className="sp" />
            <span className="badge outline mono">{effectiveFaqWorkspace}</span>
          </div>
          <div className="card-b">
            <form className="row wrap" style={{ gap: 8, alignItems: 'center', marginBottom: 12 }} onSubmit={runFaqCandidateSearch}>
              <Input
                value={faqCandidateQuery}
                onChange={(event) => setFaqCandidateQuery(event.target.value)}
                placeholder="예: 카드 인증이 실패할 때 어떻게 해야 하나요?"
                style={{ minWidth: 360, flex: 1 }}
              />
              <select className={selectClass} style={{ width: 110 }} value={faqCandidateTopK} onChange={(event) => setFaqCandidateTopK(event.target.value)}>
                <option value="3">Top 3</option>
                <option value="5">Top 5</option>
                <option value="10">Top 10</option>
              </select>
              <select
                className={selectClass}
                style={{ width: 150 }}
                value={faqCandidateRetrievalMode}
                onChange={(event) => setFaqCandidateRetrievalMode(event.target.value)}
              >
                <option value="hybrid">하이브리드 · 권장</option>
                <option value="keyword">키워드</option>
                <option value="vector">벡터</option>
                <option value="llm_rerank">LLM 최종 선택</option>
              </select>
              <label className="check" style={{ minHeight: 32 }}>
                <input type="checkbox" checked={faqCandidateIncludeDrafts} onChange={(event) => setFaqCandidateIncludeDrafts(event.target.checked)} />
                검토 필요 포함
              </label>
              <Button type="submit" disabled={faqCandidateLoading || !faqCandidateQuery.trim()}>
                <SearchIcon className={faqCandidateLoading ? 'spin size-4' : 'size-4'} /> 검수
              </Button>
            </form>
            {faqCandidateError && (
              <div className="badge red" style={{ justifyContent: 'flex-start', whiteSpace: 'normal', borderRadius: 'var(--radius-md)', padding: 8, marginBottom: 10 }}>
                {faqCandidateError}
              </div>
            )}
            {faqCandidateResult && (
              <div className="grid" style={{ gridTemplateColumns: '320px minmax(0, 1fr)', gap: 14, alignItems: 'start' }}>
                <div style={{ padding: 12, borderRadius: 'var(--radius-md)', background: faqCandidateResult.matched ? 'var(--success-soft)' : 'var(--warning-soft)', border: '1px solid var(--border-subtle)' }}>
                  <div className="eyebrow" style={{ marginBottom: 7 }}>선택 답변</div>
                  <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--fg-primary)', marginBottom: 6 }}>
                    {faqCandidateResult.matched ? faqCandidateResult.title || faqCandidateResult.answer_id : '선택된 답변 없음'}
                  </div>
                  <div className="row wrap" style={{ gap: 6, marginBottom: 8 }}>
                    <span className={`badge ${faqCandidateResult.matched ? 'green' : 'amber'}`}>{faqCandidateResult.matched ? '매칭' : '미매칭'}</span>
                    <span className="badge outline">신뢰도 {Number((faqCandidateResult.confidence || 0) * 100).toFixed(1)}%</span>
                    {faqCandidateResult.status && <StatusBadge status={faqCandidateResult.status} />}
                  </div>
                  <div className="muted" style={{ fontSize: 12, lineHeight: 1.5 }}>
                    {faqCandidateResult.response || faqCandidateResult.summary || faqCandidateResult.rationale || '응답 본문이 없습니다.'}
                  </div>
                  {Array.isArray(faqCandidateResult.alias_expansions) && faqCandidateResult.alias_expansions.length > 0 && (
                    <div style={{ marginTop: 10, paddingTop: 9, borderTop: '1px solid var(--border-subtle)' }}>
                      <div className="eyebrow" style={{ marginBottom: 6 }}>적용된 공통 용어</div>
                      <div className="row wrap" style={{ gap: 6 }}>
                        {faqCandidateResult.alias_expansions.map((expansion: any, index: number) => (
                          <span key={`${expansion.matched_term}-${index}`} className="badge blue">
                            {expansion.matched_term} → {expansion.canonical_term}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
                <div style={{ border: '1px solid var(--border-default)', borderRadius: 'var(--radius-md)', overflow: 'hidden' }}>
                  <table className="tbl">
                    <thead>
                      <tr>
                        <th style={{ paddingLeft: 12 }}>후보</th>
                        <th>사유</th>
                        <th>가이드</th>
                        <th className="num">점수</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(faqCandidateResult.candidates || []).map((candidate: any) => (
                        <tr key={candidate.answer?.answer_id || candidate.answer_id || candidate.reason}>
                          <td style={{ paddingLeft: 12 }}>
                            <div className="ttl">{candidate.answer?.title || candidate.title || candidate.answer?.answer_id || '-'}</div>
                            <div className="mono muted" style={{ fontSize: 10.5 }}>{candidate.answer?.answer_id || candidate.answer_id || '-'}</div>
                          </td>
                          <td className="muted" style={{ maxWidth: 280 }}>{candidate.reason || candidate.selected_by || '-'}</td>
                          <td>
                            {(candidate.matched_guidance || []).slice(0, 3).map((item: string) => (
                              <span key={item} className="badge gray" style={{ marginRight: 4 }}>{item}</span>
                            ))}
                          </td>
                          <td className="num" style={{ fontWeight: 700 }}>{Number(candidate.score || 0).toFixed(3)}</td>
                        </tr>
                      ))}
                      {!faqCandidateResult.candidates?.length && <tr><td colSpan={4} className="empty">후보가 없습니다.</td></tr>}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      <div className="card" style={{ padding: '16px 8px 8px' }}>
        <div className="row wrap" style={{ gap: 8, padding: '0 14px 14px' }}>
          <select className={selectClass} style={{ maxWidth: 170 }} value={documentStatus} onChange={(event) => setDocumentStatus(event.target.value)}>
            <option value="all">문서 전체 상태</option>
            <option value="PENDING">문서 대기</option>
            <option value="PROCESSING">문서 처리중</option>
            <option value="PROCESSED">문서 처리완료</option>
            <option value="FAILED">문서 실패</option>
          </select>
          <select className={selectClass} style={{ maxWidth: 150 }} value={faqStatus} onChange={(event) => setFaqStatus(event.target.value)}>
            <option value="all">FAQ 전체</option>
            <option value="draft">초안</option>
            <option value="published">게시</option>
            <option value="archived">보관</option>
            <option value="expired">만료</option>
          </select>
          <Input style={{ maxWidth: 260 }} value={faqSearch} onChange={(event) => setFaqSearch(event.target.value)} placeholder="FAQ 답변 검색" />
          <Button type="button" variant="outline" onClick={load}>
            <RefreshCwIcon className="size-4" /> 새로고침
          </Button>
          <div className="grow" />
          <span className="badge gray">
            {knowledgeRangeStart.toLocaleString()}-{knowledgeRangeEnd.toLocaleString()} / {visibleKnowledgeRows.length.toLocaleString()}건
          </span>
          <select
            className={selectClass}
            style={{ width: 118 }}
            value={knowledgePageSize}
            onChange={(event) => {
              setKnowledgePageSize(Number(event.target.value))
              setKnowledgePage(1)
            }}
          >
            <option value={10}>10개씩</option>
            <option value={20}>20개씩</option>
            <option value={50}>50개씩</option>
            <option value={100}>100개씩</option>
          </select>
          <span className="muted" style={{ fontSize: 12 }}>
            KMS <span className="mono">{effectiveKmsWorkspace}</span> · FAQ <span className="mono">{effectiveFaqWorkspace}</span>
          </span>
        </div>
        {unlinkedKnowledgeCount > 0 && (
          <div style={{ margin: '0 14px 14px', display: 'flex', gap: 10, padding: 12, borderRadius: 'var(--radius-md)', background: 'var(--warning-soft)', color: '#8a5a0a', fontSize: 12.5, lineHeight: 1.5 }}>
            <LinkIcon className="size-4" style={{ flexShrink: 0, marginTop: 1 }} />
            <span>
              현재 목록에 어드민 원장과 연결되지 않은 기존 LightRAG 지식이 {unlinkedKnowledgeCount.toLocaleString()}건 있습니다.
              연결해야 통합 검색의 카테고리·유효기간 필터 대상에 포함됩니다.
            </span>
            <div className="grow" />
            <Button type="button" size="sm" variant="outline" onClick={openExistingLink}>
              연결하기
            </Button>
          </div>
        )}

        {view === 'table' ? (
          <div className="table-scroll knowledge-table-scroll">
            <table className="tbl">
              <thead>
                <tr>
                  <th style={{ paddingLeft: 14 }}>제목</th>
                  <th>유형</th>
                  <th>출처</th>
                  <th>카테고리</th>
                  <th>상태</th>
                  <th>사용</th>
                  <th>유효기간</th>
                  <th className="num">지표</th>
                  <th>수정일</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {pagedKnowledgeRows.map((row) => (
                  <tr key={`${row.kind}-${row.id}`}>
                    <td>
                      <div className="row" style={{ gap: 6, alignItems: 'center' }}>
                        <div className="ttl">{row.title}</div>
                        {!row.linked && <span className="badge amber">미연결</span>}
                      </div>
                      <div className="muted mono" style={{ fontSize: 11 }}>{row.id} · {row.workspace}</div>
                      {row.summary && <div className="muted" style={{ maxWidth: 460, marginTop: 4, fontSize: 11.5, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{row.summary}</div>}
                      {row.job && (
                        <div style={{ marginTop: 8, maxWidth: 360 }}>
                          <div className={`bar ${badgeTone(row.job.status) === 'green' ? 'green' : badgeTone(row.job.status) === 'red' ? 'red' : ''}`}>
                            <i style={{ width: `${Math.min(100, Number(row.job.progress || 0))}%` }} />
                          </div>
                        </div>
                      )}
                    </td>
                    <td>
                      <span className={`badge ${row.kind === 'faq' ? 'blue' : 'gray'}`}>
                        {row.kind === 'faq' ? <BookOpenIcon className="size-3" /> : <FileTextIcon className="size-3" />}
                        {row.kind === 'faq' ? 'FAQ' : '문서'}
                      </span>
                    </td>
                    <td><span className="badge gray">{row.source}</span></td>
                    <td className="muted">{row.category}</td>
                    <td><span className={`badge ${badgeTone(row.status)}`}>{statusLabel(row.status)}</span></td>
                    <td>{row.enabled ? <span className="badge green"><span className="d" />사용</span> : <span className="badge gray">미사용</span>}</td>
                    <td><span className="num muted" style={{ fontSize: 12 }}>{shortDate(row.validFrom)} ~ {shortDate(row.validUntil)}</span></td>
                    <td className="num" style={{ fontWeight: 600, color: 'var(--fg-primary)' }}>{row.metricValue} <span className="muted" style={{ fontSize: 11 }}>{row.metricLabel}</span></td>
                    <td className="num muted" style={{ fontSize: 12 }}>{shortDate(row.updated)}</td>
                    <td>
                      <div className="row" style={{ gap: 4, justifyContent: 'flex-end' }}>
                        {row.document && (
                          <>
                            <Button type="button" size="sm" variant="ghost" title="탐색" onClick={() => openDocumentDetail(row.document!)} disabled={documentDetailLoadingId === row.document.id}>
                              <LayersIcon className={documentDetailLoadingId === row.document.id ? 'spin size-4' : 'size-4'} />
                            </Button>
                            <Button type="button" size="sm" variant="ghost" title="재지식화" onClick={() => openDocumentReingest(row.document!)} disabled={documentReingestLoadingId === row.document.id}>
                              <RotateCwIcon className={documentReingestLoadingId === row.document.id ? 'spin size-4' : 'size-4'} />
                            </Button>
                            <Button type="button" size="sm" variant="ghost" title="삭제" onClick={() => deleteDocument(row.document!)}>
                              <Trash2Icon className="size-4" />
                            </Button>
                          </>
                        )}
                        {row.answer && (
                          <>
                            <Button type="button" size="sm" variant="ghost" title="설정" onClick={() => openFaqEdit(row.answer!)} disabled={faqEditingLoadingId === row.answer.answer_id}>
                              <EditIcon className={faqEditingLoadingId === row.answer.answer_id ? 'spin size-4' : 'size-4'} />
                            </Button>
                            {row.answer.status !== 'published' && (
                              <Button type="button" size="sm" variant="ghost" title="게시" onClick={() => runFaqAction(row.answer!, 'publish')}>
                                <CheckCircleIcon className="size-4" />
                              </Button>
                            )}
                            {row.answer.status !== 'archived' && (
                              <Button type="button" size="sm" variant="ghost" title="보관" onClick={() => runFaqAction(row.answer!, 'archive')}>
                                <ArchiveIcon className="size-4" />
                              </Button>
                            )}
                            <Button type="button" size="sm" variant="ghost" title="벡터 재생성" onClick={() => runFaqAction(row.answer!, 'vectors-rebuild')}>
                              <RotateCwIcon className="size-4" />
                            </Button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
                {!visibleKnowledgeRows.length && (
                  <tr>
                    <td colSpan={10} className="empty">등록된 지식이 없습니다.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fill,minmax(330px,1fr))', padding: '0 8px 8px' }}>
            {pagedKnowledgeRows.map((row) => (
              <div key={`${row.kind}-${row.id}`} className="card" style={{ padding: 'var(--pad-card)' }}>
                <div className="row" style={{ gap: 8, marginBottom: 12 }}>
                  <span className={`badge ${row.kind === 'faq' ? 'blue' : 'gray'}`}>
                    {row.kind === 'faq' ? <BookOpenIcon className="size-3" /> : <FileTextIcon className="size-3" />}
                    {row.kind === 'faq' ? 'FAQ' : '문서'}
                  </span>
                  <span className={`badge ${badgeTone(row.status)}`}>{statusLabel(row.status)}</span>
                  <div className="grow" />
                  {row.enabled ? <span className="badge green"><span className="d" />사용</span> : <span className="badge gray">미사용</span>}
                </div>
                <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--fg-primary)', lineHeight: 1.45 }}>{row.title}</div>
                <div className="row" style={{ gap: 8, marginTop: 6 }}>
                  <span className="muted" style={{ fontSize: 12 }}><FolderIcon className="size-3" /> {row.category}</span>
                  {!row.linked && <span className="badge amber">미연결</span>}
                  <div className="grow" />
                  <span className="badge outline" style={{ fontSize: 10.5 }}>{row.source}</span>
                </div>
                {row.job && (
                  <div style={{ marginTop: 12 }}>
                    <div className={`bar ${badgeTone(row.job.status) === 'green' ? 'green' : badgeTone(row.job.status) === 'red' ? 'red' : ''}`}>
                      <i style={{ width: `${Math.min(100, Number(row.job.progress || 0))}%` }} />
                    </div>
                    <div className="muted" style={{ marginTop: 5, fontSize: 11.5 }}>{Number(row.job.progress || 0).toFixed(0)}% · {row.job.message || '작업 진행 중'}</div>
                  </div>
                )}
                {row.summary && <div className="muted" style={{ marginTop: 12, fontSize: 12.5, lineHeight: 1.55 }}>{row.summary.slice(0, 120)}</div>}
                <hr className="hr" style={{ margin: '14px 0 12px' }} />
                <div className="row wrap" style={{ fontSize: 11.5 }}>
                  <span className="num muted">{shortDate(row.validFrom)} ~ {shortDate(row.validUntil)}</span>
                  <div className="grow" />
                  <span className="num" style={{ fontWeight: 700, color: 'var(--fg-primary)' }}>{row.metricValue} {row.metricLabel}</span>
                </div>
                <div className="row" style={{ gap: 6, marginTop: 12 }}>
                  {row.document && (
                    <>
                      <Button type="button" size="sm" variant="outline" onClick={() => openDocumentDetail(row.document!)} disabled={documentDetailLoadingId === row.document.id}>
                        <LayersIcon className={documentDetailLoadingId === row.document.id ? 'spin size-4' : 'size-4'} /> 탐색
                      </Button>
                      <Button type="button" size="sm" variant="ghost" onClick={() => openDocumentReingest(row.document!)} disabled={documentReingestLoadingId === row.document.id}>
                        <RotateCwIcon className={documentReingestLoadingId === row.document.id ? 'spin size-4' : 'size-4'} /> 재지식화
                      </Button>
                      <Button type="button" size="sm" variant="ghost" onClick={() => deleteDocument(row.document!)}>
                        <Trash2Icon className="size-4" /> 삭제
                      </Button>
                    </>
                  )}
                  {row.answer && (
                    <>
                      <Button type="button" size="sm" variant="outline" onClick={() => openFaqEdit(row.answer!)} disabled={faqEditingLoadingId === row.answer.answer_id}>
                        <EditIcon className={faqEditingLoadingId === row.answer.answer_id ? 'spin size-4' : 'size-4'} /> 설정
                      </Button>
                      <Button type="button" size="sm" variant="ghost" onClick={() => runFaqAction(row.answer!, 'vectors-rebuild')}>
                        <RotateCwIcon className="size-4" /> 벡터
                      </Button>
                    </>
                  )}
                </div>
              </div>
            ))}
            {!visibleKnowledgeRows.length && <div className="empty">등록된 지식이 없습니다.</div>}
          </div>
        )}
        {visibleKnowledgeRows.length > 0 && (
          <div className="row wrap" style={{ gap: 8, padding: '12px 14px 4px', borderTop: '1px solid var(--border-subtle)' }}>
            <span className="muted" style={{ fontSize: 12 }}>
              {knowledgeRangeStart.toLocaleString()}-{knowledgeRangeEnd.toLocaleString()} 표시 · 전체 {visibleKnowledgeRows.length.toLocaleString()}건
            </span>
            <div className="grow" />
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => setKnowledgePage(1)}
              disabled={knowledgePage <= 1}
            >
              처음
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => setKnowledgePage((page) => Math.max(1, page - 1))}
              disabled={knowledgePage <= 1}
            >
              이전
            </Button>
            <span className="badge gray">{knowledgePage} / {knowledgeTotalPages}</span>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => setKnowledgePage((page) => Math.min(knowledgeTotalPages, page + 1))}
              disabled={knowledgePage >= knowledgeTotalPages}
            >
              다음
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => setKnowledgePage(knowledgeTotalPages)}
              disabled={knowledgePage >= knowledgeTotalPages}
            >
              마지막
            </Button>
          </div>
        )}
      </div>
      {adding && (
        <KnowledgeCreateModal
          sourceType={sourceType}
          setSourceType={(type) => {
            setSourceType(type)
            setFormError('')
          }}
          form={form}
          updateForm={updateForm}
          file={file}
          setFile={setFile}
          categories={categories}
          formError={formError}
          submitting={submitting}
          canSubmit={Boolean(canSubmit)}
          onSubmit={submitKnowledge}
          onClose={() => {
            setAdding(false)
            setFormError('')
          }}
        />
      )}
      {linkingExisting && (
        <ExistingKnowledgeLinkModal
          form={existingLinkForm}
          updateForm={(patch) => setExistingLinkForm((value) => ({ ...value, ...patch }))}
          categories={categories}
          unlinkedDocumentCount={unlinkedDocumentRows.length}
          unlinkedFaqCount={unlinkedFaqRows.length}
          submitting={existingLinkSubmitting}
          error={existingLinkError}
          result={existingLinkResult}
          onSubmit={submitExistingLink}
          onClose={() => setLinkingExisting(false)}
        />
      )}
      {documentDetail && <KmsDocumentExplorer detail={documentDetail} onClose={() => setDocumentDetail(null)} />}
      {documentReingestDetail && (
        <KmsDocumentReingestModal
          detail={documentReingestDetail}
          form={documentReingestForm}
          updateForm={(patch) => setDocumentReingestForm((value) => ({ ...value, ...patch }))}
          categories={categories}
          submitting={documentReingestSubmitting}
          error={documentReingestError}
          onSubmit={submitDocumentReingest}
          onClose={closeDocumentReingest}
        />
      )}
      {faqEditing && (
        <FaqAnswerSettings
          answer={faqEditing}
          onClose={closeFaqEdit}
          onSave={saveFaqAnswer}
          guidance={faqGuidance}
          guidanceLoading={faqGuidanceLoading}
          onCreateGuidance={createFaqGuidance}
          onDeleteGuidance={deleteFaqGuidance}
        />
      )}
      {faqTerminologyOpen && (
        <FaqTerminologyManager
          workspace={effectiveFaqWorkspace}
          onClose={() => setFaqTerminologyOpen(false)}
        />
      )}
      {faqBulkCreateOpen && (
        <FaqBulkCreate
          workspace={effectiveFaqWorkspace}
          categories={categories}
          onClose={() => setFaqBulkCreateOpen(false)}
          onCreated={() => load()}
        />
      )}
    </div>
  )
}

export function Categories() {
  const user = useAuthStore((state) => state.user)
  const canSelectTenant = user?.role === 'admin'
  const [selectedTenantId, setSelectedTenantId] = useState(user?.tenant_id || DEFAULT_TENANT_ID)
  const [categories, setCategories] = useState<Category[]>([])
  const [editingId, setEditingId] = useState<string | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [open, setOpen] = useState<Record<string, boolean>>({})
  const [addingParentId, setAddingParentId] = useState<string | null | undefined>(undefined)
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [form, setForm] = useState({
    name: '',
    parent_id: '',
    sort_order: '0',
    is_active: true
  })

  const load = async () => {
    const response = await api.get('/api/categories', { params: { tenant_id: selectedTenantId } })
    const nextCategories = response.data.categories || []
    setCategories(nextCategories)
    setOpen((value) => ({
      ...Object.fromEntries(nextCategories.map((category: Category) => [category.category_id, true])),
      ...value
    }))
    setSelectedId((value) =>
      value && nextCategories.some((category: Category) => category.category_id === value)
        ? value
        : nextCategories[0]?.category_id || null
    )
  }

  useEffect(() => {
    load()
  }, [selectedTenantId])

  const resetForm = () => {
    setEditingId(null)
    setForm({ name: '', parent_id: '', sort_order: '0', is_active: true })
  }

  const childrenOf = (parentId: string | null) =>
    categories
      .filter((category) => (category.parent_id || null) === parentId)
      .sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0) || a.name.localeCompare(b.name))

  const directKnowledgeCount = (category: Category) => Number(category.direct_knowledge_count || 0)
  const totalKnowledgeCount = (category: Category) =>
    Number(category.total_knowledge_count ?? category.direct_knowledge_count ?? 0)

  const descendantsOf = (categoryId: string): Set<string> => {
    const result = new Set<string>()
    const visit = (id: string) => {
      childrenOf(id).forEach((child) => {
        result.add(child.category_id)
        visit(child.category_id)
      })
    }
    visit(categoryId)
    return result
  }

  const selected = selectedId ? categories.find((category) => category.category_id === selectedId) : null

  const parentOptions = useMemo(
    () => {
      const blocked = editingId ? descendantsOf(editingId) : new Set<string>()
      if (editingId) {
        blocked.add(editingId)
      }
      return categories.filter((category) => category.is_active && !blocked.has(category.category_id))
    },
    [categories, editingId]
  )

  const selectedParentOptions = useMemo(() => {
    if (!selected) return []
    const blocked = descendantsOf(selected.category_id)
    blocked.add(selected.category_id)
    return categories.filter((category) => category.is_active && !blocked.has(category.category_id))
  }, [categories, selected])

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    const payload = {
      tenant_id: selectedTenantId,
      name: form.name,
      parent_id: form.parent_id || null,
      sort_order: Number(form.sort_order || 0),
      is_active: form.is_active
    }
    if (editingId) {
      await api.patch(`/api/categories/${editingId}`, payload)
    } else {
      const response = await api.post('/api/categories', payload)
      setSelectedId(response.data.category_id)
      if (payload.parent_id) {
        setOpen((value) => ({ ...value, [payload.parent_id as string]: true }))
      }
    }
    resetForm()
    await load()
  }

  const startCreate = (parentId: string | null = null) => {
    setEditingId(null)
    setForm({ name: '', parent_id: parentId || '', sort_order: '0', is_active: true })
    setAddingParentId(parentId)
    setRenamingId(null)
    if (parentId) {
      setOpen((value) => ({ ...value, [parentId]: true }))
      setSelectedId(parentId)
    }
  }

  const startChild = (category: Category) => {
    startCreate(category.category_id)
  }

  const startEdit = (category: Category) => {
    setEditingId(category.category_id)
    setForm({
      name: category.name,
      parent_id: category.parent_id || '',
      sort_order: String(category.sort_order || 0),
      is_active: category.is_active
    })
    setSelectedId(category.category_id)
  }

  const commitInlineAdd = async (parentId: string | null, name: string) => {
    const trimmed = name.trim()
    setAddingParentId(undefined)
    if (!trimmed) {
      return
    }
    const response = await api.post('/api/categories', {
      tenant_id: selectedTenantId,
      name: trimmed,
      parent_id: parentId,
      sort_order: childrenOf(parentId).length,
      is_active: true
    })
    if (parentId) {
      setOpen((value) => ({ ...value, [parentId]: true }))
    }
    setSelectedId(response.data.category_id)
    await load()
  }

  const commitInlineRename = async (category: Category, name: string) => {
    const trimmed = name.trim()
    setRenamingId(null)
    if (!trimmed || trimmed === category.name) {
      return
    }
    await api.patch(`/api/categories/${category.category_id}`, {
      tenant_id: selectedTenantId,
      name: trimmed,
      parent_id: category.parent_id,
      sort_order: category.sort_order || 0,
      is_active: category.is_active
    })
    await load()
  }

  const patchCategory = async (category: Category, patch: Partial<Category>) => {
    await api.patch(`/api/categories/${category.category_id}`, {
      tenant_id: selectedTenantId,
      name: patch.name ?? category.name,
      parent_id: patch.parent_id === undefined ? category.parent_id : patch.parent_id,
      sort_order: patch.sort_order ?? category.sort_order ?? 0,
      is_active: patch.is_active ?? category.is_active
    })
    await load()
  }

  const moveCategory = async (category: Category, direction: -1 | 1) => {
    const siblings = childrenOf(category.parent_id || null)
    const index = siblings.findIndex((item) => item.category_id === category.category_id)
    const target = siblings[index + direction]
    if (!target) return
    await Promise.all([
      patchCategory(category, { sort_order: target.sort_order || 0 }),
      patchCategory(target, { sort_order: category.sort_order || 0 })
    ])
    await load()
  }

  const deactivate = async (category: Category) => {
    await api.delete(`/api/categories/${category.category_id}`, { params: { tenant_id: selectedTenantId } })
    await load()
    if (editingId === category.category_id) {
      resetForm()
    }
    if (selectedId === category.category_id) {
      setSelectedId(null)
    }
  }

  const pathParts = selected?.path.split('/').filter(Boolean) || []

  const DraftRow = ({ parentId }: { parentId: string | null }) => (
    <div className="cat-row" style={{ background: 'var(--accent-soft)' }}>
      <span style={{ width: 20, flexShrink: 0 }} />
      <TagIcon className="size-4" style={{ color: 'var(--accent)', flexShrink: 0 }} />
      <input
        className="cat-input grow"
        autoFocus
        placeholder="새 카테고리명 입력 후 Enter"
        onKeyDown={(event) => {
          if (event.key === 'Enter') event.currentTarget.blur()
          if (event.key === 'Escape') {
            event.currentTarget.value = ''
            setAddingParentId(undefined)
          }
        }}
        onBlur={(event) => commitInlineAdd(parentId, event.currentTarget.value)}
      />
    </div>
  )

  const Node = ({ category }: { category: Category }) => {
    const children = childrenOf(category.category_id)
    const isOpen = open[category.category_id]
    const isSelected = selectedId === category.category_id
    const isRenaming = renamingId === category.category_id
    const categoryKnowledgeCount = totalKnowledgeCount(category)
    return (
      <div>
        <div className={`cat-row${isSelected ? ' sel' : ''}`} onClick={() => setSelectedId(category.category_id)}>
          {children.length ? (
            <button
              className="cat-tw"
              type="button"
              onClick={(event) => {
                event.stopPropagation()
                setOpen((value) => ({ ...value, [category.category_id]: !isOpen }))
              }}
            >
              {isOpen ? <ChevronDownIcon className="size-4" /> : <ChevronRightIcon className="size-4" />}
            </button>
          ) : (
            <span style={{ width: 20, flexShrink: 0 }} />
          )}
          {children.length ? (
            <FolderIcon
              className="size-4"
              style={{ color: category.is_active ? 'var(--accent)' : 'var(--fg-muted)', flexShrink: 0 }}
            />
          ) : (
            <TagIcon
              className="size-4"
              style={{ color: category.is_active ? 'var(--accent)' : 'var(--fg-muted)', flexShrink: 0 }}
            />
          )}
          {isRenaming ? (
            <input
              className="cat-input grow"
              autoFocus
              defaultValue={category.name}
              onClick={(event) => event.stopPropagation()}
              onKeyDown={(event) => {
                if (event.key === 'Enter') event.currentTarget.blur()
                if (event.key === 'Escape') {
                  event.currentTarget.value = category.name
                  setRenamingId(null)
                }
              }}
              onBlur={(event) => commitInlineRename(category, event.currentTarget.value)}
            />
          ) : (
            <span
              className="cat-name grow"
              style={{ color: category.is_active ? undefined : 'var(--fg-muted)' }}
              onDoubleClick={(event) => {
                event.stopPropagation()
                setRenamingId(category.category_id)
                setAddingParentId(undefined)
              }}
            >
              {category.name}
            </span>
          )}
          {!category.is_active && <span className="badge gray">비활성</span>}
          {children.length > 0 && !isRenaming && <span className="badge gray">하위 {children.length}</span>}
          {!isRenaming && (
            <span
              className="cat-count"
              title={`직접 등록 ${directKnowledgeCount(category).toLocaleString()}건 · 하위 포함 ${categoryKnowledgeCount.toLocaleString()}건`}
            >
              지식 {categoryKnowledgeCount.toLocaleString()}
            </span>
          )}
          {!isRenaming && (
            <div className="cat-acts" onClick={(event) => event.stopPropagation()}>
              <button className="cat-act" type="button" title="하위 추가" onClick={() => startChild(category)}>
                <PlusIcon className="size-4" />
              </button>
              <button
                className="cat-act"
                type="button"
                title="이름 변경"
                onClick={() => {
                  setRenamingId(category.category_id)
                  setAddingParentId(undefined)
                  startEdit(category)
                }}
              >
                <EditIcon className="size-4" />
              </button>
              {category.is_active && (
                <button className="cat-act" type="button" title="비활성" onClick={() => deactivate(category)}>
                  <EyeOffIcon className="size-4" />
                </button>
              )}
            </div>
          )}
        </div>
        {isOpen && (children.length > 0 || addingParentId === category.category_id) && (
          <div className="cat-children">
            {children.map((child) => (
              <Node key={child.category_id} category={child} />
            ))}
            {addingParentId === category.category_id && <DraftRow parentId={category.category_id} />}
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="content-inner fadein">
      <div className="page-head">
        <div>
          <h1>카테고리</h1>
          <p>고객센터별 지식을 분류하는 트리입니다. 행에서 하위 카테고리를 바로 추가하고 상세 패널에서 구조를 변경합니다.</p>
        </div>
        <div className="sp" />
        <RelatedHelp topicIds={['HELP-CATEGORY-001']} />
        {canSelectTenant && (
          <div style={{ minWidth: 360 }}>
            <TenantSelect value={selectedTenantId} onChange={setSelectedTenantId} required />
          </div>
        )}
        <Button type="button" onClick={() => startCreate(null)}>
          <PlusIcon className="size-4" /> 카테고리 추가
        </Button>
      </div>

      <div className="grid" style={{ gridTemplateColumns: 'minmax(0,1fr) 380px', alignItems: 'start' }}>
        <div className="card">
          <div className="card-h">
            <div>
              <div className="t">카테고리 트리</div>
              <div className="sub">
                {categories.length}개 · 활성 {categories.filter((category) => category.is_active).length}개 · 지식{' '}
                {categories.reduce((sum, category) => sum + directKnowledgeCount(category), 0).toLocaleString()}건
              </div>
            </div>
            <div className="sp" />
            <button
              className="btn btn-ghost btn-sm"
              type="button"
              onClick={() => setOpen(Object.fromEntries(categories.map((category) => [category.category_id, true])))}
            >
              모두 펼치기
            </button>
          </div>
          <div className="card-b">
            <div className="cat-tree">
              {childrenOf(null).map((category) => (
                <Node key={category.category_id} category={category} />
              ))}
              {addingParentId === null && <DraftRow parentId={null} />}
              {!categories.length && <div className="empty">카테고리가 없습니다. 카테고리 추가로 시작하세요.</div>}
            </div>
          </div>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>{editingId ? '카테고리 수정' : '카테고리 상세'}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="col" style={{ gap: 16 }}>
              {selected && (
                <div>
                  <div className="row wrap" style={{ gap: 5, marginBottom: 8 }}>
                    {pathParts.map((part, index) => (
                      <span key={`${part}-${index}`} className={index === pathParts.length - 1 ? '' : 'muted'} style={{ fontSize: 12, fontWeight: index === pathParts.length - 1 ? 700 : 500 }}>
                        {part}
                        {index < pathParts.length - 1 && <ChevronRightIcon className="inline size-3" />}
                      </span>
                    ))}
                  </div>
                  <div className="row" style={{ gap: 8 }}>
                    <span style={{ fontSize: 18, fontWeight: 700, color: 'var(--fg-primary)' }}>{selected.name}</span>
                    {selected.is_active ? <span className="badge green"><span className="d" />활성</span> : <span className="badge gray">비활성</span>}
                  </div>
                  <div className="grid" style={{ gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 14 }}>
                    <div style={{ padding: '11px 12px', background: 'var(--bg-subtle)', borderRadius: 'var(--radius-md)' }}>
                      <div className="eyebrow" style={{ fontSize: 9.5, marginBottom: 5 }}>하위 카테고리</div>
                      <div className="num" style={{ fontSize: 18, fontWeight: 700, color: 'var(--fg-primary)' }}>{childrenOf(selected.category_id).length}</div>
                    </div>
                    <div style={{ padding: '11px 12px', background: 'var(--bg-subtle)', borderRadius: 'var(--radius-md)' }}>
                      <div className="eyebrow" style={{ fontSize: 9.5, marginBottom: 5 }}>등록 지식</div>
                      <div className="num" style={{ fontSize: 18, fontWeight: 700, color: 'var(--fg-primary)' }}>{directKnowledgeCount(selected).toLocaleString()}</div>
                    </div>
                    <div style={{ padding: '11px 12px', background: 'var(--bg-subtle)', borderRadius: 'var(--radius-md)' }}>
                      <div className="eyebrow" style={{ fontSize: 9.5, marginBottom: 5 }}>하위 포함 지식</div>
                      <div className="num" style={{ fontSize: 18, fontWeight: 700, color: 'var(--fg-primary)' }}>{totalKnowledgeCount(selected).toLocaleString()}</div>
                    </div>
                    <div style={{ padding: '11px 12px', background: 'var(--bg-subtle)', borderRadius: 'var(--radius-md)' }}>
                      <div className="eyebrow" style={{ fontSize: 9.5, marginBottom: 5 }}>정렬 순서</div>
                      <div className="num" style={{ fontSize: 18, fontWeight: 700, color: 'var(--fg-primary)' }}>{selected.sort_order || 0}</div>
                    </div>
                  </div>
                  <div className="row" style={{ gap: 10, padding: 12, background: 'var(--bg-subtle)', borderRadius: 'var(--radius-md)', marginTop: 14 }}>
                    <div className="grow">
                      <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--fg-primary)' }}>사용 여부</div>
                      <div className="muted" style={{ fontSize: 12 }}>비활성 시 검색 필터와 답변 후보 범위에서 제외됩니다.</div>
                    </div>
                    <label className="switch">
                      <input
                        type="checkbox"
                        checked={selected.is_active}
                        onChange={(event) => patchCategory(selected, { is_active: event.target.checked })}
                      />
                      <span className="track" />
                      <span className="thumb" />
                    </label>
                  </div>
                  <label className="field" style={{ marginTop: 14 }}>
                    <span>상위 카테고리</span>
                    <select
                      className={selectClass}
                      value={selected.parent_id || ''}
                      onChange={(event) => patchCategory(selected, { parent_id: event.target.value || null })}
                    >
                      <option value="">최상위</option>
                      {selectedParentOptions.map((category) => (
                          <option key={category.category_id} value={category.category_id}>
                            {'　'.repeat(categoryDepth(category))}
                            {category.name}
                          </option>
                        ))}
                    </select>
                  </label>
                  <div className="field" style={{ marginTop: 14 }}>
                    <span style={{ fontSize: 12.5, fontWeight: 500 }}>형제 간 순서</span>
                    <div className="row" style={{ gap: 8 }}>
                      <Button type="button" size="sm" variant="outline" onClick={() => moveCategory(selected, -1)}>
                        <ChevronDownIcon className="size-4" style={{ transform: 'rotate(180deg)' }} /> 위로
                      </Button>
                      <Button type="button" size="sm" variant="outline" onClick={() => moveCategory(selected, 1)}>
                        <ChevronDownIcon className="size-4" /> 아래로
                      </Button>
                      <div className="grow" />
                      <Button type="button" size="sm" variant="outline" onClick={() => startChild(selected)}>
                        <PlusIcon className="size-4" /> 하위 추가
                      </Button>
                    </div>
                  </div>
                  <div className="row" style={{ gap: 8, marginTop: 12 }}>
                    <Button type="button" size="sm" variant="outline" onClick={() => startEdit(selected)}>
                      <EditIcon className="size-4" /> 수정
                    </Button>
                    {selected.is_active && (
                      <Button type="button" size="sm" variant="ghost" onClick={() => deactivate(selected)}>
                        <EyeOffIcon className="size-4" /> 비활성
                      </Button>
                    )}
                  </div>
                </div>
              )}

              <form className="col" style={{ gap: 12 }} onSubmit={submit}>
                <div className="eyebrow">{editingId ? '수정 내용' : '새 카테고리'}</div>
                <label className="field">
                  <span>상위 카테고리</span>
                  <select
                    className={selectClass}
                    value={form.parent_id}
                    onChange={(event) => setForm((value) => ({ ...value, parent_id: event.target.value }))}
                  >
                    <option value="">최상위</option>
                    {parentOptions.map((category) => (
                      <option key={category.category_id} value={category.category_id}>
                        {'　'.repeat(categoryDepth(category))}
                        {category.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="field">
                  <span>카테고리명</span>
                  <Input
                    value={form.name}
                    onChange={(event) => setForm((value) => ({ ...value, name: event.target.value }))}
                    placeholder="예: 상품 정책"
                    required
                  />
                </label>
                <div className="grid" style={{ gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                  <label className="field">
                    <span>정렬 순서</span>
                    <Input
                      type="number"
                      value={form.sort_order}
                      onChange={(event) => setForm((value) => ({ ...value, sort_order: event.target.value }))}
                    />
                  </label>
                  <label className="check" style={{ alignSelf: 'end', minHeight: 38 }}>
                    <input
                      type="checkbox"
                      checked={form.is_active}
                      onChange={(event) => setForm((value) => ({ ...value, is_active: event.target.checked }))}
                    />
                    사용
                  </label>
                </div>
                <div className="row" style={{ gap: 8 }}>
                  <Button type="submit" disabled={!form.name.trim()}>
                    {editingId ? <SaveIcon className="size-4" /> : <PlusIcon className="size-4" />}
                    {editingId ? '저장' : '추가'}
                  </Button>
                  {(editingId || form.parent_id || form.name) && (
                    <Button type="button" variant="outline" onClick={resetForm}>
                      취소
                    </Button>
                  )}
                </div>
              </form>

              <div style={{ display: 'flex', gap: 10, padding: 12, background: 'var(--accent-soft)', borderRadius: 'var(--radius-md)', fontSize: 12, color: 'var(--fg-primary-soft)', lineHeight: 1.5 }}>
                상위 변경 시 하위 경로가 자동 재계산되며, 자기 자신이나 하위 카테고리를 상위로 지정하는 구조는 차단됩니다.
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

export function ExternalClients() {
  const user = useAuthStore((state) => state.user)
  const selectedKmsWorkspace = useWorkspaceScopeStore((state) => state.kmsWorkspace)
  const selectedFaqWorkspace = useWorkspaceScopeStore((state) => state.faqWorkspace)
  const effectiveKmsWorkspace = normalizeKmsWorkspace(selectedKmsWorkspace || user?.kms_workspace)
  const effectiveFaqWorkspace = normalizeFaqWorkspace(selectedFaqWorkspace || user?.faq_workspace)
  const effectiveTenantId = user?.tenant_id || DEFAULT_TENANT_ID
  const [form, setForm] = useState({
    display_name: '',
    tenant_id: effectiveTenantId,
    kms_workspace: effectiveKmsWorkspace,
    faq_workspace: effectiveFaqWorkspace,
    scopes: 'search',
    rate_limit_per_minute: '120',
    is_active: true
  })
  const [editingId, setEditingId] = useState<string | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [clients, setClients] = useState<ApiClient[]>([])
  const [issuedKey, setIssuedKey] = useState('')
  const [historyClient, setHistoryClient] = useState<ApiClient | null>(null)
  const [historyRows, setHistoryRows] = useState<ExternalSearchLog[]>([])
  const [historyLoading, setHistoryLoading] = useState(false)
  const [revealClient, setRevealClient] = useState<ApiClient | null>(null)
  const [revealPassword, setRevealPassword] = useState('')
  const [revealedKey, setRevealedKey] = useState('')
  const [revealError, setRevealError] = useState('')
  const [revealLoading, setRevealLoading] = useState(false)
  const [sampleOpen, setSampleOpen] = useState(false)
  const [sampleTab, setSampleTab] = useState<'search' | 'categories' | 'docs'>('search')
  const [sampleApiKey, setSampleApiKey] = useState('')
  const [sampleEndpoint, setSampleEndpoint] = useState<'sync' | 'stream'>(externalSearchSamplePresets[0].endpoint)
  const [samplePresetKey, setSamplePresetKey] = useState(externalSearchSamplePresets[0].key)
  const [samplePayloadText, setSamplePayloadText] = useState(prettyJson(externalSearchSamplePresets[0].payload))
  const [sampleResult, setSampleResult] = useState('')
  const [sampleError, setSampleError] = useState('')
  const [sampleRunning, setSampleRunning] = useState(false)
  const [sampleCategoryResult, setSampleCategoryResult] = useState('')
  const [sampleCategoryError, setSampleCategoryError] = useState('')
  const [sampleCategoryLoading, setSampleCategoryLoading] = useState(false)

  const load = async () => {
    const response = await api.get('/api/external-clients')
    setClients(response.data.clients || [])
  }

  useEffect(() => {
    load()
  }, [])

  useEffect(() => {
    if (issuedKey && !sampleApiKey) setSampleApiKey(issuedKey)
  }, [issuedKey, sampleApiKey])

  const resetExternalForm = () => {
    setEditingId(null)
    setShowForm(false)
    setForm({
      display_name: '',
      tenant_id: effectiveTenantId,
      kms_workspace: effectiveKmsWorkspace,
      faq_workspace: effectiveFaqWorkspace,
      scopes: 'search',
      rate_limit_per_minute: '120',
      is_active: true
    })
  }

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    const payload = {
      display_name: form.display_name,
      tenant_id: form.tenant_id,
      scopes: form.scopes.split(',').map((scope) => scope.trim()).filter(Boolean),
      rate_limit_per_minute: Number(form.rate_limit_per_minute || 120),
      is_active: form.is_active
    }
    if (editingId) {
      await api.patch(`/api/external-clients/${editingId}`, payload)
    } else {
      const response = await api.post('/api/external-clients', payload)
      setIssuedKey(response.data.api_key)
    }
    resetExternalForm()
    await load()
  }

  const startEdit = (client: ApiClient) => {
    setEditingId(client.client_id)
    setShowForm(true)
    setIssuedKey('')
    setForm({
      display_name: client.display_name,
      tenant_id: client.tenant_id || effectiveTenantId,
      kms_workspace: client.kms_workspace,
      faq_workspace: client.faq_workspace,
      scopes: (client.scopes || ['search']).join(', '),
      rate_limit_per_minute: String(client.rate_limit_per_minute || 120),
      is_active: client.is_active
    })
  }

  const startCreate = () => {
    setEditingId(null)
    setIssuedKey('')
    setForm({
      display_name: '',
      tenant_id: effectiveTenantId,
      kms_workspace: effectiveKmsWorkspace,
      faq_workspace: effectiveFaqWorkspace,
      scopes: 'search',
      rate_limit_per_minute: '120',
      is_active: true
    })
    setShowForm(true)
  }

  const rotateKey = async (clientId: string) => {
    const response = await api.post(`/api/external-clients/${clientId}/rotate-key`)
    setIssuedKey(response.data.api_key)
    await load()
  }

  const revokeKey = async (clientId: string) => {
    await api.post(`/api/external-clients/${clientId}/revoke-key`)
    await load()
  }

  const openClientHistory = async (client: ApiClient) => {
    setHistoryClient(client)
    setHistoryLoading(true)
    try {
      const response = await api.get(`/api/external-clients/${client.client_id}/search-logs`)
      setHistoryRows(response.data.logs || [])
    } finally {
      setHistoryLoading(false)
    }
  }

  const downloadClientHistory = async (clientId: string) => {
    const response = await api.get(`/api/external-clients/${clientId}/search-logs.csv`, { responseType: 'blob' })
    const url = URL.createObjectURL(new Blob([response.data], { type: 'text/csv;charset=utf-8' }))
    const link = document.createElement('a')
    link.href = url
    link.download = `${clientId}-search-logs.csv`
    link.click()
    URL.revokeObjectURL(url)
  }

  const toggleActive = async (client: ApiClient) => {
    await api.patch(`/api/external-clients/${client.client_id}`, { is_active: !client.is_active })
    await load()
  }

  const openRevealKey = (client: ApiClient) => {
    setRevealClient(client)
    setRevealPassword('')
    setRevealedKey('')
    setRevealError(
      client.api_key_revealable
        ? ''
        : '이 API Key는 암호화 저장 이전에 발급되어 원문 확인이 불가합니다. 키를 재발급하면 이후부터 비밀번호 확인 후 다시 볼 수 있습니다.'
    )
  }

  const revealKey = async (event: FormEvent) => {
    event.preventDefault()
    if (!revealClient || !revealPassword.trim()) return
    setRevealLoading(true)
    setRevealError('')
    setRevealedKey('')
    try {
      const response = await api.post(`/api/external-clients/${revealClient.client_id}/reveal-key`, {
        password: revealPassword
      })
      setRevealedKey(response.data.api_key || '')
      setRevealPassword('')
    } catch (error: any) {
      setRevealError(error?.response?.data?.detail || 'API Key 확인에 실패했습니다.')
    } finally {
      setRevealLoading(false)
    }
  }

  const openSampleTester = () => {
    setSampleOpen(true)
    setSampleTab('search')
    setSampleError('')
    setSampleResult('')
    setSampleCategoryError('')
    setSampleCategoryResult('')
    if (issuedKey && !sampleApiKey) setSampleApiKey(issuedKey)
  }

  const applySamplePreset = (presetKey: string) => {
    const preset = externalSearchSamplePresets.find((item) => item.key === presetKey) || externalSearchSamplePresets[0]
    setSamplePresetKey(preset.key)
    setSampleEndpoint(preset.endpoint)
    setSamplePayloadText(prettyJson(preset.payload))
    setSampleError('')
    setSampleResult('')
  }

  const sampleRequestCurl = useMemo(() => {
    const path = sampleEndpoint === 'stream' ? '/api/external/search/stream' : '/api/external/search'
    const command = sampleEndpoint === 'stream' ? 'curl -N -X POST' : 'curl -X POST'
    const key = sampleApiKey.trim() || issuedKey || 'kmsadm_발급받은_API_KEY'
    return `${command} http://127.0.0.1:9522${path} \\
  -H 'Content-Type: application/json' \\
  -H 'X-KMS-ADMIN-API-Key: ${key}' \\
  -d '${samplePayloadText}'`
  }, [issuedKey, sampleApiKey, sampleEndpoint, samplePayloadText])

  const sampleCategoryCurl = useMemo(() => {
    const key = sampleApiKey.trim() || issuedKey || 'kmsadm_발급받은_API_KEY'
    return `curl -X GET 'http://127.0.0.1:9522/api/external/categories' \\
  -H 'X-KMS-ADMIN-API-Key: ${key}'`
  }, [issuedKey, sampleApiKey])

  const runSampleCategoryRequest = async () => {
    setSampleCategoryError('')
    setSampleCategoryResult('')
    if (!sampleApiKey.trim()) {
      setSampleCategoryError('API Key를 입력해야 카테고리 조회를 실행할 수 있습니다.')
      return
    }
    setSampleCategoryLoading(true)
    try {
      const response = await fetch('/api/external/categories', {
        headers: {
          'X-KMS-ADMIN-API-Key': sampleApiKey.trim()
        }
      })
      if (!response.ok) {
        const errorText = await response.text()
        throw new Error(errorText || `HTTP ${response.status}`)
      }
      setSampleCategoryResult(prettyJson(await response.json()))
    } catch (error: any) {
      setSampleCategoryError(error?.message || '카테고리 조회에 실패했습니다.')
    } finally {
      setSampleCategoryLoading(false)
    }
  }

  const runSampleRequest = async () => {
    setSampleError('')
    setSampleResult('')
    if (!sampleApiKey.trim()) {
      setSampleError('API Key를 입력해야 합니다. API 관리에서 비밀번호 재확인 후 원문 Key를 확인할 수 있습니다.')
      return
    }

    let payload: unknown
    try {
      payload = JSON.parse(samplePayloadText)
    } catch (error: any) {
      setSampleError(`요청 JSON 형식이 올바르지 않습니다. ${error?.message || ''}`.trim())
      return
    }

    setSampleRunning(true)
    try {
      if (sampleEndpoint === 'sync') {
        const response = await api.post('/api/external/search', payload, {
          headers: { 'X-KMS-ADMIN-API-Key': sampleApiKey.trim() }
        })
        setSampleResult(prettyJson(response.data))
        return
      }

      const response = await fetch('/api/external/search/stream', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-KMS-ADMIN-API-Key': sampleApiKey.trim()
        },
        body: JSON.stringify(payload)
      })
      if (!response.ok) {
        const errorText = await response.text()
        throw new Error(errorText || `HTTP ${response.status}`)
      }
      const reader = response.body?.getReader()
      if (!reader) {
        setSampleResult('스트리밍 응답 본문을 읽을 수 없습니다.')
        return
      }
      const decoder = new TextDecoder()
      let buffer = ''
      const lines: string[] = []
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const parts = buffer.split('\n')
        buffer = parts.pop() || ''
        for (const line of parts) {
          if (!line.trim()) continue
          try {
            lines.push(prettyJson(JSON.parse(line)))
          } catch {
            lines.push(line)
          }
        }
        setSampleResult(lines.join('\n\n'))
      }
      if (buffer.trim()) {
        try {
          lines.push(prettyJson(JSON.parse(buffer)))
        } catch {
          lines.push(buffer)
        }
      }
      setSampleResult(lines.join('\n\n'))
    } catch (error: any) {
      setSampleError(error?.response?.data?.detail || error?.message || '샘플 요청 실행에 실패했습니다.')
    } finally {
      setSampleRunning(false)
    }
  }

  const sampleKey = issuedKey || 'kmsadm_3f9c8e21d7b64a8f'
  const sampleCurl = `curl -X POST http://127.0.0.1:9522/api/external/search \\
  -H 'Content-Type: application/json' \\
  -H 'X-KMS-ADMIN-API-Key: ${sampleKey}' \\
  -d '{"query":"카드 인증이 실패할 때 어떻게 해야 하나요?","include_generative":true,"include_faq":true}'`

  return (
    <div className="content-inner wide fadein">
      <div className="page-head">
        <div>
          <h1>API 관리</h1>
          <p>타 시스템이 통합 검색을 호출할 수 있도록 API Key를 발급하고 고객센터·호출 제한을 관리합니다.</p>
        </div>
        <div className="sp" />
        <RelatedHelp topicIds={['HELP-EXTERNAL-001']} />
        <Button type="button" onClick={startCreate}>
          <KeyRoundIcon className="size-4" /> API Key 발급
        </Button>
      </div>

      <div className="kpis" style={{ marginBottom: 'var(--gap)' }}>
        <div className="kpi"><div className="k"><span className="ic"><KeyRoundIcon className="size-4" /></span>연동 시스템</div><div className="r"><span className="v">{clients.length}</span><span className="u">개</span></div></div>
        <div className="kpi"><div className="k"><span className="ic"><CheckCircleIcon className="size-4" /></span>활성</div><div className="r"><span className="v">{clients.filter((client) => client.is_active).length}</span><span className="u">개</span></div></div>
        <div className="kpi"><div className="k"><span className="ic"><SearchIcon className="size-4" /></span>누적 호출</div><div className="r"><span className="v">{clients.reduce((sum, client) => sum + Number(client.call_count || 0), 0).toLocaleString()}</span><span className="u">회</span></div></div>
        <div className="kpi"><div className="k"><span className="ic"><ClockIcon className="size-4" /></span>기본 제한</div><div className="r"><span className="v">120</span><span className="u">/분</span></div></div>
      </div>

      <div className="grid" style={{ gridTemplateColumns: 'minmax(0,1fr) 380px', alignItems: 'start' }}>
        <div className="col" style={{ gap: 'var(--gap)' }}>
          {clients.length ? (
            clients.map((client) => (
              <div key={client.client_id} className="card" style={{ padding: 'var(--pad-card)' }}>
                <div className="row" style={{ gap: 10 }}>
                  <div
                    style={{
                      width: 38,
                      height: 38,
                      borderRadius: 10,
                      background: 'var(--accent-soft)',
                      color: 'var(--accent)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      flexShrink: 0
                    }}
                  >
                    <LinkIcon className="size-5" />
                  </div>
                  <div className="grow" style={{ minWidth: 0 }}>
                    <div className="row" style={{ gap: 8 }}>
                      <span style={{ fontSize: 15, fontWeight: 600, color: 'var(--fg-primary)' }}>{client.display_name}</span>
                      {client.is_active ? <span className="badge green"><span className="d" />활성</span> : <span className="badge gray">비활성</span>}
                    </div>
                    <div className="mono muted" style={{ fontSize: 12, marginTop: 3 }}>
                      {client.api_key_hint} · {client.client_id}
                    </div>
                  </div>
                  <div className="row" style={{ gap: 4 }}>
                    <button className="btn btn-ghost btn-sm" type="button" title="수정" onClick={() => startEdit(client)}>
                      <EditIcon className="size-4" />
                    </button>
                    <button className="btn btn-ghost btn-sm" type="button" title="키 재발급" onClick={() => rotateKey(client.client_id)}>
                      <RefreshCwIcon className="size-4" />
                    </button>
                  </div>
                </div>
                <div className="row wrap" style={{ gap: 18, marginTop: 14, fontSize: 12.5 }}>
                  <span className="muted"><DatabaseIcon className="size-3" /> {client.tenant_name || client.tenant_id || '고객센터 미지정'}</span>
                  <span className="muted mono" style={{ fontSize: 11 }}>{client.kms_workspace} / {client.faq_workspace}</span>
                  <span className="muted"><ShieldIcon className="size-3" /> {(client.scopes || []).join(', ')}</span>
                  <span className="muted"><ClockIcon className="size-3" /> {client.rate_limit_per_minute}/분</span>
                  <span className="muted"><SearchIcon className="size-3" /> 호출 {Number(client.call_count || 0).toLocaleString()}회</span>
                  <span className="muted"><ClockIcon className="size-3" /> 최근 {shortDate(client.last_search_at || client.last_used_at)}</span>
                  <div className="grow" />
                  <Button type="button" size="sm" variant="outline" onClick={() => openClientHistory(client)}>
                    이력
                  </Button>
                  <Button type="button" size="sm" variant="outline" onClick={() => openRevealKey(client)}>
                    <KeyRoundIcon className="size-4" /> 키 확인
                  </Button>
                  <Button type="button" size="sm" variant="ghost" onClick={() => toggleActive(client)}>
                    {client.is_active ? '비활성' : '활성'}
                  </Button>
                  <Button type="button" size="sm" variant="destructive" onClick={() => revokeKey(client.client_id)}>
                    폐기
                  </Button>
                </div>
              </div>
            ))
          ) : (
            <div className="card">
              <div className="empty">등록된 연동 시스템이 없습니다.</div>
            </div>
          )}
        </div>

        <Card>
          <CardHeader>
            <div>
              <CardTitle>외부 호출 예시</CardTitle>
              <div className="sub">POST /api/external/search</div>
            </div>
          </CardHeader>
          <CardContent>
            <pre
              className="mono"
              style={{
                margin: 0,
                overflow: 'auto',
                padding: 14,
                borderRadius: 'var(--radius-md)',
                background: 'var(--c-primary)',
                color: '#e4e9f3',
                fontSize: 11.5,
                lineHeight: 1.7,
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-all'
              }}
            >
              {sampleCurl}
            </pre>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="btn-block"
              style={{ marginTop: 12 }}
              onClick={() => navigator.clipboard?.writeText(sampleCurl)}
            >
              <ClipboardIcon className="size-4" /> 복사
            </Button>
            <Button
              type="button"
              size="sm"
              className="btn-block"
              style={{ marginTop: 8 }}
              onClick={openSampleTester}
            >
              <SearchIcon className="size-4" /> 샘플 실행
            </Button>
            <div style={{ display: 'flex', gap: 9, marginTop: 12, padding: 12, background: 'var(--accent-soft)', borderRadius: 'var(--radius-md)', fontSize: 12, color: 'var(--fg-primary-soft)', lineHeight: 1.5 }}>
              <HelpCircleIcon className="size-4" style={{ color: 'var(--accent)', flexShrink: 0, marginTop: 1 }} />
              스트리밍 응답은 <b className="mono">/api/external/search/stream</b> NDJSON 엔드포인트를 사용합니다.
            </div>
            <div style={{ display: 'flex', gap: 9, marginTop: 10, padding: 12, background: 'var(--warning-soft)', borderRadius: 'var(--radius-md)', fontSize: 12, color: '#9a5b08', lineHeight: 1.55 }}>
              <ShieldIcon className="size-4" style={{ flexShrink: 0, marginTop: 1 }} />
              카테고리·유효기간·사용 여부 정책은 어드민 API에서 적용됩니다. 외부 시스템은 LightRAG를 직접 호출하지 않고 이 API를 사용해야 합니다.
            </div>
          </CardContent>
        </Card>
      </div>

      {sampleOpen && (
        <Modal
          xl
          title="외부 통합 검색 API 샘플"
          icon={SearchIcon}
          onClose={() => setSampleOpen(false)}
          footer={
            <>
              {sampleTab !== 'docs' && (
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => navigator.clipboard?.writeText(sampleTab === 'categories' ? sampleCategoryCurl : sampleRequestCurl)}
                >
                  <ClipboardIcon className="size-4" /> curl 복사
                </Button>
              )}
              <Button type="button" variant="outline" onClick={() => setSampleOpen(false)}>
                닫기
              </Button>
              {sampleTab === 'categories' && (
                <Button type="button" onClick={runSampleCategoryRequest} disabled={sampleCategoryLoading}>
                  {sampleCategoryLoading ? <RotateCwIcon className="size-4" /> : <FolderSearchIcon className="size-4" />}
                  {sampleCategoryLoading ? '조회 중' : '카테고리 조회'}
                </Button>
              )}
              {sampleTab === 'search' && (
                <Button type="button" onClick={runSampleRequest} disabled={sampleRunning}>
                  {sampleRunning ? <RotateCwIcon className="size-4" /> : <SearchIcon className="size-4" />}
                  {sampleRunning ? '실행 중' : '검색 실행'}
                </Button>
              )}
            </>
          }
        >
          <div className="col" style={{ gap: 14 }}>
            <div style={{ display: 'flex', gap: 9, padding: 12, background: 'var(--accent-soft)', borderRadius: 'var(--radius-md)', fontSize: 12, color: 'var(--fg-primary-soft)', lineHeight: 1.55 }}>
              <HelpCircleIcon className="size-4" style={{ color: 'var(--accent)', flexShrink: 0, marginTop: 1 }} />
              외부 시스템이 호출하는 API와 동일하게 API Key 헤더로 테스트합니다. 워크스페이스는 API Key에 매핑된 고객센터 기준으로 적용되며, 요청 JSON의 카테고리와 옵션만 바꿔가며 확인할 수 있습니다.
            </div>

            <div className="card" style={{ padding: 14 }}>
              <div className="grid" style={{ gridTemplateColumns: 'minmax(0,1fr) 180px', gap: 12, alignItems: 'start' }}>
                <label className="field">
                  <span>API Key</span>
                  <Input
                    value={sampleApiKey}
                    onChange={(event) => setSampleApiKey(event.target.value)}
                    placeholder="kmsadm_..."
                    autoComplete="off"
                  />
                  <span className="field-help">API 관리에서 비밀번호 재확인 후 원문 Key를 다시 확인할 수 있습니다.</span>
                </label>
                <label className="field">
                  <span>응답 방식</span>
                  <select
                    className={selectClass}
                    value={sampleEndpoint}
                    onChange={(event) => setSampleEndpoint(event.target.value as 'sync' | 'stream')}
                  >
                    <option value="sync">동기 JSON</option>
                    <option value="stream">NDJSON 스트리밍</option>
                  </select>
                </label>
              </div>
              <div className="row wrap" style={{ gap: 8, marginTop: 10 }}>
                <span className="badge gray">인증 헤더 X-KMS-ADMIN-API-Key</span>
                <span className="badge gray">카테고리 조회 GET /api/external/categories</span>
                <span className="badge blue">검색 POST /api/external/search</span>
              </div>
            </div>

            <div className="tabs" style={{ marginBottom: 0 }}>
              <button type="button" className={sampleTab === 'search' ? 'on' : ''} onClick={() => setSampleTab('search')}>
                검색 실행
              </button>
              <button type="button" className={sampleTab === 'categories' ? 'on' : ''} onClick={() => setSampleTab('categories')}>
                카테고리 조회
              </button>
              <button type="button" className={sampleTab === 'docs' ? 'on' : ''} onClick={() => setSampleTab('docs')}>
                파라미터 설명
              </button>
            </div>

            {sampleTab === 'categories' && (
            <div className="grid" style={{ gridTemplateColumns: 'minmax(0,1fr) minmax(0,1fr)', gap: 12 }}>
              <div className="card" style={{ padding: 14 }}>
                <div className="row" style={{ gap: 8, marginBottom: 8 }}>
                  <FolderIcon className="size-4" style={{ color: 'var(--accent)' }} />
                  <b>카테고리 정보 조회</b>
                  <span className="badge gray">GET /api/external/categories</span>
                </div>
                <p className="muted" style={{ margin: '0 0 10px', fontSize: 12.5, lineHeight: 1.5 }}>
                  외부 클라이언트는 이 API로 category_id, parent_id, path, 유효 지식 수를 받은 뒤 검색 요청의 category_ids에 선택한 ID를 전달합니다.
                </p>
                <pre
                  className="mono"
                  style={{
                    margin: 0,
                    maxHeight: 120,
                    overflow: 'auto',
                    padding: 10,
                    borderRadius: 'var(--radius-md)',
                    background: 'var(--bg-subtle)',
                    fontSize: 11.5,
                    whiteSpace: 'pre-wrap',
                    wordBreak: 'break-all'
                  }}
                >
                  {sampleCategoryCurl}
                </pre>
                <div className="row" style={{ gap: 8, marginTop: 10 }}>
                  <Button type="button" size="sm" variant="outline" onClick={() => navigator.clipboard?.writeText(sampleCategoryCurl)}>
                    <ClipboardIcon className="size-4" /> 복사
                  </Button>
                  <Button type="button" size="sm" onClick={runSampleCategoryRequest} disabled={sampleCategoryLoading}>
                    {sampleCategoryLoading ? <RotateCwIcon className="size-4" /> : <FolderSearchIcon className="size-4" />}
                    {sampleCategoryLoading ? '조회 중' : '카테고리 조회'}
                  </Button>
                </div>
                {sampleCategoryError && (
                  <div className="badge red" style={{ marginTop: 10, justifyContent: 'flex-start', whiteSpace: 'normal', borderRadius: 'var(--radius-md)', padding: 10 }}>
                    {sampleCategoryError}
                  </div>
                )}
                {sampleCategoryResult && (
                  <pre
                    className="mono"
                    style={{
                      margin: '10px 0 0',
                      maxHeight: 180,
                      overflow: 'auto',
                      padding: 10,
                      borderRadius: 'var(--radius-md)',
                      background: 'var(--c-primary)',
                      color: '#e4e9f3',
                      fontSize: 11.5,
                      whiteSpace: 'pre-wrap',
                      wordBreak: 'break-word'
                    }}
                  >
                    {sampleCategoryResult}
                  </pre>
                )}
              </div>

              <div className="card" style={{ padding: 14 }}>
                <div className="row" style={{ gap: 8, marginBottom: 8 }}>
                  <CalendarIcon className="size-4" style={{ color: 'var(--accent)' }} />
                  <b>유효기간 적용 방식</b>
                  <span className="badge green">서버 정책</span>
                </div>
                <div className="col" style={{ gap: 8, fontSize: 12.5, color: 'var(--fg-secondary)', lineHeight: 1.55 }}>
                  <div>검색 요청에는 valid_from, valid_until을 전달하지 않습니다.</div>
                  <div>어드민 원장에 저장된 사용 여부와 유효기간을 기준으로 서버가 후보 지식을 자동 필터링합니다.</div>
                  <div className="mono" style={{ padding: 10, borderRadius: 'var(--radius-md)', background: 'var(--bg-subtle)', color: 'var(--fg-primary)' }}>
                    enabled = true<br />
                    valid_from is null or valid_from &lt;= server_now<br />
                    valid_until is null or valid_until &gt;= server_now
                  </div>
                  <div>제외된 지식은 응답의 <b className="mono">trace.eligibility</b>에서 expired, inactive, not_started 사유로 확인할 수 있습니다.</div>
                </div>
              </div>
            </div>
            )}

            {sampleTab === 'docs' && (
            <div className="col" style={{ gap: 12 }}>
            <div className="card" style={{ padding: 14 }}>
              <div className="row" style={{ gap: 8, marginBottom: 8 }}>
                <CalendarIcon className="size-4" style={{ color: 'var(--accent)' }} />
                <b>유효기간 적용 방식</b>
                <span className="badge green">서버 정책</span>
              </div>
              <div className="col" style={{ gap: 8, fontSize: 12.5, color: 'var(--fg-secondary)', lineHeight: 1.55 }}>
                <div>검색 요청에는 valid_from, valid_until을 전달하지 않습니다.</div>
                <div>어드민 원장에 저장된 사용 여부와 유효기간을 기준으로 서버가 후보 지식을 자동 필터링합니다.</div>
                <div className="mono" style={{ padding: 10, borderRadius: 'var(--radius-md)', background: 'var(--bg-subtle)', color: 'var(--fg-primary)' }}>
                  enabled = true<br />
                  valid_from is null or valid_from &lt;= server_now<br />
                  valid_until is null or valid_until &gt;= server_now
                </div>
                <div>제외된 지식은 응답의 <b className="mono">trace.eligibility</b>에서 expired, inactive, not_started 사유로 확인할 수 있습니다.</div>
              </div>
            </div>

            <details open>
              <summary className="eyebrow" style={{ cursor: 'pointer', marginBottom: 8 }}>
                통합 검색 요청 파라미터
              </summary>
              <table className="tbl">
                <thead>
                  <tr>
                    <th style={{ width: 150 }}>필드</th>
                    <th style={{ width: 70 }}>필수</th>
                    <th style={{ width: 120 }}>타입</th>
                    <th>설명</th>
                  </tr>
                </thead>
                <tbody>
                  {externalSearchParameterDocs.map((param) => (
                    <tr key={param.name}>
                      <td className="mono" style={{ fontSize: 12 }}>{param.name}</td>
                      <td><span className={`badge ${param.required === '필수' ? 'blue' : 'gray'}`}>{param.required}</span></td>
                      <td className="mono muted" style={{ fontSize: 12 }}>{param.type}</td>
                      <td style={{ fontSize: 12.5, lineHeight: 1.45 }}>{param.description}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </details>

            <details>
              <summary className="eyebrow" style={{ cursor: 'pointer', marginBottom: 8 }}>
                응답 필드와 스트리밍 이벤트
              </summary>
              <div className="grid" style={{ gridTemplateColumns: 'minmax(0,1fr) minmax(0,1fr)', gap: 12 }}>
                <table className="tbl">
                  <tbody>
                    {externalSearchResponseDocs.map(([field, description]) => (
                      <tr key={field}>
                        <td className="mono" style={{ width: 150, fontSize: 12 }}>{field}</td>
                        <td style={{ fontSize: 12.5 }}>{description}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <div style={{ padding: 12, border: '1px solid var(--border-default)', borderRadius: 'var(--radius-md)', fontSize: 12.5, lineHeight: 1.6, color: 'var(--fg-secondary)' }}>
                  <b style={{ color: 'var(--fg-primary)' }}>NDJSON 이벤트</b>
                  <div className="mono" style={{ marginTop: 8 }}>
                    metadata<br />
                    generative_delta<br />
                    faq_results<br />
                    done<br />
                    error
                  </div>
                </div>
              </div>
            </details>
            </div>
            )}

            {sampleTab === 'search' && (
            <div className="grid" style={{ gridTemplateColumns: '260px minmax(0,1fr)', gap: 14, alignItems: 'start' }}>
              <div className="col" style={{ gap: 8 }}>
                <div className="eyebrow">샘플 프리셋</div>
                {externalSearchSamplePresets.map((preset) => (
                  <button
                    key={preset.key}
                    type="button"
                    className={`category-picker-option${samplePresetKey === preset.key ? ' on' : ''}`}
                    onClick={() => applySamplePreset(preset.key)}
                    style={{ alignItems: 'flex-start' }}
                  >
                    <SearchIcon className="size-4" style={{ marginTop: 2, flexShrink: 0 }} />
                    <span className="col" style={{ gap: 3, minWidth: 0 }}>
                      <b style={{ fontSize: 12.5, color: 'var(--fg-primary)' }}>{preset.label}</b>
                      <small style={{ color: 'var(--fg-secondary)', lineHeight: 1.35 }}>{preset.description}</small>
                    </span>
                  </button>
                ))}
              </div>

              <div className="col" style={{ gap: 12 }}>
                <label className="field">
                  <span>요청 JSON</span>
                  <Textarea
                    value={samplePayloadText}
                    onChange={(event) => setSamplePayloadText(event.target.value)}
                    rows={15}
                    className="mono"
                    spellCheck={false}
                    style={{ fontSize: 12, lineHeight: 1.55 }}
                  />
                </label>

                <div className="grid" style={{ gridTemplateColumns: 'minmax(0,1fr) minmax(0,1fr)', gap: 12 }}>
                  <div className="col" style={{ gap: 7 }}>
                    <div className="eyebrow">curl</div>
                    <pre
                      className="mono"
                      style={{
                        margin: 0,
                        minHeight: 180,
                        maxHeight: 260,
                        overflow: 'auto',
                        padding: 12,
                        borderRadius: 'var(--radius-md)',
                        background: 'var(--bg-subtle)',
                        fontSize: 11.5,
                        lineHeight: 1.6,
                        whiteSpace: 'pre-wrap',
                        wordBreak: 'break-all'
                      }}
                    >
                      {sampleRequestCurl}
                    </pre>
                  </div>
                  <div className="col" style={{ gap: 7 }}>
                    <div className="eyebrow">응답 결과</div>
                    {sampleError && (
                      <div className="badge red" style={{ justifyContent: 'flex-start', whiteSpace: 'normal', borderRadius: 'var(--radius-md)', padding: 10 }}>
                        {sampleError}
                      </div>
                    )}
                    <pre
                      className="mono"
                      style={{
                        margin: 0,
                        minHeight: 180,
                        maxHeight: 260,
                        overflow: 'auto',
                        padding: 12,
                        borderRadius: 'var(--radius-md)',
                        background: sampleResult ? 'var(--c-primary)' : 'var(--bg-subtle)',
                        color: sampleResult ? '#e4e9f3' : 'var(--fg-secondary)',
                        fontSize: 11.5,
                        lineHeight: 1.6,
                        whiteSpace: 'pre-wrap',
                        wordBreak: 'break-word'
                      }}
                    >
                      {sampleResult || '실행 결과가 여기에 표시됩니다.'}
                    </pre>
                  </div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0,1fr))', gap: 8 }}>
                  <div className="badge gray" style={{ justifyContent: 'flex-start', whiteSpace: 'normal', padding: 9 }}>
                    생성형 답변: generative_answer.response
                  </div>
                  <div className="badge gray" style={{ justifyContent: 'flex-start', whiteSpace: 'normal', padding: 9 }}>
                    FAQ 결과: faq_results[]
                  </div>
                  <div className="badge gray" style={{ justifyContent: 'flex-start', whiteSpace: 'normal', padding: 9 }}>
                    정책 내역: trace.eligibility
                  </div>
                </div>
              </div>
            </div>
            )}
          </div>
        </Modal>
      )}

      {showForm && (
        <Modal
          title={editingId ? '연동 시스템 수정' : '외부 연동 API Key 발급'}
          icon={KeyRoundIcon}
          onClose={resetExternalForm}
          footer={
            <>
              <Button type="button" variant="outline" onClick={resetExternalForm}>취소</Button>
              <Button type="submit" form="external-client-form" disabled={!form.display_name.trim()}>
                {editingId ? <SaveIcon className="size-4" /> : <KeyRoundIcon className="size-4" />}
                {editingId ? '저장' : '발급'}
              </Button>
            </>
          }
        >
          <form id="external-client-form" className="col" style={{ gap: 14 }} onSubmit={submit}>
            <label className="field">
              <span>시스템명</span>
              <Input value={form.display_name} onChange={(event) => setForm((value) => ({ ...value, display_name: event.target.value }))} required />
            </label>
            <label className="field">
              <span>고객센터</span>
              <TenantSelect value={form.tenant_id} onChange={(tenantId) => setForm((value) => ({ ...value, tenant_id: tenantId }))} required />
            </label>
            <div className="grid" style={{ gridTemplateColumns: '1fr 1fr', gap: 14 }}>
              <label className="field">
                <span>Scope</span>
                <Input value={form.scopes} onChange={(event) => setForm((value) => ({ ...value, scopes: event.target.value }))} placeholder="search" />
              </label>
              <label className="field">
                <span>분당 호출 제한</span>
                <Input type="number" value={form.rate_limit_per_minute} onChange={(event) => setForm((value) => ({ ...value, rate_limit_per_minute: event.target.value }))} />
              </label>
            </div>
            <label className="check">
              <input type="checkbox" checked={form.is_active} onChange={(event) => setForm((value) => ({ ...value, is_active: event.target.checked }))} />
              사용
            </label>
          </form>
        </Modal>
      )}

      {revealClient && (
        <Modal
          title={`API Key 확인 · ${revealClient.display_name}`}
          icon={KeyRoundIcon}
          onClose={() => setRevealClient(null)}
          footer={
            <>
              {revealedKey && (
                <Button type="button" variant="outline" onClick={() => navigator.clipboard?.writeText(revealedKey)}>
                  <ClipboardIcon className="size-4" /> 복사
                </Button>
              )}
              <Button type="button" variant="outline" onClick={() => setRevealClient(null)}>
                닫기
              </Button>
              <Button
                type="submit"
                form="api-key-reveal-form"
                disabled={!revealClient.api_key_revealable || !revealPassword.trim() || revealLoading}
              >
                {revealLoading ? <RotateCwIcon className="size-4" /> : <KeyRoundIcon className="size-4" />}
                {revealLoading ? '확인 중' : '키 확인'}
              </Button>
            </>
          }
        >
          <form id="api-key-reveal-form" className="col" style={{ gap: 14 }} onSubmit={revealKey}>
            <div style={{ display: 'flex', gap: 9, padding: 12, background: 'var(--accent-soft)', borderRadius: 'var(--radius-md)', fontSize: 12, color: 'var(--fg-primary-soft)', lineHeight: 1.55 }}>
              <ShieldIcon className="size-4" style={{ color: 'var(--accent)', flexShrink: 0, marginTop: 1 }} />
              API Key 원문 확인은 관리자 비밀번호 재확인이 필요하며, 성공/실패 이력은 감사 로그에 저장됩니다.
            </div>
            <div className="mono muted" style={{ fontSize: 12 }}>{revealClient.client_id}</div>
            <label className="field">
              <span>관리자 비밀번호</span>
              <Input
                type="password"
                value={revealPassword}
                onChange={(event) => setRevealPassword(event.target.value)}
                disabled={!revealClient.api_key_revealable}
                placeholder="현재 로그인한 관리자 비밀번호"
                autoComplete="current-password"
              />
            </label>
            {revealError && (
              <div className="badge red" style={{ justifyContent: 'flex-start', whiteSpace: 'normal', borderRadius: 'var(--radius-md)', padding: 10 }}>
                {revealError}
              </div>
            )}
            {revealedKey && (
              <div className="col" style={{ gap: 8 }}>
                <div className="eyebrow">API Key</div>
                <div className="mono" style={{ padding: 12, border: '1px solid var(--border-default)', borderRadius: 'var(--radius-md)', wordBreak: 'break-all', color: 'var(--fg-primary)' }}>
                  {revealedKey}
                </div>
              </div>
            )}
          </form>
        </Modal>
      )}

      {issuedKey && (
        <Modal title="발급된 API Key" icon={KeyRoundIcon} onClose={() => setIssuedKey('')} footer={<Button onClick={() => setIssuedKey('')}>확인</Button>}>
          <div className="col" style={{ gap: 12 }}>
            <div style={{ padding: 12, borderRadius: 'var(--radius-md)', background: 'var(--warning-soft)', color: '#9a5b08', fontSize: 12, lineHeight: 1.5 }}>
              API Key는 서버 secret으로 암호화 저장됩니다. 이후 API 관리 화면에서 관리자 비밀번호 재확인 후 다시 볼 수 있습니다.
            </div>
            <div className="mono" style={{ padding: 12, border: '1px solid var(--border-default)', borderRadius: 'var(--radius-md)', wordBreak: 'break-all', color: 'var(--fg-primary)' }}>{issuedKey}</div>
            <pre className="mono" style={{ margin: 0, overflow: 'auto', padding: 12, borderRadius: 'var(--radius-md)', background: 'var(--bg-subtle)', fontSize: 12 }}>
{`curl -X POST http://127.0.0.1:9522/api/external/search \\
  -H 'Content-Type: application/json' \\
  -H 'X-KMS-ADMIN-API-Key: ${issuedKey}' \\
  -d '{"query":"질문을 입력하세요"}'`}
            </pre>
          </div>
        </Modal>
      )}

      {historyClient && (
        <Modal lg title={`호출 이력 · ${historyClient.display_name}`} icon={ClockIcon} onClose={() => setHistoryClient(null)} footer={
          <>
            <Button type="button" variant="outline" onClick={() => downloadClientHistory(historyClient.client_id)}>
              <DownloadIcon className="size-4" /> CSV 다운로드
            </Button>
            <Button type="button" onClick={() => setHistoryClient(null)}>닫기</Button>
          </>
        }>
          {historyLoading ? (
            <div className="empty">호출 이력을 불러오는 중입니다.</div>
          ) : (
            <table className="tbl">
              <thead>
                <tr>
                  <th style={{ paddingLeft: 6 }}>시각</th>
                  <th>질문</th>
                  <th>워크스페이스</th>
                  <th>결과</th>
                  <th>지연</th>
                </tr>
              </thead>
              <tbody>
                {historyRows.map((row) => (
                  <tr key={row.search_id}>
                    <td className="num muted" style={{ paddingLeft: 6, fontSize: 12 }}>{shortDate(row.create_time)}</td>
                    <td>
                      <div className="ttl" style={{ maxWidth: 280, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{row.query}</div>
                      <div className="mono muted" style={{ fontSize: 11 }}>{row.client_trace_id || row.search_id}</div>
                    </td>
                    <td className="mono muted" style={{ fontSize: 11 }}>
                      {row.kms_workspace || '-'}<br />{row.faq_workspace || '-'}
                    </td>
                    <td>
                      <div className="row wrap" style={{ gap: 4 }}>
                        {row.include_generative && <span className="badge gray">AI</span>}
                        {row.include_faq && <span className="badge blue">FAQ</span>}
                        <span className="badge green">{Number(row.result_summary?.faq_count || 0)} FAQ</span>
                      </div>
                    </td>
                    <td className="num" style={{ textAlign: 'right', fontWeight: 700 }}>{Number(row.latency_ms || 0).toLocaleString()}ms</td>
                  </tr>
                ))}
                {!historyRows.length && (
                  <tr>
                    <td colSpan={5} className="empty">조회된 호출 이력이 없습니다.</td>
                  </tr>
                )}
              </tbody>
            </table>
          )}
        </Modal>
      )}
    </div>
  )
}

function MiniBars({
  data,
  height = 150,
  color = 'var(--accent)',
  labelEvery = 3
}: {
  data: CountRow[]
  height?: number
  color?: string
  labelEvery?: number
}) {
  const max = Math.max(...data.map((row) => row.count), 1)
  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', gap: 5, height }}>
      {data.map((row, index) => {
        const hourLabel = row.label.replace(':00', '')
        const showLabel = index % labelEvery === 0 || row.count > 0
        return (
          <div
            key={row.label}
            title={`${row.label}: ${row.count.toLocaleString()}회`}
            style={{
              flex: 1,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: 6,
              height: '100%',
              justifyContent: 'flex-end',
              minWidth: 0
            }}
          >
            <div
              style={{
                width: '100%',
                maxWidth: 24,
                minHeight: 3,
                height: `${Math.max(3, (row.count / max) * 100)}%`,
                background: row.count ? color : 'var(--bg-subtle)',
                borderRadius: '5px 5px 2px 2px',
                transition: 'height var(--dur-base) var(--ease-standard)'
              }}
            />
            <span className="num muted" style={{ fontSize: 10, height: 12, whiteSpace: 'nowrap' }}>
              {showLabel ? hourLabel : ''}
            </span>
          </div>
        )
      })}
    </div>
  )
}

function AreaChart({ data, height = 170, color = 'var(--accent)' }: { data: CountRow[]; height?: number; color?: string }) {
  const gradientId = useMemo(() => `stats-area-${Math.random().toString(36).slice(2)}`, [])
  const width = 640
  const pad = 10
  const max = Math.max(...data.map((row) => row.count), 1)
  const safeRows = data.length ? data : [{ label: '-', count: 0 }]
  const step = safeRows.length > 1 ? (width - pad * 2) / (safeRows.length - 1) : width - pad * 2
  const points = safeRows.map((row, index) => [
    safeRows.length === 1 ? width / 2 : pad + index * step,
    height - pad - (row.count / max) * (height - pad * 2 - 18)
  ])
  const line = points.map((point, index) => `${index ? 'L' : 'M'}${point[0].toFixed(1)} ${point[1].toFixed(1)}`).join(' ')
  const area = `${line} L${points[points.length - 1][0].toFixed(1)} ${height - pad} L${points[0][0].toFixed(1)} ${height - pad} Z`

  return (
    <svg viewBox={`0 0 ${width} ${height}`} style={{ width: '100%', height, display: 'block' }} preserveAspectRatio="none" aria-hidden="true">
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.18" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#${gradientId})`} />
      <path d={line} fill="none" stroke={color} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
      {points.map((point, index) => (
        <circle key={`${safeRows[index].label}-${index}`} cx={point[0]} cy={point[1]} r="3" fill="#fff" stroke={color} strokeWidth="2" />
      ))}
    </svg>
  )
}

function DonutChart({ data, size = 132 }: { data: CountRow[]; size?: number }) {
  const total = data.reduce((sum, row) => sum + row.count, 0)
  const radius = size / 2 - 12
  const center = size / 2
  const circumference = 2 * Math.PI * radius
  let offset = 0

  return (
    <svg viewBox={`0 0 ${size} ${size}`} style={{ width: size, height: size }} aria-hidden="true">
      <circle cx={center} cy={center} r={radius} fill="none" stroke="var(--bg-subtle)" strokeWidth="14" />
      {total > 0 &&
        data.map((row) => {
          const fraction = row.count / total
          const dash = `${Math.max(0, fraction * circumference - 2)} ${circumference}`
          const currentOffset = -offset
          offset += fraction * circumference
          return (
            <circle
              key={row.label}
              cx={center}
              cy={center}
              r={radius}
              fill="none"
              stroke={row.color}
              strokeWidth="14"
              strokeDasharray={dash}
              strokeDashoffset={currentOffset}
              strokeLinecap="round"
              transform={`rotate(-90 ${center} ${center})`}
            />
          )
        })}
    </svg>
  )
}

function MetricBlock({ label, value, unit }: { label: string; value: string | number; unit?: string }) {
  return (
    <div style={{ padding: 12, borderRadius: 'var(--radius-md)', background: 'var(--bg-subtle)' }}>
      <div className="eyebrow" style={{ fontSize: 10, marginBottom: 5 }}>{label}</div>
      <div className="num" style={{ fontSize: 20, lineHeight: 1.1, fontWeight: 800, color: 'var(--fg-primary)' }}>
        {value}
        {unit && <span className="u" style={{ marginLeft: 4, fontSize: 12, color: 'var(--fg-secondary)' }}>{unit}</span>}
      </div>
    </div>
  )
}

export function Stats({ active = true }: { active?: boolean }) {
  const [stats, setStats] = useState<any>(null)
  const [period, setPeriod] = useState('7d')
  const [keywordDetail, setKeywordDetail] = useState<any>(null)
  const [keywordDetailLoading, setKeywordDetailLoading] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const loadStats = async (nextPeriod = period) => {
    setLoading(true)
    setError('')
    try {
      const response = await api.get(`/api/system/stats?period=${encodeURIComponent(nextPeriod)}`)
      setStats(response.data)
    } catch (err: any) {
      setError(err?.response?.data?.detail || err?.message || '통계 정보를 불러오지 못했습니다.')
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => {
    if (!active) return
    loadStats(period)
  }, [active, period])
  const downloadStats = async () => {
    const response = await api.get(`/api/system/stats.csv?period=${encodeURIComponent(period)}`, { responseType: 'blob' })
    const url = URL.createObjectURL(new Blob([response.data], { type: 'text/csv;charset=utf-8' }))
    const link = document.createElement('a')
    link.href = url
    link.download = `kms-admin-stats-${period}.csv`
    link.click()
    URL.revokeObjectURL(url)
  }
  const openKeywordDetail = async (keyword: string) => {
    setKeywordDetailLoading(keyword)
    try {
      const response = await api.get(
        `/api/system/stats/keyword-detail?keyword=${encodeURIComponent(keyword)}&period=${encodeURIComponent(period)}`
      )
      setKeywordDetail(response.data)
    } finally {
      setKeywordDetailLoading('')
    }
  }
  const totals = stats?.totals || {}
  const categoryRows = toCountRows(stats?.by_category)
  const dateRows = toCountRows(stats?.by_date)
  const hourRows = fillHourRows(stats?.by_hour)
  const keywordRows = toCountRows(stats?.keywords)
  const actorRows = toCountRows(stats?.by_actor)
  const channelRows = toCountRows(stats?.by_channel)
  const totalCategory = categoryRows.reduce((sum, row) => sum + row.count, 0)
  const totalActor = actorRows.reduce((sum, row) => sum + row.count, 0)
  const totalChannel = channelRows.reduce((sum, row) => sum + row.count, 0)
  const periodSearches = Number(totals.period_searches || 0)
  const previousSearches = Number(totals.previous_period_searches || 0)
  const periodDelta = deltaPercent(periodSearches, previousSearches)
  const maxKeyword = Math.max(...keywordRows.map((row) => row.count), 1)
  const peakHour = hourRows.reduce((best, row) => (row.count > best.count ? row : best), hourRows[0] || { label: '-', count: 0 })
  const peakDate = dateRows.reduce((best, row) => (row.count > best.count ? row : best), dateRows[0] || { label: '-', count: 0 })
  const periodRange = stats?.period_start && stats?.period_end ? `${stats.period_start} ~ ${stats.period_end}` : compactDateRange(dateRows)
  return (
    <div className="content-inner wide fadein">
      <div className="page-head">
        <div>
          <h1>현황 · 통계</h1>
          <p>카테고리, 일자·시간대, 검색 유형, 조회 키워드 기준으로 이용 현황을 분석합니다.</p>
        </div>
        <div className="sp" />
        <RelatedHelp topicIds={['HELP-STATS-001']} />
        <span className="badge outline mono" title="통계 기준 기간">{periodRange}</span>
        <div className="seg">
          {[
            ['24h', '오늘'],
            ['7d', '7일'],
            ['30d', '30일']
          ].map(([value, label]) => (
            <button key={value} type="button" className={period === value ? 'on' : ''} onClick={() => setPeriod(value)}>
              {label}
            </button>
          ))}
        </div>
        <Button type="button" variant="outline" onClick={() => loadStats(period)} disabled={loading}>
          <RefreshCwIcon className="size-4" /> {loading ? '갱신 중' : '새로고침'}
        </Button>
        <Button type="button" variant="outline" onClick={downloadStats}>
          <DownloadIcon className="size-4" /> 내보내기
        </Button>
      </div>

      {error && <div className="empty" style={{ padding: 14, color: 'var(--danger)' }}>{error}</div>}

      <div className="kpis" style={{ marginBottom: 'var(--gap)' }}>
        {[
          {
            label: '기간 내 검색',
            value: periodSearches,
            unit: '회',
            icon: SearchIcon,
            detail: periodDelta === null ? '신규' : `${periodDelta >= 0 ? '+' : ''}${periodDelta}%`,
            direction: periodDelta === null || periodDelta >= 0 ? 'up' : 'down'
          },
          {
            label: '평균 지연',
            value: Number(totals.avg_latency_ms || 0),
            unit: 'ms',
            icon: ClockIcon,
            detail: peakDate.label === '-' ? '-' : `${peakDate.label.slice(5).replace('-', '/')} 피크`,
            direction: 'up'
          },
          { label: '지식 항목', value: Number(totals.knowledge_items || 0), unit: '건', icon: DatabaseIcon, detail: `${Number(totals.categories || 0)}개 카테고리`, direction: 'up' },
          { label: '외부 API', value: Number(totals.external_searches || 0), unit: '회', icon: KeyRoundIcon, detail: `${Number(totals.internal_searches || 0)}회 내부`, direction: 'up' }
        ].map(({ label, value, unit, icon: Icon, detail, direction }) => (
          <div key={String(label)} className="kpi">
            <div className="k"><span className="ic"><Icon className="size-4" /></span>{String(label)}</div>
            <div className="r">
              <span className="v">{Number(value).toLocaleString()}</span>
              <span className="u">{String(unit)}</span>
              <span className={`d ${direction}`}>{detail}</span>
            </div>
          </div>
        ))}
      </div>

      <div className="grid" style={{ gridTemplateColumns: '1.55fr 1fr', alignItems: 'start', marginBottom: 'var(--gap)' }}>
        <Card>
          <CardHeader>
            <div>
              <CardTitle>일자별 검색량</CardTitle>
              <div className="sub">{stats?.period_days || 0}일 기준 · 피크 {peakDate.label}</div>
            </div>
            <div className="sp" />
            <span className={`badge ${periodDelta !== null && periodDelta < 0 ? 'red' : 'green'}`}>
              {periodDelta === null ? '이전 기간 없음' : `${periodDelta >= 0 ? '+' : ''}${periodDelta}%`}
            </span>
          </CardHeader>
          <CardContent>
            <AreaChart data={dateRows} height={178} />
            <div className="row" style={{ justifyContent: 'space-between', marginTop: 8, fontSize: 11, color: 'var(--fg-secondary)' }}>
              {dateRows.map((row, index) => {
                const show = dateRows.length <= 10 || index === 0 || index === dateRows.length - 1 || index % Math.ceil(dateRows.length / 6) === 0
                return <span key={row.label} className="num" style={{ minWidth: 0 }}>{show ? row.label.slice(5) : ''}</span>
              })}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <div>
              <CardTitle>카테고리 비중</CardTitle>
              <div className="sub">지식 항목 기준</div>
            </div>
          </CardHeader>
          <CardContent>
            {categoryRows.length ? (
              <div className="row" style={{ gap: 18, alignItems: 'center' }}>
                <div style={{ position: 'relative', flexShrink: 0 }}>
                  <DonutChart data={categoryRows.slice(0, 8)} />
                  <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
                    <span className="num" style={{ fontSize: 20, fontWeight: 800, color: 'var(--fg-primary)' }}>{totalCategory.toLocaleString()}</span>
                    <span className="muted" style={{ fontSize: 11 }}>항목</span>
                  </div>
                </div>
                <div className="col grow" style={{ gap: 8 }}>
                  {categoryRows.slice(0, 8).map((row) => (
                    <div key={row.label} className="row" style={{ gap: 8, fontSize: 12.5 }}>
                      <span style={{ width: 9, height: 9, borderRadius: 3, background: row.color, flexShrink: 0 }} />
                      <span className="grow" style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{row.label}</span>
                      <span className="num muted">{ratio(row.count, totalCategory)}%</span>
                      <span className="num" style={{ fontWeight: 700, color: 'var(--fg-primary)', minWidth: 38, textAlign: 'right' }}>{row.count.toLocaleString()}</span>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <div className="empty" style={{ padding: 24 }}>카테고리 통계가 없습니다.</div>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid" style={{ gridTemplateColumns: '1fr 1fr', alignItems: 'start', marginBottom: 'var(--gap)' }}>
        <Card>
          <CardHeader>
            <div>
              <CardTitle>시간대별 분포</CardTitle>
              <div className="sub">0~23시 · 피크 {peakHour.label}</div>
            </div>
            <div className="sp" />
            <span className="badge outline">{peakHour.count.toLocaleString()}회</span>
          </CardHeader>
          <CardContent>
            <MiniBars data={hourRows} height={155} labelEvery={3} />
            <div className="grid" style={{ gridTemplateColumns: 'repeat(3, 1fr)', gap: 10, marginTop: 14 }}>
              <MetricBlock label="총 검색" value={periodSearches.toLocaleString()} unit="회" />
              <MetricBlock label="검색 발생 시간" value={hourRows.filter((row) => row.count > 0).length.toLocaleString()} unit="개" />
              <MetricBlock label="피크 시간" value={peakHour.label.replace(':00', '시')} />
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <div>
              <CardTitle>검색 구성</CardTitle>
              <div className="sub">내부/외부 호출과 답변 유형</div>
            </div>
          </CardHeader>
          <CardContent>
            <div className="grid" style={{ gridTemplateColumns: '1fr 1fr', gap: 18 }}>
              <div>
                <div className="eyebrow" style={{ marginBottom: 10 }}>호출자</div>
                <div className="col" style={{ gap: 10 }}>
                  {actorRows.map((row) => (
                    <div key={row.label} className="col" style={{ gap: 5 }}>
                      <div className="row" style={{ gap: 8, fontSize: 12.5 }}>
                        <span className="grow">{row.label}</span>
                        <span className="num" style={{ fontWeight: 700 }}>{row.count.toLocaleString()}</span>
                        <span className="num muted">{ratio(row.count, totalActor)}%</span>
                      </div>
                      <div className="bar"><i style={{ width: `${ratio(row.count, totalActor)}%`, background: row.color }} /></div>
                    </div>
                  ))}
                  {!actorRows.length && <div className="empty" style={{ padding: 20 }}>호출자 통계가 없습니다.</div>}
                </div>
              </div>
              <div>
                <div className="eyebrow" style={{ marginBottom: 10 }}>답변 유형</div>
                <div className="col" style={{ gap: 10 }}>
                  {channelRows.map((row) => (
                    <div key={row.label} className="col" style={{ gap: 5 }}>
                      <div className="row" style={{ gap: 8, fontSize: 12.5 }}>
                        <span className="grow">{row.label}</span>
                        <span className="num" style={{ fontWeight: 700 }}>{row.count.toLocaleString()}</span>
                        <span className="num muted">{ratio(row.count, totalChannel)}%</span>
                      </div>
                      <div className="bar"><i style={{ width: `${ratio(row.count, totalChannel)}%`, background: row.color }} /></div>
                    </div>
                  ))}
                  {!channelRows.length && <div className="empty" style={{ padding: 20 }}>검색 유형 통계가 없습니다.</div>}
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <div>
            <CardTitle>조회 키워드 TOP 12</CardTitle>
            <div className="sub">키워드 선택 시 검색 로그와 일자별 추이를 확인합니다.</div>
          </div>
          <div className="sp" />
          <span className="muted" style={{ fontSize: 12 }}>총 {keywordRows.length.toLocaleString()}개 키워드</span>
        </CardHeader>
        <CardContent>
          <table className="tbl">
            <thead>
              <tr>
                <th style={{ paddingLeft: 6, width: 42 }}>순위</th>
                <th>키워드</th>
                <th style={{ width: 170 }}>비중</th>
                <th style={{ width: 80, textAlign: 'right' }}>검색</th>
              </tr>
            </thead>
            <tbody>
              {keywordRows.slice(0, 12).map((row, index) => (
                <tr key={row.label}>
                  <td style={{ paddingLeft: 6 }} className="num muted">{index + 1}</td>
                  <td>
                    <button
                      type="button"
                      onClick={() => openKeywordDetail(row.label)}
                      disabled={keywordDetailLoading === row.label}
                      style={{
                        border: 0,
                        background: 'transparent',
                        padding: 0,
                        font: 'inherit',
                        fontWeight: 700,
                        color: 'var(--fg-primary)',
                        cursor: 'pointer',
                        textAlign: 'left'
                      }}
                    >
                      {keywordDetailLoading === row.label ? '조회 중...' : row.label}
                    </button>
                  </td>
                  <td><div className="bar"><i style={{ width: `${(row.count / maxKeyword) * 100}%`, background: row.color }} /></div></td>
                  <td className="num" style={{ textAlign: 'right', fontWeight: 800 }}>{row.count.toLocaleString()}</td>
                </tr>
              ))}
              {!keywordRows.length && <tr><td colSpan={4} className="empty">조회 키워드 이력이 없습니다.</td></tr>}
            </tbody>
          </table>
        </CardContent>
      </Card>
      {keywordDetail && (
        <Modal
          lg
          title="키워드 상세"
          icon={SearchIcon}
          onClose={() => setKeywordDetail(null)}
          footer={<Button onClick={() => setKeywordDetail(null)}>닫기</Button>}
        >
          <div className="row" style={{ gap: 10, marginBottom: 14 }}>
            <span className="badge outline mono">{keywordDetail.keyword}</span>
            <span className="muted">{keywordDetail.period_days}일 기준</span>
          </div>
          <div className="grid" style={{ gridTemplateColumns: 'repeat(4, 1fr)', gap: 10, marginBottom: 16 }}>
            {[
              ['검색 수', keywordDetail.summary?.count || 0],
              ['평균 지연', `${keywordDetail.summary?.avg_latency_ms || 0}ms`],
              ['생성형', keywordDetail.summary?.generative_count || 0],
              ['FAQ', keywordDetail.summary?.faq_count || 0]
            ].map(([label, value]) => (
              <MetricBlock key={String(label)} label={String(label)} value={String(value)} />
            ))}
          </div>
          <div className="grid" style={{ gridTemplateColumns: '0.8fr 1.2fr', gap: 14, alignItems: 'start' }}>
            <div>
              <div className="eyebrow" style={{ marginBottom: 8 }}>일자별</div>
              <AreaChart data={toCountRows(keywordDetail.by_date)} height={130} />
              <div className="col" style={{ gap: 7, marginTop: 8 }}>
                {(keywordDetail.by_date || []).slice(-7).map((row: any) => (
                  <div key={row.label} className="row" style={{ gap: 8, fontSize: 12.5 }}>
                    <span className="grow">{row.label}</span>
                    <span className="num" style={{ fontWeight: 700 }}>{Number(row.count || 0).toLocaleString()}</span>
                  </div>
                ))}
                {!keywordDetail.by_date?.length && <div className="empty" style={{ padding: 14 }}>일자별 이력이 없습니다.</div>}
              </div>
            </div>
            <div>
              <div className="eyebrow" style={{ marginBottom: 8 }}>최근 검색 로그</div>
              <div style={{ maxHeight: 330, overflow: 'auto', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-md)' }}>
                <table className="tbl">
                  <thead>
                    <tr>
                      <th>시간</th>
                      <th>호출자</th>
                      <th>워크스페이스</th>
                      <th>결과</th>
                      <th>지연</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(keywordDetail.logs || []).map((row: any) => (
                      <tr key={row.search_id}>
                        <td className="mono muted" style={{ fontSize: 11 }}>{shortDate(row.create_time)}</td>
                        <td>{row.actor_type === 'api_client' ? '외부' : '사용자'}<br /><span className="mono muted" style={{ fontSize: 10.5 }}>{row.actor_id || '-'}</span></td>
                        <td className="mono muted" style={{ fontSize: 10.5 }}>{row.kms_workspace}<br />{row.faq_workspace}</td>
                        <td>
                          {row.include_generative && <span className="badge green">AI</span>}
                          {row.include_faq && <span className="badge blue">FAQ</span>}
                        </td>
                        <td className="num">{Number(row.latency_ms || 0).toLocaleString()}ms</td>
                      </tr>
                    ))}
                    {!keywordDetail.logs?.length && <tr><td colSpan={5} className="empty">검색 로그가 없습니다.</td></tr>}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </Modal>
      )}
    </div>
  )
}

const emptyTenantForm = {
  name: '',
  kms_workspace: DEFAULT_KMS_WORKSPACE,
  faq_workspace: DEFAULT_FAQ_WORKSPACE,
  is_active: true,
  copy_categories_from_tenant_id: ''
}

export function Tenants() {
  const [tenants, setTenants] = useState<Tenant[]>([])
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [showCreate, setShowCreate] = useState(false)
  const [editing, setEditing] = useState<Tenant | null>(null)
  const [copyTarget, setCopyTarget] = useState<Tenant | null>(null)
  const [copySourceTenantId, setCopySourceTenantId] = useState('')
  const [form, setForm] = useState(emptyTenantForm)
  const [autoProvision, setAutoProvision] = useState(false)
  const [provisionWsId, setProvisionWsId] = useState('')
  const [provisionDone, setProvisionDone] = useState<{ name: string; kms: string; faq: string } | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<Tenant | null>(null)
  const [deleteConfirmText, setDeleteConfirmText] = useState('')
  const [deleteWithWorkspaces, setDeleteWithWorkspaces] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [diagTarget, setDiagTarget] = useState<Tenant | null>(null)
  const [diagData, setDiagData] = useState<any>(null)
  const [diagLoading, setDiagLoading] = useState(false)

  const loadTenants = async () => {
    setLoading(true)
    setError('')
    try {
      const response = await api.get('/api/tenants')
      setTenants(response.data.tenants || [])
    } catch (event: any) {
      setError(event?.response?.data?.detail || '고객센터 목록을 조회하지 못했습니다.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadTenants()
  }, [])

  const startCreate = () => {
    setForm(emptyTenantForm)
    setAutoProvision(false)
    setProvisionWsId('')
    setError('')
    setShowCreate(true)
  }

  const startEdit = (tenant: Tenant) => {
    setForm({
      name: tenant.name,
      kms_workspace: normalizeKmsWorkspace(tenant.kms_workspace),
      faq_workspace: normalizeFaqWorkspace(tenant.faq_workspace),
      is_active: tenant.is_active,
      copy_categories_from_tenant_id: ''
    })
    setError('')
    setEditing(tenant)
  }

  const createTenant = async (event: FormEvent) => {
    event.preventDefault()
    if (!form.name.trim()) return
    if (!autoProvision && (!form.kms_workspace || !form.faq_workspace)) return
    setSaving(true)
    setError('')
    try {
      if (autoProvision) {
        const wsId = provisionWsId.trim()
        const res = await api.post('/api/tenants/provision', {
          name: form.name.trim(),
          kms_workspace: wsId || undefined,
          faq_workspace: wsId ? `${wsId}_faq` : undefined,
          is_active: form.is_active,
          copy_categories_from_tenant_id: form.copy_categories_from_tenant_id || undefined
        })
        setProvisionDone({
          name: form.name.trim(),
          kms: res?.data?.kms_workspace || wsId || '(자동)',
          faq: res?.data?.faq_workspace || (wsId ? `${wsId}_faq` : '(자동)')
        })
      } else {
        await api.post('/api/tenants', {
          name: form.name.trim(),
          kms_workspace: form.kms_workspace,
          faq_workspace: form.faq_workspace,
          is_active: form.is_active,
          copy_categories_from_tenant_id: form.copy_categories_from_tenant_id || undefined
        })
      }
      setShowCreate(false)
      setForm(emptyTenantForm)
      await loadTenants()
    } catch (event: any) {
      setError(event?.response?.data?.detail || '고객센터를 생성하지 못했습니다.')
    } finally {
      setSaving(false)
    }
  }

  const updateTenant = async (event: FormEvent) => {
    event.preventDefault()
    if (!editing || !form.name.trim() || !form.kms_workspace || !form.faq_workspace) return
    setSaving(true)
    setError('')
    try {
      await api.patch(`/api/tenants/${editing.tenant_id}`, {
        name: form.name.trim(),
        kms_workspace: form.kms_workspace,
        faq_workspace: form.faq_workspace,
        is_active: form.is_active
      })
      setEditing(null)
      await loadTenants()
    } catch (event: any) {
      setError(event?.response?.data?.detail || '고객센터 정보를 수정하지 못했습니다.')
    } finally {
      setSaving(false)
    }
  }

  const copyCategories = async () => {
    if (!copyTarget || !copySourceTenantId) return
    setSaving(true)
    setError('')
    try {
      await api.post(`/api/tenants/${copyTarget.tenant_id}/categories/copy`, {
        source_tenant_id: copySourceTenantId
      })
      setCopyTarget(null)
      setCopySourceTenantId('')
      await loadTenants()
    } catch (event: any) {
      setError(event?.response?.data?.detail || '카테고리를 복사하지 못했습니다. 대상 고객센터에 이미 카테고리가 있으면 복사할 수 없습니다.')
    } finally {
      setSaving(false)
    }
  }

  const activeTenants = tenants.filter((tenant) => tenant.is_active)
  const deleteTenant = async () => {
    if (!deleteTarget) return
    setDeleting(true)
    setError('')
    try {
      await api.delete(`/api/tenants/${deleteTarget.tenant_id}`, {
        params: { delete_workspaces: deleteWithWorkspaces }
      })
      setDeleteTarget(null)
      setDeleteConfirmText('')
      setDeleteWithWorkspaces(false)
      await loadTenants()
    } catch (event: any) {
      setError(event?.response?.data?.detail || '고객센터를 삭제하지 못했습니다.')
    } finally {
      setDeleting(false)
    }
  }

  const runDiagnosis = async (tenant: Tenant) => {
    setDiagTarget(tenant)
    setDiagData(null)
    setDiagLoading(true)
    try {
      const response = await api.get(`/api/tenants/${tenant.tenant_id}/diagnosis`)
      setDiagData(response.data)
    } catch (event: any) {
      setDiagData({ error: event?.response?.data?.detail || '진단에 실패했습니다.' })
    } finally {
      setDiagLoading(false)
    }
  }

  const deleteSharedWs = deleteTarget
    ? tenants.some(
        (tenant) =>
          tenant.tenant_id !== deleteTarget.tenant_id &&
          (tenant.kms_workspace === deleteTarget.kms_workspace ||
            tenant.faq_workspace === deleteTarget.faq_workspace)
      )
    : false

  const uniquePairs = new Set(tenants.map((tenant) => `${tenant.kms_workspace}|${tenant.faq_workspace}`)).size
  const copySourceOptions = tenants.filter((tenant) => tenant.tenant_id !== copyTarget?.tenant_id)
  const formDisabled = !form.name.trim() || !form.kms_workspace || !form.faq_workspace || saving
  const createDisabled = !form.name.trim() || (!autoProvision && (!form.kms_workspace || !form.faq_workspace)) || saving

  return (
    <div className="content-inner wide fadein">
      <div className="page-head">
        <div>
          <h1>고객센터 관리</h1>
          <p>테넌트 단위로 KMS/FAQ 워크스페이스 페어와 카테고리 기준을 관리합니다.</p>
        </div>
        <div className="sp" />
        <RelatedHelp topicIds={['HELP-TENANTS-001']} />
        <Button type="button" onClick={startCreate}>
          <PlusIcon className="size-4" /> 고객센터 생성
        </Button>
      </div>

      {error && (
        <div className="card" style={{ padding: 12, marginBottom: 'var(--gap)', borderColor: '#fed7aa', color: '#9a3412' }}>
          {error}
        </div>
      )}

      <div className="kpi-grid" style={{ marginBottom: 'var(--gap)' }}>
        {[
          ['전체 고객센터', tenants.length, '개', NetworkIcon],
          ['사용 중', activeTenants.length, '개', CheckCircleIcon],
          ['워크스페이스 페어', uniquePairs, '쌍', DatabaseIcon],
          ['중지', tenants.length - activeTenants.length, '개', EyeOffIcon]
        ].map(([label, value, unit, Icon]) => (
          <div className="kpi" key={String(label)}>
            <div className="k"><span className="ic"><Icon className="size-4" /></span>{label}</div>
            <div className="r"><span className="v">{Number(value).toLocaleString()}</span><span className="u">{String(unit)}</span></div>
          </div>
        ))}
      </div>

      <Card>
        <CardHeader>
          <div>
            <CardTitle>고객센터 목록</CardTitle>
            <div className="sub">고객센터는 사용자, 카테고리, 지식, 외부 API Key의 기준 범위입니다.</div>
          </div>
          <div className="sp" />
          <Button type="button" variant="outline" onClick={loadTenants} disabled={loading}>
            <RefreshCwIcon className="size-4" /> 새로고침
          </Button>
        </CardHeader>
        <CardContent>
          <table className="tbl">
            <thead>
              <tr>
                <th style={{ paddingLeft: 6 }}>고객센터</th>
                <th>KMS 워크스페이스</th>
                <th>FAQ 워크스페이스</th>
                <th>상태</th>
                <th>생성일</th>
                <th>작업</th>
              </tr>
            </thead>
            <tbody>
              {tenants.map((tenant) => (
                <tr key={tenant.tenant_id}>
                  <td style={{ paddingLeft: 6 }}>
                    <div className="ttl">{tenant.name}</div>
                    <div className="mono muted" style={{ fontSize: 11 }}>{tenant.tenant_id}</div>
                  </td>
                  <td className="mono">
                    {tenant.kms_workspace}
                    {tenant.kms_workspace_exists === false && (
                      <span className="badge" title="LightRAG에 이 워크스페이스가 없습니다. 수정에서 다른 워크스페이스로 다시 연결하거나 고객센터를 정리하세요." style={{ marginLeft: 6, background: '#fee2e2', color: '#b91c1c' }}>없음</span>
                    )}
                  </td>
                  <td className="mono">
                    {tenant.faq_workspace}
                    {tenant.faq_workspace_exists === false && (
                      <span className="badge" title="LightRAG에 이 워크스페이스가 없습니다. 수정에서 다른 워크스페이스로 다시 연결하거나 고객센터를 정리하세요." style={{ marginLeft: 6, background: '#fee2e2', color: '#b91c1c' }}>없음</span>
                    )}
                  </td>
                  <td>
                    {tenant.is_active ? (
                      <span className="badge green"><span className="d" />사용</span>
                    ) : (
                      <span className="badge gray">중지</span>
                    )}
                  </td>
                  <td className="num muted" style={{ fontSize: 12 }}>{shortDate(tenant.create_time)}</td>
                  <td>
                    <div className="row wrap" style={{ gap: 6 }}>
                      <Button type="button" size="sm" variant="outline" onClick={() => runDiagnosis(tenant)}>
                        <ShieldIcon className="size-4" /> 진단
                      </Button>
                      <Button type="button" size="sm" variant="outline" onClick={() => startEdit(tenant)}>
                        <EditIcon className="size-4" /> 수정
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        onClick={() => {
                          setCopyTarget(tenant)
                          setCopySourceTenantId(copySourceOptions[0]?.tenant_id || '')
                          setError('')
                        }}
                      >
                        <FolderIcon className="size-4" /> 카테고리 복사
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        style={{ color: '#b91c1c' }}
                        onClick={() => {
                          setDeleteTarget(tenant)
                          setDeleteConfirmText('')
                          setDeleteWithWorkspaces(false)
                          setError('')
                        }}
                      >
                        <Trash2Icon className="size-4" /> 삭제
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
              {!tenants.length && (
                <tr>
                  <td colSpan={6} className="empty">등록된 고객센터가 없습니다.</td>
                </tr>
              )}
            </tbody>
          </table>
        </CardContent>
      </Card>

      {showCreate && (
        <Modal title="고객센터 생성" icon={NetworkIcon} onClose={() => setShowCreate(false)} footer={
          <>
            <Button type="button" variant="outline" onClick={() => setShowCreate(false)}>취소</Button>
            <Button type="submit" form="tenant-create-form" disabled={createDisabled}>
              <PlusIcon className="size-4" /> 생성
            </Button>
          </>
        }>
          <form id="tenant-create-form" className="col" style={{ gap: 14 }} onSubmit={createTenant}>
            <label className="field">
              <span>고객센터명</span>
              <Input value={form.name} onChange={(event) => setForm((value) => ({ ...value, name: event.target.value }))} placeholder="예) 전기차충전 고객센터" />
            </label>
            <label className="check">
              <input
                type="checkbox"
                checked={autoProvision}
                onChange={(event) => setAutoProvision(event.target.checked)}
              />
              신규 워크스페이스 자동 생성 (새 프로젝트)
            </label>
            {autoProvision ? (
              <label className="field">
                <span>워크스페이스 ID (영문 소문자, 비우면 자동 생성)</span>
                <Input
                  value={provisionWsId}
                  onChange={(event) => setProvisionWsId(event.target.value)}
                  placeholder="예) sugar  →  sugar / sugar_faq 워크스페이스가 만들어집니다"
                />
              </label>
            ) : (
            <div className="grid" style={{ gridTemplateColumns: '1fr 1fr', gap: 14 }}>
              <label className="field">
                <span>KMS 워크스페이스</span>
                <WorkspaceSelect
                  value={form.kms_workspace}
                  mode="kms"
                  onChange={(kmsWorkspace) => setForm((value) => ({ ...value, kms_workspace: kmsWorkspace }))}
                  required
                />
              </label>
              <label className="field">
                <span>FAQ 워크스페이스</span>
                <WorkspaceSelect
                  value={form.faq_workspace}
                  mode="answer_catalog"
                  onChange={(faqWorkspace) => setForm((value) => ({ ...value, faq_workspace: faqWorkspace }))}
                  required
                />
              </label>
            </div>
            )}
            <label className="field">
              <span>카테고리 복사</span>
              <select
                className={selectClass}
                value={form.copy_categories_from_tenant_id}
                onChange={(event) => setForm((value) => ({ ...value, copy_categories_from_tenant_id: event.target.value }))}
              >
                <option value="">복사하지 않음</option>
                {tenants.map((tenant) => (
                  <option key={tenant.tenant_id} value={tenant.tenant_id}>{tenant.name}</option>
                ))}
              </select>
            </label>
            <label className="check">
              <input
                type="checkbox"
                checked={form.is_active}
                onChange={(event) => setForm((value) => ({ ...value, is_active: event.target.checked }))}
              />
              사용
            </label>
          </form>
        </Modal>
      )}

      {editing && (
        <Modal title={`고객센터 수정 · ${editing.name}`} icon={NetworkIcon} onClose={() => setEditing(null)} footer={
          <>
            <Button type="button" variant="outline" onClick={() => setEditing(null)}>취소</Button>
            <Button type="submit" form="tenant-edit-form" disabled={formDisabled}>
              <SaveIcon className="size-4" /> 저장
            </Button>
          </>
        }>
          <form id="tenant-edit-form" className="col" style={{ gap: 14 }} onSubmit={updateTenant}>
            <div className="mono muted" style={{ fontSize: 12 }}>{editing.tenant_id}</div>
            <label className="field">
              <span>고객센터명</span>
              <Input value={form.name} onChange={(event) => setForm((value) => ({ ...value, name: event.target.value }))} />
            </label>
            <div className="grid" style={{ gridTemplateColumns: '1fr 1fr', gap: 14 }}>
              <label className="field">
                <span>KMS 워크스페이스</span>
                <WorkspaceSelect
                  value={form.kms_workspace}
                  mode="kms"
                  onChange={(kmsWorkspace) => setForm((value) => ({ ...value, kms_workspace: kmsWorkspace }))}
                  required
                />
              </label>
              <label className="field">
                <span>FAQ 워크스페이스</span>
                <WorkspaceSelect
                  value={form.faq_workspace}
                  mode="answer_catalog"
                  onChange={(faqWorkspace) => setForm((value) => ({ ...value, faq_workspace: faqWorkspace }))}
                  required
                />
              </label>
            </div>
            <label className="check">
              <input
                type="checkbox"
                checked={form.is_active}
                onChange={(event) => setForm((value) => ({ ...value, is_active: event.target.checked }))}
              />
              사용
            </label>
          </form>
        </Modal>
      )}

      {copyTarget && (
        <Modal title={`카테고리 복사 · ${copyTarget.name}`} icon={FolderIcon} onClose={() => setCopyTarget(null)} footer={
          <>
            <Button type="button" variant="outline" onClick={() => setCopyTarget(null)}>취소</Button>
            <Button type="button" onClick={copyCategories} disabled={!copySourceTenantId || saving}>
              <FolderIcon className="size-4" /> 복사
            </Button>
          </>
        }>
          <div className="col" style={{ gap: 14 }}>
            <div className="card" style={{ padding: 12, background: 'var(--bg-subtle)' }}>
              대상 고객센터에 이미 카테고리가 있으면 복사할 수 없습니다. 카테고리 템플릿은 신규 고객센터 생성 시 복사하는 흐름을 권장합니다.
            </div>
            <label className="field">
              <span>복사할 원본 고객센터</span>
              <select className={selectClass} value={copySourceTenantId} onChange={(event) => setCopySourceTenantId(event.target.value)} required>
                <option value="">고객센터 선택</option>
                {copySourceOptions.map((tenant) => (
                  <option key={tenant.tenant_id} value={tenant.tenant_id}>
                    {tenant.name} · {tenant.kms_workspace} / {tenant.faq_workspace}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </Modal>
      )}
      {diagTarget && (
        <Modal
          title={`고객센터 진단 — ${diagTarget.name}`}
          icon={ShieldIcon}
          onClose={() => setDiagTarget(null)}
          footer={
            <>
              <Button type="button" variant="outline" onClick={() => runDiagnosis(diagTarget)} disabled={diagLoading}>
                <RefreshCwIcon className="size-4" /> 다시 진단
              </Button>
              <Button type="button" onClick={() => setDiagTarget(null)}>닫기</Button>
            </>
          }
        >
          {diagLoading && <p className="muted" style={{ margin: 0 }}>진단 중... (검색 테스트 포함, 수 초 소요)</p>}
          {!diagLoading && diagData?.error && (
            <p style={{ margin: 0, color: '#b91c1c' }}>{diagData.error}</p>
          )}
          {!diagLoading && diagData && !diagData.error && (
            <div className="grid" style={{ gap: 12 }}>
              <div className="row" style={{ alignItems: 'baseline', gap: 10 }}>
                <span style={{ fontSize: 30, fontWeight: 700, color: diagData.score >= 90 ? '#15803d' : diagData.score >= 60 ? '#b45309' : '#b91c1c' }}>
                  {diagData.score}점
                </span>
                <span className="muted" style={{ fontSize: 12.5 }}>
                  {diagData.score >= 90 ? '온보딩 완료 상태입니다.' : diagData.score >= 60 ? '조치가 필요한 항목이 있습니다.' : '검색이 정상 동작하지 않을 수 있습니다.'}
                </span>
              </div>
              <div className="grid" style={{ gap: 8 }}>
                {(diagData.checks || []).map((check: any) => (
                  <div key={check.key} style={{ border: '1px solid var(--border, #e5e7eb)', borderRadius: 8, padding: '8px 12px' }}>
                    <div className="row" style={{ gap: 8, alignItems: 'center' }}>
                      <span className="badge" style={{
                        background: check.status === 'ok' ? '#dcfce7' : check.status === 'warn' ? '#fef3c7' : check.status === 'fail' ? '#fee2e2' : '#f3f4f6',
                        color: check.status === 'ok' ? '#15803d' : check.status === 'warn' ? '#b45309' : check.status === 'fail' ? '#b91c1c' : '#6b7280'
                      }}>
                        {check.status === 'ok' ? '정상' : check.status === 'warn' ? '주의' : check.status === 'fail' ? '문제' : '해당없음'}
                      </span>
                      <b style={{ fontSize: 13.5 }}>{check.title}</b>
                    </div>
                    <div className="muted" style={{ fontSize: 12.5, marginTop: 4 }}>{check.summary}</div>
                    {check.advice && (
                      <div style={{ fontSize: 12.5, marginTop: 4, color: '#b45309' }}>→ {check.advice}</div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </Modal>
      )}
      {deleteTarget && (
        <Modal
          title="고객센터 삭제"
          icon={Trash2Icon}
          onClose={() => setDeleteTarget(null)}
          footer={
            <>
              <Button type="button" variant="outline" onClick={() => setDeleteTarget(null)}>취소</Button>
              <Button
                type="button"
                disabled={deleteConfirmText !== deleteTarget.name || deleting}
                onClick={deleteTenant}
                style={{ background: '#b91c1c', color: '#fff' }}
              >
                {deleting ? '삭제 중...' : '영구 삭제'}
              </Button>
            </>
          }
        >
          <div className="grid" style={{ gap: 12 }}>
            <p style={{ margin: 0 }}>
              <b>{deleteTarget.name}</b> 고객센터를 삭제합니다. 이 작업은 되돌릴 수 없습니다.
            </p>
            <p className="mono muted" style={{ margin: 0, fontSize: 12 }}>
              KMS: {deleteTarget.kms_workspace} &nbsp;·&nbsp; FAQ: {deleteTarget.faq_workspace}
            </p>
            <label className="check" style={deleteSharedWs ? { opacity: 0.5 } : undefined}>
              <input
                type="checkbox"
                checked={deleteWithWorkspaces}
                disabled={deleteSharedWs}
                onChange={(event) => setDeleteWithWorkspaces(event.target.checked)}
              />
              워크스페이스와 지식 데이터(문서·FAQ·그래프)까지 함께 삭제
            </label>
            {deleteSharedWs && (
              <p style={{ margin: 0, fontSize: 12.5, color: '#92400e' }}>
                다른 고객센터가 같은 워크스페이스를 사용 중이라 데이터 삭제는 차단됩니다. 고객센터 연결만 삭제됩니다.
              </p>
            )}
            {deleteWithWorkspaces && !deleteSharedWs && (
              <p style={{ margin: 0, fontSize: 12.5, color: '#b91c1c' }}>
                두 워크스페이스의 모든 문서·FAQ·지식그래프가 영구 삭제됩니다.
              </p>
            )}
            <label className="field">
              <span>확인을 위해 고객센터 이름(<b>{deleteTarget.name}</b>)을 그대로 입력하세요</span>
              <Input
                value={deleteConfirmText}
                onChange={(event) => setDeleteConfirmText(event.target.value)}
                placeholder={deleteTarget.name}
              />
            </label>
            {error && <p style={{ margin: 0, color: '#b91c1c', fontSize: 12.5 }}>{error}</p>}
          </div>
        </Modal>
      )}
      {provisionDone && (
        <Modal
          title="고객센터 생성 완료 — 온보딩 다음 단계"
          icon={PlusIcon}
          onClose={() => setProvisionDone(null)}
          footer={<Button type="button" onClick={() => setProvisionDone(null)}>확인</Button>}
        >
          <div className="grid" style={{ gap: 10 }}>
            <p style={{ margin: 0 }}>
              <b>{provisionDone.name}</b> 고객센터와 워크스페이스가 생성되었습니다.
            </p>
            <p className="mono muted" style={{ margin: 0, fontSize: 12 }}>
              KMS: {provisionDone.kms} &nbsp;·&nbsp; FAQ: {provisionDone.faq}
            </p>
            <ol style={{ margin: '6px 0 0', paddingLeft: 18, lineHeight: 1.9 }}>
              <li><b>지식 등록</b> — 지식 관리에서 문서·FAQ를 등록합니다. (LightRAG에서 직접 등록해도 됩니다)</li>
              <li><b>기존 지식 연결</b> — 지식 관리 상단 [기존 지식 연결] 버튼으로 검색 대상에 편입합니다.</li>
              <li><b>공통 용어·힌트</b> — [공통 용어]에서 동의어를 등록하고, 엑셀 일괄 생성 시 LLM 힌트 보완을 켭니다.</li>
              <li><b>검색 확인</b> — 통합 검색에서 테스트 질문으로 결과를 확인합니다.</li>
            </ol>
          </div>
        </Modal>
      )}
    </div>
  )
}

export function Users() {
  const user = useAuthStore((state) => state.user)
  const selectedKmsWorkspace = useWorkspaceScopeStore((state) => state.kmsWorkspace)
  const selectedFaqWorkspace = useWorkspaceScopeStore((state) => state.faqWorkspace)
  const effectiveKmsWorkspace = normalizeKmsWorkspace(selectedKmsWorkspace || user?.kms_workspace)
  const effectiveFaqWorkspace = normalizeFaqWorkspace(selectedFaqWorkspace || user?.faq_workspace)
  const effectiveTenantId = user?.tenant_id || DEFAULT_TENANT_ID
  const [users, setUsers] = useState<User[]>([])
  const [showCreate, setShowCreate] = useState(false)
  const [creating, setCreating] = useState({
    user_id: '',
    password: '',
    display_name: '',
    role: 'user',
    tenant_id: effectiveTenantId,
    kms_workspace: effectiveKmsWorkspace,
    faq_workspace: effectiveFaqWorkspace,
    is_active: true
  })
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editing, setEditing] = useState({
    display_name: '',
    role: 'user',
    tenant_id: effectiveTenantId,
    kms_workspace: DEFAULT_KMS_WORKSPACE,
    faq_workspace: DEFAULT_FAQ_WORKSPACE,
    is_active: true
  })
  const [passwordUserId, setPasswordUserId] = useState<string | null>(null)
  const [newPassword, setNewPassword] = useState('')
  const [historyUser, setHistoryUser] = useState<User | null>(null)
  const [historyRows, setHistoryRows] = useState<AuditHistory[]>([])
  const [historyLoading, setHistoryLoading] = useState(false)

  const load = async () => {
    const response = await api.get('/api/users')
    setUsers(response.data.users || [])
  }

  useEffect(() => {
    load()
  }, [])

  const createUser = async (event: FormEvent) => {
    event.preventDefault()
    await api.post('/api/users', creating)
    setCreating({
      user_id: '',
      password: '',
      display_name: '',
      role: 'user',
      tenant_id: effectiveTenantId,
      kms_workspace: effectiveKmsWorkspace,
      faq_workspace: effectiveFaqWorkspace,
      is_active: true
    })
    setShowCreate(false)
    await load()
  }

  const startCreate = () => {
    setCreating({
      user_id: '',
      password: '',
      display_name: '',
      role: 'user',
      tenant_id: effectiveTenantId,
      kms_workspace: effectiveKmsWorkspace,
      faq_workspace: effectiveFaqWorkspace,
      is_active: true
    })
    setShowCreate(true)
  }

  const startEdit = (user: User) => {
    setEditingId(user.user_id)
    setEditing({
      display_name: user.display_name || '',
      role: normalizeUiRole(user.role),
      tenant_id: user.tenant_id || effectiveTenantId,
      kms_workspace: normalizeKmsWorkspace(user.kms_workspace),
      faq_workspace: normalizeFaqWorkspace(user.faq_workspace),
      is_active: user.is_active
    })
  }

  const updateUser = async (event: FormEvent) => {
    event.preventDefault()
    if (!editingId) {
      return
    }
    await api.patch(`/api/users/${editingId}`, editing)
    setEditingId(null)
    await load()
  }

  const updatePassword = async (event: FormEvent) => {
    event.preventDefault()
    if (!passwordUserId) {
      return
    }
    await api.post(`/api/users/${passwordUserId}/password`, { password: newPassword })
    setPasswordUserId(null)
    setNewPassword('')
  }

  const openHistory = async (user: User) => {
    setHistoryUser(user)
    setHistoryLoading(true)
    try {
      const response = await api.get(`/api/users/${user.user_id}/history`)
      setHistoryRows(response.data.history || [])
    } finally {
      setHistoryLoading(false)
    }
  }

  const downloadHistory = async (userId: string) => {
    const response = await api.get(`/api/users/${userId}/history.csv`, { responseType: 'blob' })
    const url = URL.createObjectURL(new Blob([response.data], { type: 'text/csv;charset=utf-8' }))
    const link = document.createElement('a')
    link.href = url
    link.download = `${userId}-history.csv`
    link.click()
    URL.revokeObjectURL(url)
  }

  const userSummary = useMemo(
    () => ({
      total: users.length,
      active: users.filter((item) => item.is_active).length,
      admins: users.filter((item) => item.role === 'admin').length,
      mapped: users.filter((item) => item.tenant_id).length
    }),
    [users]
  )

  const roleOptions = [
    { value: 'user', ...roleMeta('user') },
    { value: 'manager', ...roleMeta('manager') },
    { value: 'admin', ...roleMeta('admin') }
  ]
  const createPasswordFeedback = passwordRuleFeedback(creating.password)
  const creatingRole = roleMeta(creating.role)
  const editingRole = roleMeta(editing.role)
  const createDisabledReason = createUserDisabledReason({
    userId: creating.user_id,
    password: creating.password,
    tenantId: creating.tenant_id
  })
  const passwordFeedback = passwordRuleFeedback(newPassword)
  const passwordDisabledReason = newPassword.length < PASSWORD_MIN_LENGTH ? `새 비밀번호는 ${PASSWORD_MIN_LENGTH}자 이상이어야 합니다.` : ''

  return (
    <div className="content-inner wide fadein">
      <div className="page-head">
        <div>
          <h1>사용자 관리</h1>
          <p>관리자 계정으로 사용자 생성, 고객센터 매핑, 비밀번호 변경, 사용 이력 다운로드를 관리합니다.</p>
        </div>
        <div className="sp" />
        <RelatedHelp topicIds={['HELP-USERS-001']} />
        <Button type="button" onClick={startCreate}>
          <PlusIcon className="size-4" /> 사용자 생성
        </Button>
      </div>

      <div className="kpis" style={{ marginBottom: 'var(--gap)' }}>
        {[
          ['전체 계정', userSummary.total, '명', UsersIcon],
          ['활성 계정', userSummary.active, '명', CheckCircleIcon],
          ['관리자', userSummary.admins, '명', ShieldIcon],
          ['고객센터 매핑', userSummary.mapped, '건', DatabaseIcon]
        ].map(([label, value, unit, Icon]) => (
          <div key={String(label)} className="kpi">
            <div className="k"><span className="ic"><Icon className="size-4" /></span>{String(label)}</div>
            <div className="r"><span className="v">{Number(value).toLocaleString()}</span><span className="u">{String(unit)}</span></div>
          </div>
        ))}
      </div>

      <div className="row wrap" style={{ gap: 10, marginBottom: 16 }}>
        {roleOptions.map((role) => (
          <div key={role.value} className="row" style={{ gap: 8, padding: '8px 12px', background: '#fff', border: '1px solid var(--border-default)', borderRadius: 'var(--radius-md)' }}>
            <span className={`badge ${role.tone}`}>{role.label}</span>
            <span className="muted" style={{ fontSize: 12 }}>{role.description}</span>
          </div>
        ))}
      </div>

      <div className="card" style={{ padding: '16px 8px 8px' }}>
        <table className="tbl">
          <thead>
            <tr>
              <th style={{ paddingLeft: 14 }}>아이디 / 이름</th>
              <th>역할</th>
              <th>고객센터</th>
              <th>워크스페이스 페어</th>
              <th>상태</th>
              <th>최근 로그인</th>
              <th>생성일</th>
              <th>작업</th>
            </tr>
          </thead>
          <tbody>
          {users.map((user) => (
            <tr key={user.user_id}>
              <td>
                <div className="row" style={{ gap: 10 }}>
                  <span className="av" style={{ width: 30, height: 30, borderRadius: '50%', background: user.role === 'admin' ? 'var(--accent)' : 'var(--bg-subtle)', color: user.role === 'admin' ? '#fff' : 'var(--fg-secondary)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: 12, flexShrink: 0 }}>
                    {(user.display_name || user.user_id).slice(0, 1).toUpperCase()}
                  </span>
                  <div>
                    <div className="ttl">{user.display_name || user.user_id}</div>
                    <div className="muted mono" style={{ fontSize: 11 }}>{user.user_id}</div>
                  </div>
                </div>
              </td>
              <td><span className={`badge ${roleMeta(user.role).tone}`}>{roleMeta(user.role).label}</span></td>
              <td>
                <div className="ttl">{user.tenant_name || user.tenant_id || '-'}</div>
                <div className="mono muted" style={{ fontSize: 11 }}>{user.tenant_id || '-'}</div>
              </td>
              <td className="mono muted" style={{ fontSize: 11 }}>{user.kms_workspace || '-'}<br />{user.faq_workspace || '-'}</td>
              <td>{user.is_active ? <span className="badge green"><span className="d" />활성</span> : <span className="badge gray">비활성</span>}</td>
              <td className="num muted" style={{ fontSize: 12 }}>{shortDate(user.last_login_at)}</td>
              <td className="num muted" style={{ fontSize: 12 }}>{shortDate(user.create_time)}</td>
              <td>
                <div className="row wrap" style={{ gap: 4 }}>
                  <Button type="button" size="sm" variant="outline" onClick={() => startEdit(user)}>
                    <EditIcon className="size-4" /> 수정
                  </Button>
                  <Button type="button" size="sm" variant="ghost" onClick={() => setPasswordUserId(user.user_id)}>
                    <KeyRoundIcon className="size-4" /> 비밀번호
                  </Button>
                  <Button type="button" size="sm" variant="ghost" onClick={() => openHistory(user)}>
                    이력
                  </Button>
                  <Button type="button" size="sm" variant="ghost" onClick={() => downloadHistory(user.user_id)}>
                    <DownloadIcon className="size-4" /> CSV
                  </Button>
                </div>
              </td>
            </tr>
          ))}
          {!users.length && (
            <tr>
              <td colSpan={8} className="empty">등록된 사용자가 없습니다.</td>
            </tr>
          )}
          </tbody>
        </table>
      </div>

      {showCreate && (
        <Modal title="사용자 생성" icon={UsersIcon} onClose={() => setShowCreate(false)} footer={
          <>
            <div className="grow" style={{ alignSelf: 'center', fontSize: 12, color: createDisabledReason ? 'var(--warning)' : 'var(--fg-secondary)' }}>
              {createDisabledReason || '입력한 정보로 사용자 계정을 생성할 수 있습니다.'}
            </div>
            <Button type="button" variant="outline" onClick={() => setShowCreate(false)}>취소</Button>
            <Button type="submit" form="user-create-form" disabled={Boolean(createDisabledReason)} title={createDisabledReason || '사용자 계정을 생성합니다.'}>
              <PlusIcon className="size-4" /> 생성
            </Button>
          </>
        }>
          <form id="user-create-form" className="col" style={{ gap: 14 }} onSubmit={createUser}>
            <div className="grid" style={{ gridTemplateColumns: '1fr 1fr', gap: 14 }}>
              <label className="field">
                <span>아이디</span>
                <Input value={creating.user_id} onChange={(event) => setCreating((value) => ({ ...value, user_id: event.target.value }))} required />
              </label>
              <label className="field">
                <span>이름</span>
                <Input value={creating.display_name} onChange={(event) => setCreating((value) => ({ ...value, display_name: event.target.value }))} />
              </label>
            </div>
            <label className="field">
              <span>초기 비밀번호</span>
              <Input
                type="password"
                value={creating.password}
                onChange={(event) => setCreating((value) => ({ ...value, password: event.target.value }))}
                minLength={PASSWORD_MIN_LENGTH}
                aria-describedby="user-create-password-help"
                required
              />
              <div id="user-create-password-help" className="row wrap" style={{ gap: 7, fontSize: 12, lineHeight: 1.45 }}>
                <span className={`badge ${createPasswordFeedback.tone}`}>{createPasswordFeedback.valid ? '충족' : '필수'}</span>
                <span style={{ color: createPasswordFeedback.tone === 'red' ? 'var(--danger)' : 'var(--fg-secondary)' }}>
                  {createPasswordFeedback.message}
                </span>
              </div>
            </label>
            <div className="grid" style={{ gridTemplateColumns: '1fr 1fr', gap: 14 }}>
              <label className="field">
                <span>역할</span>
                <select
                  className={selectClass}
                  value={creating.role}
                  onChange={(event) => setCreating((value) => ({ ...value, role: event.target.value }))}
                  aria-describedby="user-create-role-help"
                >
                  {roleOptions.map((role) => (
                    <option key={role.value} value={role.value}>{role.label}</option>
                  ))}
                </select>
                <div id="user-create-role-help" className="row wrap" style={{ gap: 7, fontSize: 12, lineHeight: 1.45 }}>
                  <span className={`badge ${creatingRole.tone}`}>{creatingRole.label}</span>
                  <span style={{ color: 'var(--fg-secondary)' }}>{creatingRole.description}</span>
                </div>
              </label>
              <label className="check" style={{ alignSelf: 'end', minHeight: 38 }}>
                <input type="checkbox" checked={creating.is_active} onChange={(event) => setCreating((value) => ({ ...value, is_active: event.target.checked }))} />
                사용
              </label>
            </div>
            <label className="field">
              <span>고객센터</span>
              <TenantSelect value={creating.tenant_id} onChange={(tenantId) => setCreating((value) => ({ ...value, tenant_id: tenantId }))} required />
            </label>
          </form>
        </Modal>
      )}

      {editingId && (
        <Modal title={`사용자 수정 · ${editingId}`} icon={UsersIcon} onClose={() => setEditingId(null)} footer={
          <>
            <Button type="button" variant="outline" onClick={() => setEditingId(null)}>취소</Button>
            <Button type="submit" form="user-edit-form">
              <SaveIcon className="size-4" /> 저장
            </Button>
          </>
        }>
          <form id="user-edit-form" className="col" style={{ gap: 14 }} onSubmit={updateUser}>
            <label className="field">
              <span>이름</span>
              <Input value={editing.display_name} onChange={(event) => setEditing((value) => ({ ...value, display_name: event.target.value }))} />
            </label>
            <div className="grid" style={{ gridTemplateColumns: '1fr 1fr', gap: 14 }}>
              <label className="field">
                <span>역할</span>
                <select
                  className={selectClass}
                  value={editing.role}
                  onChange={(event) => setEditing((value) => ({ ...value, role: event.target.value }))}
                  aria-describedby="user-edit-role-help"
                >
                  {roleOptions.map((role) => (
                    <option key={role.value} value={role.value}>{role.label}</option>
                  ))}
                </select>
                <div id="user-edit-role-help" className="row wrap" style={{ gap: 7, fontSize: 12, lineHeight: 1.45 }}>
                  <span className={`badge ${editingRole.tone}`}>{editingRole.label}</span>
                  <span style={{ color: 'var(--fg-secondary)' }}>{editingRole.description}</span>
                </div>
              </label>
              <label className="check" style={{ alignSelf: 'end', minHeight: 38 }}>
                <input type="checkbox" checked={editing.is_active} onChange={(event) => setEditing((value) => ({ ...value, is_active: event.target.checked }))} />
                사용
              </label>
            </div>
            <label className="field">
              <span>고객센터</span>
              <TenantSelect value={editing.tenant_id} onChange={(tenantId) => setEditing((value) => ({ ...value, tenant_id: tenantId }))} required />
            </label>
          </form>
        </Modal>
      )}

      {passwordUserId && (
        <Modal title="비밀번호 변경" icon={KeyRoundIcon} onClose={() => setPasswordUserId(null)} footer={
          <>
            <div className="grow" style={{ alignSelf: 'center', fontSize: 12, color: passwordDisabledReason ? 'var(--warning)' : 'var(--fg-secondary)' }}>
              {passwordDisabledReason || '새 비밀번호로 변경할 수 있습니다.'}
            </div>
            <Button type="button" variant="outline" onClick={() => setPasswordUserId(null)}>취소</Button>
            <Button type="submit" form="password-form" disabled={Boolean(passwordDisabledReason)} title={passwordDisabledReason || '비밀번호를 변경합니다.'}>
              <KeyRoundIcon className="size-4" /> 변경
            </Button>
          </>
        }>
          <form id="password-form" className="col" style={{ gap: 14 }} onSubmit={updatePassword}>
            <div className="mono muted" style={{ fontSize: 12 }}>{passwordUserId}</div>
            <label className="field">
              <span>새 비밀번호</span>
              <Input
                type="password"
                value={newPassword}
                onChange={(event) => setNewPassword(event.target.value)}
                minLength={PASSWORD_MIN_LENGTH}
                aria-describedby="password-update-help"
                required
              />
              <div id="password-update-help" className="row wrap" style={{ gap: 7, fontSize: 12, lineHeight: 1.45 }}>
                <span className={`badge ${passwordFeedback.tone}`}>{passwordFeedback.valid ? '충족' : '필수'}</span>
                <span style={{ color: passwordFeedback.tone === 'red' ? 'var(--danger)' : 'var(--fg-secondary)' }}>
                  {passwordFeedback.message}
                </span>
              </div>
            </label>
            <div style={{ display: 'flex', gap: 9, padding: 12, background: 'var(--accent-soft)', borderRadius: 'var(--radius-md)', fontSize: 12, color: 'var(--fg-primary-soft)', lineHeight: 1.5 }}>
              <HelpCircleIcon className="size-4" style={{ color: 'var(--accent)', flexShrink: 0 }} />
              비밀번호는 서버 pepper와 함께 해시되어 저장됩니다.
            </div>
          </form>
        </Modal>
      )}

      {historyUser && (
        <Modal lg title={`사용 이력 · ${historyUser.display_name || historyUser.user_id}`} icon={ClockIcon} onClose={() => setHistoryUser(null)} footer={
          <>
            <Button type="button" variant="outline" onClick={() => downloadHistory(historyUser.user_id)}>
              <DownloadIcon className="size-4" /> CSV 다운로드
            </Button>
            <Button type="button" onClick={() => setHistoryUser(null)}>닫기</Button>
          </>
        }>
          {historyLoading ? (
            <div className="empty">이력을 불러오는 중입니다.</div>
          ) : (
            <table className="tbl">
              <thead>
                <tr>
                  <th style={{ paddingLeft: 6 }}>시각</th>
                  <th>동작</th>
                  <th>대상</th>
                  <th>Actor</th>
                </tr>
              </thead>
              <tbody>
                {historyRows.map((row) => (
                  <tr key={row.audit_id}>
                    <td className="num muted" style={{ paddingLeft: 6, fontSize: 12 }}>{shortDate(row.create_time)}</td>
                    <td><span className="badge gray">{row.action}</span></td>
                    <td style={{ color: 'var(--fg-primary)' }}>{row.target_type} · {row.target_id}</td>
                    <td className="mono muted" style={{ fontSize: 12 }}>{row.actor_id}</td>
                  </tr>
                ))}
                {!historyRows.length && (
                  <tr>
                    <td colSpan={4} className="empty">조회된 사용 이력이 없습니다.</td>
                  </tr>
                )}
              </tbody>
            </table>
          )}
        </Modal>
      )}
    </div>
  )
}

type JobDetailModalProps = {
  job: Job
  events: JobEvent[]
  eventsLoading: boolean
  onClose: () => void
}

function JobDetailModal({ job, events, eventsLoading, onClose }: JobDetailModalProps) {
  const [streamLogs, setStreamLogs] = useState<StreamLog[]>([])
  const [streaming, setStreaming] = useState(false)
  const [streamError, setStreamError] = useState('')
  const [streamAbort, setStreamAbort] = useState<AbortController | null>(null)
  const [persistStreamEvents, setPersistStreamEvents] = useState(true)
  const steps = jobPipeline(job)
  const phase = jobPhase(job, steps)
  const tone = badgeTone(job.status)
  const isTerminal = ['green', 'red', 'amber'].includes(tone)
  const metadata = jobMetadata(job)
  const tasks = Array.isArray(metadata.last_tasks) ? metadata.last_tasks : metadata.last_task ? [metadata.last_task] : []
  const track = metadata.last_track && typeof metadata.last_track === 'object' ? metadata.last_track as { documents?: unknown[] } : null
  const metadataTasks = Array.isArray(metadata.tasks) ? metadata.tasks : []
  const taskCount = [job.lightrag_task_id, ...metadataTasks.map((task: any) => task?.task_id)].filter(Boolean).length
  const logs = [...jobLogRows(job, events), ...streamLogs]
  const stage =
    tone === 'green'
      ? '모든 단계 완료'
      : tone === 'red'
        ? `${steps[phase]?.name || '처리'} 단계 확인 필요`
        : tone === 'amber'
          ? '롤백 또는 보관 처리됨'
        : steps[phase]?.live || '처리 중'

  useEffect(() => {
    return () => {
      streamAbort?.abort()
    }
  }, [streamAbort])

  const pushStreamLog = (log: StreamLog) => {
    setStreamLogs((value) => [...value.slice(-120), log])
  }

  const connectStream = async () => {
    if (streaming) {
      streamAbort?.abort()
      return
    }
    const controller = new AbortController()
    setStreamAbort(controller)
    setStreaming(true)
    setStreamError('')
    setStreamLogs([])
    try {
      const token = sessionStorage.getItem('KMS_ADMIN_TOKEN')
      const response = await fetch(`/api/jobs/${encodeURIComponent(job.job_id)}/stream?persist_events=${persistStreamEvents ? 'true' : 'false'}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        signal: controller.signal
      })
      if (!response.ok) {
        throw new Error(`stream failed: ${response.status}`)
      }
      if (!response.body) {
        throw new Error('stream body is empty')
      }
      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      while (true) {
        const { value, done } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() || ''
        for (const line of lines) {
          const trimmed = line.trim()
          if (!trimmed) continue
          const event = JSON.parse(trimmed)
          const level: StreamLog['level'] = event.event === 'error' || event.status === 'failed' ? 'ERROR' : event.status === 'cancelled' ? 'WARN' : 'INFO'
          const message =
            event.message ||
            (event.event === 'task_start' ? `task ${event.task_id} stream started` : '') ||
            (event.event === 'task_end' ? `task ${event.task_id} stream ended` : '') ||
            event.event ||
            'stream event'
          pushStreamLog({
            time: shortDate(new Date().toISOString()),
            level,
            message: `${event.task_id || job.lightrag_task_id || job.job_id} · ${event.progress ?? '-'}% · ${message}`
          })
        }
      }
    } catch (error) {
      if ((error as Error).name !== 'AbortError') {
        setStreamError(apiErrorMessage(error, '실시간 스트림 연결 중 오류가 발생했습니다.'))
      }
    } finally {
      setStreaming(false)
      setStreamAbort(null)
    }
  }

  return (
    <Modal lg title="지식화 작업" icon={ClipboardIcon} onClose={onClose} footer={<Button onClick={onClose}>닫기</Button>}>
      <div className="row" style={{ gap: 11, marginBottom: 14 }}>
        <div style={{ width: 36, height: 36, borderRadius: 9, background: 'var(--bg-subtle)', color: 'var(--fg-secondary)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
          <FileTextIcon className="size-5" />
        </div>
        <div className="grow" style={{ minWidth: 0 }}>
          <div style={{ fontSize: 14.5, fontWeight: 600, color: 'var(--fg-primary)' }}>{job.knowledge_title || job.job_type || job.job_id}</div>
          <div className="muted mono" style={{ fontSize: 11.5, marginTop: 1 }}>{job.job_id} · {job.job_type || '-'} · {shortDate(job.update_time)}</div>
        </div>
        <StatusBadge status={job.status} />
      </div>

      <div className="grid" style={{ gridTemplateColumns: 'repeat(4,1fr)', gap: 8, marginBottom: 14 }}>
        {[
          ['Task', job.lightrag_task_id || `${tasks.length} tasks`],
          ['진행률', `${Number(job.progress || 0).toFixed(0)}%`],
          ['문서 refs', Array.isArray(track?.documents) ? String(track.documents.length) : '-'],
          ['Rollback', job.rollback_status || '없음']
        ].map(([label, value]) => (
          <div key={label} style={{ padding: '9px 11px', borderRadius: 'var(--radius-md)', background: 'var(--bg-subtle)' }}>
            <div className="eyebrow" style={{ fontSize: 9.5, marginBottom: 3 }}>{label}</div>
            <div className="mono" style={{ fontSize: 13, fontWeight: 700, color: 'var(--fg-primary)', wordBreak: 'break-all' }}>{value}</div>
          </div>
        ))}
      </div>

      <div className="row" style={{ gap: 8, marginBottom: 7 }}>
        <span style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--fg-primary)' }}>{stage}</span>
        <div className="grow" />
        <span className="num" style={{ fontSize: 13, fontWeight: 700, color: tone === 'red' ? 'var(--danger)' : tone === 'amber' ? 'var(--warning)' : 'var(--accent)' }}>{Number(job.progress || 0).toFixed(0)}%</span>
      </div>
      <div className={`bar ${tone === 'green' ? 'green' : tone === 'red' ? 'red' : tone === 'amber' ? 'amber' : ''}`} style={{ height: 8, marginBottom: 16 }}>
        <i style={{ width: `${Math.min(100, Number(job.progress || 0))}%` }} />
      </div>

      <div className="grid" style={{ gridTemplateColumns: '1fr 1fr', gap: 14, alignItems: 'start' }}>
        <div>
          <div className="eyebrow" style={{ marginBottom: 8 }}>처리 단계</div>
          <div className="col" style={{ gap: 2 }}>
            {steps.map((step, index) => {
              const done = index < phase || (isTerminal && tone === 'green')
              const active = !isTerminal && index === phase
              const failed = tone === 'red' && index === phase
              const muted = tone === 'amber' && index >= phase
              return (
                <div key={step.name} className="row" style={{ gap: 9, padding: '7px 9px', borderRadius: 'var(--radius-sm)', background: active ? 'var(--accent-soft)' : 'transparent', alignItems: 'flex-start' }}>
                  <span style={{ width: 19, height: 19, borderRadius: '50%', marginTop: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, background: failed ? 'var(--danger)' : done ? 'var(--success)' : active ? 'var(--accent)' : 'var(--bg-subtle)', color: (done || active || failed) ? '#fff' : 'var(--fg-muted)' }}>
                    {failed ? <XIcon className="size-3" /> : done ? <CheckCircleIcon className="size-3" /> : active ? <RefreshCwIcon className="spin size-3" /> : <span style={{ fontSize: 10, fontWeight: 700 }}>{index + 1}</span>}
                  </span>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 12.5, fontWeight: active ? 600 : 500, color: done || active ? 'var(--fg-primary)' : muted ? 'var(--fg-muted)' : 'var(--fg-secondary)' }}>{step.name}</div>
                    <div style={{ fontSize: 11, marginTop: 1, color: failed ? 'var(--danger)' : active ? 'var(--accent)' : done ? 'var(--fg-secondary)' : 'var(--fg-muted)' }}>
                      {failed ? job.message || '오류 발생' : active ? step.live : done ? step.done : muted ? '롤백됨' : '대기'}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        </div>

        <div>
          <div className="row" style={{ gap: 8, marginBottom: 8 }}>
            <div className="eyebrow">실시간 로그</div>
            <div className="grow" />
            <label className="check" style={{ fontSize: 11.5 }}>
              <input
                type="checkbox"
                checked={persistStreamEvents}
                onChange={(event) => setPersistStreamEvents(event.target.checked)}
                disabled={streaming}
              />
              DB 저장
            </label>
            <Button type="button" size="sm" variant="ghost" onClick={connectStream} disabled={!taskCount && !job.lightrag_task_id}>
              <RefreshCwIcon className={streaming ? 'spin size-4' : 'size-4'} /> {streaming ? '중지' : '스트림'}
            </Button>
          </div>
          <div style={{ background: 'var(--c-primary)', borderRadius: 'var(--radius-md)', padding: '11px 12px', fontFamily: 'var(--font-mono)', fontSize: 11, lineHeight: 1.85, maxHeight: 218, overflow: 'auto' }}>
            {eventsLoading ? (
              <div style={{ color: '#cdd6e6' }}>이벤트를 불러오는 중입니다.</div>
            ) : logs.length ? (
              logs.map((log, index) => (
                <div key={`${log.time}-${index}`} style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  <span style={{ color: '#7a8ba0' }}>{log.time}</span>{' '}
                  <span style={{ color: log.level === 'ERROR' ? '#e06b6b' : log.level === 'WARN' ? '#e0894a' : '#5fd08a' }}>{log.level}</span>{' '}
                  <span style={{ color: '#cdd6e6' }}>{log.message}</span>
                </div>
              ))
            ) : (
              <div style={{ color: '#cdd6e6' }}>기록된 이벤트가 없습니다.</div>
            )}
          </div>
          {streamError && (
            <div className="badge red" style={{ marginTop: 8, justifyContent: 'flex-start', whiteSpace: 'normal', borderRadius: 'var(--radius-md)', padding: 8 }}>
              {streamError}
            </div>
          )}
        </div>
      </div>

      {(tone === 'amber' || job.rollback_status) && (
        <div style={{ display: 'flex', gap: 10, marginTop: 14, padding: 12, borderRadius: 'var(--radius-md)', background: 'var(--warning-soft)', border: '1px solid #f1ddb8' }}>
          <RotateCwIcon className="size-4" style={{ color: 'var(--warning)', flexShrink: 0, marginTop: 1 }} />
          <div style={{ fontSize: 12, color: '#9a5b08', lineHeight: 1.55 }}>
            <b>롤백 상태</b> — LightRAG 생성물 정리 결과와 어드민 원장 ref 제거 여부를 함께 추적합니다. 부분 실패 시 오류 정보가 로그에 남습니다.
          </div>
        </div>
      )}
    </Modal>
  )
}

export function Jobs() {
  const [jobs, setJobs] = useState<Job[]>([])
  const [selectedJob, setSelectedJob] = useState<Job | null>(null)
  const [jobEvents, setJobEvents] = useState<JobEvent[]>([])
  const [eventsLoading, setEventsLoading] = useState(false)
  const [syncingJobId, setSyncingJobId] = useState<string | null>(null)
  const [syncingAll, setSyncingAll] = useState(false)
  const [cancellingJobId, setCancellingJobId] = useState<string | null>(null)
  const [rollingBackJobId, setRollingBackJobId] = useState<string | null>(null)

  const load = async () => {
    const response = await api.get('/api/jobs')
    setJobs(response.data.jobs || [])
  }

  useEffect(() => {
    load()
  }, [])

  const syncAll = async () => {
    setSyncingAll(true)
    try {
      await api.post('/api/jobs/sync-running')
      await load()
    } finally {
      setSyncingAll(false)
    }
  }

  const syncOne = async (job: Job) => {
    setSyncingJobId(job.job_id)
    try {
      await api.post(`/api/jobs/${job.job_id}/sync`)
      await load()
    } finally {
      setSyncingJobId(null)
    }
  }

  const cancelOne = async (job: Job) => {
    if (!window.confirm(`${job.knowledge_title || job.job_type || job.job_id} 작업을 중단하고 롤백을 요청하시겠습니까?`)) {
      return
    }
    setCancellingJobId(job.job_id)
    try {
      await api.post(`/api/jobs/${job.job_id}/cancel`)
      await load()
    } finally {
      setCancellingJobId(null)
    }
  }

  const rollbackOne = async (job: Job) => {
    if (!window.confirm(`${job.knowledge_title || job.job_type || job.job_id} 작업의 생성물을 정리하고 롤백하시겠습니까?`)) {
      return
    }
    setRollingBackJobId(job.job_id)
    try {
      await api.post(`/api/jobs/${job.job_id}/rollback`)
      await load()
    } finally {
      setRollingBackJobId(null)
    }
  }

  const openEvents = async (job: Job) => {
    setSelectedJob(job)
    setEventsLoading(true)
    try {
      const response = await api.get(`/api/jobs/${job.job_id}/events`)
      setJobEvents(response.data.events || [])
    } finally {
      setEventsLoading(false)
    }
  }

  const runningCount = jobs.filter(isRunningJob).length
  const failedCount = jobs.filter((job) => ['failed', 'error', 'cancelled'].includes(String(job.status).toLowerCase())).length
  const completedCount = jobs.filter((job) => ['success', 'completed', 'ready', 'processed'].includes(String(job.status).toLowerCase())).length

  return (
    <div className="content-inner wide fadein">
      <div className="page-head">
        <div>
          <h1>작업 이력</h1>
          <p>지식화, 재지식화, 롤백 작업의 진행 상태와 메시지를 추적합니다.</p>
        </div>
        <div className="sp" />
        <RelatedHelp topicIds={['HELP-JOBS-001']} />
        <Button type="button" variant="outline" onClick={syncAll} disabled={syncingAll}>
          <RefreshCwIcon className={syncingAll ? 'spin size-4' : 'size-4'} /> 진행 작업 동기화
        </Button>
      </div>

      <div className="kpis" style={{ marginBottom: 'var(--gap)' }}>
        <div className="kpi"><div className="k"><span className="ic"><ClipboardIcon className="size-4" /></span>전체 작업</div><div className="r"><span className="v">{jobs.length}</span><span className="u">건</span></div></div>
        <div className="kpi"><div className="k"><span className="ic"><RefreshCwIcon className="size-4" /></span>진행 중</div><div className="r"><span className="v">{runningCount}</span><span className="u">건</span></div></div>
        <div className="kpi"><div className="k"><span className="ic"><CheckCircleIcon className="size-4" /></span>완료</div><div className="r"><span className="v">{completedCount}</span><span className="u">건</span></div></div>
        <div className="kpi"><div className="k"><span className="ic"><HelpCircleIcon className="size-4" /></span>실패·중단</div><div className="r"><span className="v">{failedCount}</span><span className="u">건</span></div></div>
      </div>

      <div className="card" style={{ padding: '16px 8px 8px' }}>
        <table className="tbl">
          <thead>
            <tr>
              <th style={{ paddingLeft: 14 }}>작업</th>
              <th>유형</th>
              <th>상태</th>
              <th>진행률</th>
              <th>Rollback</th>
              <th>Task ID</th>
              <th>수정일</th>
              <th>작업</th>
            </tr>
          </thead>
          <tbody>
            {jobs.map((job) => {
              const canCancel = isRunningJob(job) && Boolean(job.lightrag_task_id)
              const canRollback = !canCancel && job.rollback_status !== 'completed'
              return (
                <tr key={job.job_id}>
                  <td>
                    <div className="ttl">{job.knowledge_title || job.job_type || '작업'}</div>
                    <div className="mono muted" style={{ fontSize: 11 }}>{job.job_id}</div>
                    {job.message && <div className="muted" style={{ marginTop: 4, maxWidth: 460, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 12 }}>{job.message}</div>}
                  </td>
                  <td><span className="badge gray">{job.knowledge_type || job.job_type || '-'}</span></td>
                  <td><StatusBadge status={job.status} /></td>
                  <td style={{ minWidth: 150 }}>
                    <div className={`bar ${badgeTone(job.status) === 'green' ? 'green' : badgeTone(job.status) === 'red' ? 'red' : ''}`}><i style={{ width: `${Math.min(100, Number(job.progress || 0))}%` }} /></div>
                    <div className="num muted" style={{ marginTop: 4, fontSize: 11.5 }}>{Number(job.progress || 0).toFixed(0)}%</div>
                  </td>
                  <td><span className={`badge ${job.rollback_status ? 'amber' : 'gray'}`}>{job.rollback_status || '없음'}</span></td>
                  <td className="mono muted" style={{ fontSize: 11 }}>{job.lightrag_task_id || '-'}</td>
                  <td className="num muted" style={{ fontSize: 12 }}>{shortDate(job.update_time)}</td>
                  <td>
                    <div className="row wrap" style={{ gap: 4 }}>
                      <Button type="button" size="sm" variant="outline" onClick={() => openEvents(job)}>
                        상세
                      </Button>
                      <Button type="button" size="sm" variant="ghost" onClick={() => syncOne(job)} disabled={syncingJobId === job.job_id}>
                        <RefreshCwIcon className={syncingJobId === job.job_id ? 'spin size-4' : 'size-4'} /> 동기화
                      </Button>
                      {canCancel && (
                        <Button type="button" size="sm" variant="destructive" onClick={() => cancelOne(job)} disabled={cancellingJobId === job.job_id}>
                          중단
                        </Button>
                      )}
                      {canRollback && (
                        <Button type="button" size="sm" variant="destructive" onClick={() => rollbackOne(job)} disabled={rollingBackJobId === job.job_id}>
                          롤백
                        </Button>
                      )}
                    </div>
                  </td>
                </tr>
              )
            })}
            {!jobs.length && (
              <tr>
                <td colSpan={8} className="empty">조회된 작업 이력이 없습니다.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {selectedJob && (
        <JobDetailModal
          job={selectedJob}
          events={jobEvents}
          eventsLoading={eventsLoading}
          onClose={() => setSelectedJob(null)}
        />
      )}
    </div>
  )
}

export function SystemStatus() {
  const [health, setHealth] = useState<any>(null)
  const [workspaceMode, setWorkspaceMode] = useState<WorkspaceMode | 'all'>('all')
  const [workspaceSearch, setWorkspaceSearch] = useState('')
  const [workspaces, setWorkspaces] = useState<Workspace[]>([])
  useEffect(() => {
    api.get('/api/system/health').then((response) => setHealth(response.data))
  }, [])

  useEffect(() => {
    const params = new URLSearchParams({ page_size: '100' })
    if (workspaceMode !== 'all') {
      params.set('workspace_mode', workspaceMode)
    }
    if (workspaceSearch.trim()) {
      params.set('search', workspaceSearch.trim())
    }
    api.get(`/api/lightrag/workspaces?${params.toString()}`).then((response) => {
      setWorkspaces(response.data.workspaces || [])
    })
  }, [workspaceMode, workspaceSearch])

  const serviceRows = [
    {
      label: '어드민 API',
      value: health?.status === 'ok' ? '정상' : '확인 필요',
      detail: `FastAPI · :9522 · ${Number(health?.latency_ms || 0)}ms`,
      tone: health?.status === 'ok' ? 'green' : 'amber'
    },
    {
      label: 'LightRAG 연동',
      value: health?.lightrag?.status || '확인 중',
      detail: `:9422 · ${health?.lightrag?.webui_title || 'LightRAG'} · API ${health?.lightrag?.api_version || '-'}`,
      tone: health?.lightrag?.status === 'healthy' ? 'green' : 'amber'
    },
    {
      label: '어드민 DB',
      value: health?.database?.ok ? '정상' : '확인 필요',
      detail: health?.database?.url || 'DB 연결 확인 중',
      tone: health?.database?.ok ? 'green' : 'red'
    },
    {
      label: 'LightRAG Core',
      value: health?.lightrag?.pipeline_busy ? '작업 중' : '대기',
      detail: `core ${health?.lightrag?.core_version || '-'} · ${health?.lightrag?.configuration?.graph_storage || 'graph'} / ${health?.lightrag?.configuration?.vector_storage || 'vector'}`,
      tone: health?.lightrag?.pipeline_busy ? 'amber' : 'green'
    }
  ]
  const workspaceModeSummary = [
    { label: '전체', count: workspaces.length },
    { label: 'KMS', count: workspaces.filter((workspace) => workspace.workspace_mode === 'kms').length },
    { label: 'FAQ', count: workspaces.filter((workspace) => workspace.workspace_mode === 'answer_catalog').length },
    { label: '작업 중', count: workspaces.filter((workspace) => workspace.is_busy).length }
  ]

  return (
    <div className="content-inner wide fadein">
      <div className="page-head">
        <div>
          <h1>시스템</h1>
          <p>웹서버·LightRAG 연동·DB·워크스페이스 상태를 확인합니다. LightRAG 포트 + 100 기준으로 구동됩니다.</p>
        </div>
        <div className="sp" />
        <RelatedHelp topicIds={['HELP-SYSTEM-001']} />
        <Button type="button" variant="outline" onClick={() => api.get('/api/system/health').then((response) => setHealth(response.data))}>
          <RefreshCwIcon className="size-4" /> 새로고침
        </Button>
      </div>

      <div
        className="grid"
        style={{
          gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 420px), 1fr))',
          alignItems: 'start',
          marginBottom: 'var(--gap)'
        }}
      >
        <Card style={{ minWidth: 0 }}>
          <CardHeader>
            <CardTitle>서비스 상태</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="col" style={{ gap: 0 }}>
              {serviceRows.map((row, index) => (
                <div key={row.label} className="row" style={{ gap: 10, padding: '13px 2px', borderBottom: index < serviceRows.length - 1 ? '1px solid var(--border-subtle)' : 0 }}>
                  <span style={{ width: 8, height: 8, borderRadius: '50%', background: row.tone === 'green' ? 'var(--success)' : row.tone === 'red' ? 'var(--destructive)' : 'var(--warning)', flexShrink: 0 }} />
                  <div className="grow" style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--fg-primary)' }}>{row.label}</div>
                    <div className="muted mono" style={{ fontSize: 11.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{row.detail}</div>
                  </div>
                  <span className={`badge ${row.tone}`}><span className="d" />{row.value}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card style={{ minWidth: 0, overflow: 'hidden' }}>
          <CardHeader>
            <div>
              <CardTitle>워크스페이스 조회</CardTitle>
              <div className="sub">mode 조건과 검색어 기준으로 LightRAG 워크스페이스를 조회합니다.</div>
            </div>
            <div className="sp" />
            <span className="badge blue">{workspaces.length}개</span>
          </CardHeader>
          <CardContent>
            <div className="grid" style={{ gridTemplateColumns: 'minmax(140px, 180px) minmax(0, 1fr)', gap: 10, marginBottom: 12 }}>
              <select
                className={selectClass}
                value={workspaceMode}
                onChange={(event) => setWorkspaceMode(event.target.value as WorkspaceMode | 'all')}
              >
                <option value="all">전체 mode</option>
                <option value="kms">KMS</option>
                <option value="answer_catalog">FAQ</option>
                <option value="hybrid">통합</option>
              </select>
              <Input
                value={workspaceSearch}
                onChange={(event) => setWorkspaceSearch(event.target.value)}
                placeholder="워크스페이스명 또는 ID 검색"
              />
            </div>
            <div className="row wrap" style={{ gap: 6, marginBottom: 12 }}>
              {workspaceModeSummary.map((item) => (
                <span key={item.label} className="badge outline">
                  {item.label} <span className="num">{item.count.toLocaleString()}</span>
                </span>
              ))}
            </div>
            <div
              className="workspace-scroll"
              style={{
                maxHeight: 'min(44vh, 430px)',
                overflowY: 'auto',
                border: '1px solid var(--border-subtle)',
                borderRadius: 'var(--radius-md)',
                background: '#fff'
              }}
            >
              {workspaces.map((workspace, index) => (
                <div
                  key={workspace.workspace_id}
                  className="row"
                  style={{
                    gap: 12,
                    alignItems: 'flex-start',
                    padding: '12px 12px',
                    borderBottom: index < workspaces.length - 1 ? '1px solid var(--border-subtle)' : 0
                  }}
                >
                  <div className="grow" style={{ minWidth: 0 }}>
                    <div className="ttl" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {workspace.name || workspace.workspace_id}
                    </div>
                    <div className="mono muted" style={{ fontSize: 11, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {workspace.workspace_id}
                    </div>
                  </div>
                  <div className="row wrap" style={{ gap: 6, justifyContent: 'flex-end', flexShrink: 0, maxWidth: '52%' }}>
                    <span className="badge gray">{modeLabel(workspace.workspace_mode)}</span>
                    <span className="badge outline">문서 {Number(workspace.document_count || 0).toLocaleString()}</span>
                    <span className="badge outline">엔티티 {Number(workspace.entity_count || 0).toLocaleString()}</span>
                    {workspace.is_busy ? (
                      <span className="badge amber"><span className="d" />작업 중</span>
                    ) : (
                      <span className="badge green"><span className="d" />대기</span>
                    )}
                  </div>
                </div>
              ))}
              {!workspaces.length && (
                <div className="empty" style={{ padding: 24 }}>
                  조회된 워크스페이스가 없습니다.
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <div>
            <CardTitle>로그</CardTitle>
            <div className="sub">일 단위 파일 분할 · 주요 행위 DB 동시 기록</div>
          </div>
        </CardHeader>
        <CardContent>
          <div style={{ background: 'var(--c-primary)', borderRadius: 'var(--radius-md)', padding: 14, fontSize: 11.5, fontFamily: 'var(--font-mono)', lineHeight: 1.85, color: '#9fb0c9', maxHeight: 180, overflow: 'auto' }}>
            <div><span style={{ color: '#7a8ba0' }}>health</span> <span style={{ color: '#5fd08a' }}>INFO</span> admin={health?.status || 'loading'} lightrag={health?.lightrag?.status || 'loading'}</div>
            <div><span style={{ color: '#7a8ba0' }}>storage</span> <span style={{ color: '#5fd08a' }}>INFO</span> {health?.lightrag?.configuration?.kv_storage || '-'} · {health?.lightrag?.configuration?.doc_status_storage || '-'}</div>
            <div><span style={{ color: '#7a8ba0' }}>retrieval</span> <span style={{ color: '#5fd08a' }}>INFO</span> rerank={String(health?.lightrag?.configuration?.enable_rerank ?? '-')} · model={health?.lightrag?.configuration?.rerank_model || '-'}</div>
            <div><span style={{ color: '#7a8ba0' }}>logs</span> <span style={{ color: '#5fd08a' }}>INFO</span> kms-admin.log · kms-admin.log.{new Date().toISOString().slice(0, 10)}</div>
          </div>
          <div className="row wrap" style={{ gap: 8, marginTop: 12 }}>
            <span className="badge gray">kms-admin.log</span>
            <span className="badge gray">kms-admin.log.{new Date().toISOString().slice(0, 10)}</span>
            <span className="badge gray">DB audit/search logs</span>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

import { type FormEvent, type ReactNode, useEffect, useState } from 'react'
import {
  CheckCircleIcon,
  DatabaseIcon,
  FileSpreadsheetIcon,
  PlusIcon,
  RefreshCwIcon,
  SparklesIcon,
  UploadIcon,
  XIcon
} from 'lucide-react'

import { api } from '@/api/client'
import Button from '@/components/ui/Button'
import Input from '@/components/ui/Input'
import { selectClass } from '@/lib/form'

type CategoryOption = {
  category_id: string
  name: string
  path: string
}

type StructuredProfile = {
  source_type: 'csv' | 'json'
  kind: string
  row_count: number
  columns: string[]
  fields: Array<{
    name: string
    inferred_type: string
    null_count: number
    distinct_count: number
    semantic_role: string
    confidence: number
  }>
  sample_rows: Array<Record<string, unknown>>
  mapping_suggestions: Record<string, string | null>
  warnings: string[]
}

type ExcelPreview = {
  file_name: string
  file_size: number
  sheets: Array<{ name: string; max_row: number; max_column: number }>
  selected_sheet: string
  header_row: number
  data_start_row: number
  row_count: number
  row_limit: number
  truncated: boolean
  columns: string[]
  raw_content: string
  source_uri: string
  profile: StructuredProfile
  warnings: string[]
}

type Connector = {
  connector_id: string
  name: string
  connector_type: string
  status: string
  config: Record<string, unknown>
  auth_ref?: string | null
  enabled: boolean
}

type ConnectorPreview = {
  connector: Connector
  sample: {
    source_type: 'csv' | 'json'
    raw_content: string
    rows: Array<Record<string, unknown>>
    columns: string[]
    row_count: number
    truncated: boolean
    warnings: string[]
  }
  profile: StructuredProfile
  mapping: Record<string, string>
  guidance_columns: string[]
  validation: {
    ready: boolean
    warnings: string[]
  }
}

type FaqBulkCreateProps = {
  tenantId: string
  workspace: string
  categories: CategoryOption[]
  onClose: () => void
  onCreated: () => Promise<void> | void
}

const mappingRoles = [
  ['id', '원본 ID', '업무 코드나 원본 행을 식별하는 값'],
  ['title', 'FAQ 제목', '목록과 검색 결과에 표시할 제목'],
  ['question', '대표 질문', '사용자가 실제로 물을 법한 질문'],
  ['body', '답변 본문', '사용자에게 제공할 최종 답변'],
  ['summary', '요약', '짧은 승인 요약이나 콜봇용 답변'],
  ['category', '분류', '행별 태그와 분류에 사용할 값'],
  ['status', '상태', 'draft, published 등의 행별 상태'],
  ['valid_from', '유효 시작일', 'FAQ 사용 시작일'],
  ['valid_until', '유효 종료일', 'FAQ 사용 종료일']
] as const

function errorMessage(error: unknown, fallback: string) {
  const value = error as any
  const detail = value?.response?.data?.detail
  if (typeof detail === 'string') return detail
  if (detail && typeof detail === 'object') return JSON.stringify(detail)
  return value?.message || fallback
}

function splitTags(value: string) {
  return Array.from(new Set(value.split(/[\n,]/).map((item) => item.trim()).filter(Boolean)))
}

function ToolModal({
  title,
  onClose,
  children
}: {
  title: string
  onClose: () => void
  children: ReactNode
}) {
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose])

  return (
    <div className="overlay" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div
        className="modal xl"
        style={{ maxWidth: 'min(1420px, calc(100vw - 28px))', height: 'min(920px, calc(100vh - 28px))' }}
      >
        <div className="modal-h">
          <FileSpreadsheetIcon className="size-5" style={{ color: 'var(--accent)' }} />
          <span className="t">{title}</span>
          <button className="x" type="button" onClick={onClose} aria-label="닫기">
            <XIcon className="size-5" />
          </button>
        </div>
        <div className="modal-b" style={{ minHeight: 0, padding: 0 }}>
          {children}
        </div>
      </div>
    </div>
  )
}

function MappingFields({
  profile,
  mapping,
  setMapping
}: {
  profile: StructuredProfile
  mapping: Record<string, string>
  setMapping: (mapping: Record<string, string>) => void
}) {
  return (
    <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 10 }}>
      {mappingRoles.map(([role, label, description]) => (
        <label
          key={role}
          className="col"
          style={{
            minWidth: 0,
            gap: 6,
            padding: 10,
            border: '1px solid var(--border-default)',
            borderRadius: 'var(--radius-md)'
          }}
        >
          <span style={{ fontSize: 12.5, fontWeight: 700 }}>{label}</span>
          <select
            className={selectClass}
            value={mapping[role] || ''}
            onChange={(event) => setMapping({ ...mapping, [role]: event.target.value })}
            style={{ width: '100%', minWidth: 0 }}
          >
            <option value="">사용 안 함</option>
            {profile.columns.map((column) => (
              <option key={column} value={column}>{column}</option>
            ))}
          </select>
          <span className="muted" style={{ fontSize: 10.5, lineHeight: 1.45 }}>{description}</span>
        </label>
      ))}
    </div>
  )
}

function GuidanceColumns({
  profile,
  mapping,
  selected,
  setSelected
}: {
  profile: StructuredProfile
  mapping: Record<string, string>
  selected: string[]
  setSelected: (columns: string[]) => void
}) {
  const mapped = new Set(Object.values(mapping).filter(Boolean))
  const columns = profile.columns.filter((column) => !mapped.has(column))
  return (
    <div className="col" style={{ gap: 8 }}>
      <div>
        <div style={{ fontSize: 13, fontWeight: 700 }}>추가 찾기 힌트 컬럼</div>
        <div className="muted" style={{ marginTop: 3, fontSize: 11.5, lineHeight: 1.5 }}>
          증상, 제품명, 업무 영역처럼 검색에 도움이 되는 컬럼만 선택합니다. 적절한 컬럼이 없으면 선택하지 않고 AI 보완을 사용할 수 있습니다.
        </div>
      </div>
      <div className="row wrap" style={{ gap: 7 }}>
        {columns.length ? columns.map((column) => {
          const checked = selected.includes(column)
          return (
            <label
              key={column}
              className="row"
              style={{
                gap: 6,
                padding: '7px 9px',
                border: `1px solid ${checked ? 'var(--accent)' : 'var(--border-default)'}`,
                borderRadius: 'var(--radius-md)',
                background: checked ? 'var(--accent-soft)' : '#fff',
                cursor: 'pointer'
              }}
            >
              <input
                type="checkbox"
                checked={checked}
                onChange={(event) => setSelected(
                  event.target.checked
                    ? [...selected, column]
                    : selected.filter((item) => item !== column)
                )}
              />
              <span style={{ fontSize: 12 }}>{column}</span>
            </label>
          )
        }) : (
          <span className="muted" style={{ fontSize: 12 }}>추가로 선택할 컬럼이 없습니다.</span>
        )}
      </div>
    </div>
  )
}

function SampleTable({ profile }: { profile: StructuredProfile }) {
  const columns = profile.columns.slice(0, 12)
  const rows = profile.sample_rows.slice(0, 5)
  return (
    <div style={{ overflowX: 'auto', border: '1px solid var(--border-default)', borderRadius: 'var(--radius-md)' }}>
      <table className="table" style={{ minWidth: Math.max(760, columns.length * 150) }}>
        <thead>
          <tr>{columns.map((column) => <th key={column}>{column}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={index}>
              {columns.map((column) => (
                <td key={column} title={String(row[column] ?? '')}>
                  <span style={{ display: 'block', maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {String(row[column] ?? '')}
                  </span>
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export default function FaqBulkCreate({
  tenantId,
  workspace,
  categories,
  onClose,
  onCreated
}: FaqBulkCreateProps) {
  const [sourceTab, setSourceTab] = useState<'excel' | 'connector'>('excel')
  const [step, setStep] = useState<1 | 2 | 3>(1)
  const [file, setFile] = useState<File | null>(null)
  const [sheetName, setSheetName] = useState('')
  const [headerRow, setHeaderRow] = useState('1')
  const [dataStartRow, setDataStartRow] = useState('2')
  const [excelPreview, setExcelPreview] = useState<ExcelPreview | null>(null)
  const [connectors, setConnectors] = useState<Connector[]>([])
  const [selectedConnectorId, setSelectedConnectorId] = useState('')
  const [connectorPreview, setConnectorPreview] = useState<ConnectorPreview | null>(null)
  const [connectorName, setConnectorName] = useState('')
  const [connectorType, setConnectorType] = useState('db_table')
  const [connectorSourceUri, setConnectorSourceUri] = useState('')
  const [connectorAuthRef, setConnectorAuthRef] = useState('')
  const [connectorRawContent, setConnectorRawContent] = useState('')
  const [profile, setProfile] = useState<StructuredProfile | null>(null)
  const [mapping, setMapping] = useState<Record<string, string>>({})
  const [guidanceColumns, setGuidanceColumns] = useState<string[]>([])
  const [title, setTitle] = useState('')
  const [tags, setTags] = useState('structured, faq')
  const [categoryId, setCategoryId] = useState('')
  const [status, setStatus] = useState('draft')
  const [conversionPurpose, setConversionPurpose] = useState<'faq' | 'id_lookup'>('faq')
  const [llmEnabled, setLlmEnabled] = useState(true)
  const [llmScope, setLlmScope] = useState('coverage')
  const [loading, setLoading] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [creatingConnector, setCreatingConnector] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [result, setResult] = useState<any>(null)

  const sourceReady = Boolean(profile)
  const selectedConnector = connectors.find((connector) => connector.connector_id === selectedConnectorId)
  const rowCount = profile?.row_count || 0
  const requiredMappingReady = Boolean(mapping.body || mapping.summary)
    && (conversionPurpose !== 'id_lookup' || Boolean(mapping.id))

  const initializeProfile = (nextProfile: StructuredProfile, suggested?: Record<string, string>) => {
    const nextMapping = { ...(nextProfile.mapping_suggestions || {}), ...(suggested || {}) }
    Object.keys(nextMapping).forEach((key) => {
      if (!nextMapping[key]) delete nextMapping[key]
    })
    setProfile(nextProfile)
    setMapping(nextMapping)
    const mapped = new Set(Object.values(nextMapping))
    const semanticHintColumns = nextProfile.fields
      .filter((field) => !mapped.has(field.name) && ['metadata', 'category', 'keyword'].includes(field.semantic_role))
      .map((field) => field.name)
      .slice(0, 8)
    setGuidanceColumns(semanticHintColumns)
    setStep(2)
  }

  const resetSource = (tab: 'excel' | 'connector') => {
    setSourceTab(tab)
    setStep(1)
    setProfile(null)
    setMapping({})
    setGuidanceColumns([])
    setResult(null)
    setError('')
    setMessage('')
  }

  const loadConnectors = async () => {
    try {
      const response = await api.get(
        `/api/knowledge/faq-connectors?faq_workspace=${encodeURIComponent(workspace)}&limit=200`
      )
      setConnectors(Array.isArray(response.data) ? response.data : [])
    } catch (loadError) {
      setError(errorMessage(loadError, '표 데이터 연결 목록을 불러오지 못했습니다.'))
    }
  }

  useEffect(() => {
    if (sourceTab === 'connector') loadConnectors()
  }, [sourceTab, workspace])

  const analyzeExcel = async () => {
    if (!file) return
    setLoading(true)
    setError('')
    setMessage('')
    setResult(null)
    try {
      const data = new FormData()
      data.set('file', file)
      data.set('header_row', headerRow || '1')
      data.set('data_start_row', dataStartRow || '2')
      data.set('sample_limit', '20')
      data.set('max_rows', '1000')
      data.set('faq_workspace', workspace)
      if (sheetName) data.set('sheet_name', sheetName)
      const response = await api.post('/api/knowledge/faq-structured/excel/preview', data, {
        timeout: 300000
      })
      const preview = response.data as ExcelPreview
      setExcelPreview(preview)
      setSheetName(preview.selected_sheet)
      setHeaderRow(String(preview.header_row))
      setDataStartRow(String(preview.data_start_row))
      setTitle((current) => current || `${file.name} FAQ`)
      initializeProfile(preview.profile)
    } catch (previewError) {
      setError(errorMessage(previewError, 'Excel 파일을 분석하지 못했습니다.'))
    } finally {
      setLoading(false)
    }
  }

  const createConnector = async (event: FormEvent) => {
    event.preventDefault()
    if (!connectorName.trim()) return
    setCreatingConnector(true)
    setError('')
    try {
      const config: Record<string, unknown> = {}
      if (connectorSourceUri.trim()) config.source_uri = connectorSourceUri.trim()
      if (connectorRawContent.trim()) {
        config.raw_content = connectorRawContent.trim()
        config.source_type = connectorRawContent.trim().startsWith('[') ? 'json' : 'csv'
      }
      const response = await api.post('/api/knowledge/faq-connectors', {
        name: connectorName.trim(),
        connector_type: connectorType,
        status: 'draft',
        config,
        auth_ref: connectorAuthRef.trim() || null,
        enabled: true,
        metadata: { created_from: 'integrated_kms_admin' },
        faq_workspace: workspace
      })
      setConnectorName('')
      setConnectorSourceUri('')
      setConnectorAuthRef('')
      setConnectorRawContent('')
      await loadConnectors()
      setSelectedConnectorId(response.data.connector_id)
      setMessage('표 데이터 연결을 등록했습니다. 샘플을 확인한 뒤 컬럼을 매핑해 주세요.')
    } catch (createError) {
      setError(errorMessage(createError, '표 데이터 연결을 등록하지 못했습니다.'))
    } finally {
      setCreatingConnector(false)
    }
  }

  const analyzeConnector = async () => {
    if (!selectedConnectorId) return
    setLoading(true)
    setError('')
    setMessage('')
    setResult(null)
    try {
      const response = await api.post(
        `/api/knowledge/faq-connectors/${encodeURIComponent(selectedConnectorId)}/mapping/preview`,
        {
          mapping: {},
          guidance_columns: [],
          materialization_mode: 'row_per_answer',
          conversion_purpose: conversionPurpose,
          faq_workspace: workspace
        },
        { timeout: 180000 }
      )
      const preview = response.data as ConnectorPreview
      setConnectorPreview(preview)
      setTitle((current) => current || `${preview.connector.name} FAQ`)
      initializeProfile(preview.profile, preview.mapping)
    } catch (previewError) {
      setError(errorMessage(previewError, '연결된 표의 샘플을 분석하지 못했습니다.'))
    } finally {
      setLoading(false)
    }
  }

  const createFaqBatch = async () => {
    if (!profile || !requiredMappingReady) return
    setSubmitting(true)
    setError('')
    setMessage('')
    try {
      const common = {
        title: title.trim(),
        mapping,
        guidance_columns: guidanceColumns,
        materialization_mode: 'row_per_answer',
        conversion_purpose: conversionPurpose,
        status,
        tags: splitTags(tags),
        llm_guidance_enrichment: {
          enabled: llmEnabled,
          scope: llmScope,
          batch_size: 10,
          max_suggestions: 5
        },
        metadata: {
          created_from: 'integrated_kms_admin_bulk_ui',
          source_tab: sourceTab
        },
        tenant_id: tenantId,
        category_id: categoryId || null,
        enabled: true,
        faq_workspace: workspace
      }
      const response = sourceTab === 'excel'
        ? await api.post('/api/knowledge/faq-structured/materialize', {
          ...common,
          source_type: excelPreview?.profile.source_type || 'json',
          raw_content: excelPreview?.raw_content,
          source_uri: excelPreview?.source_uri,
          file_name: excelPreview?.file_name,
          source_truncated: Boolean(excelPreview?.truncated)
        }, { timeout: 600000 })
        : await api.post(
          `/api/knowledge/faq-connectors/${encodeURIComponent(selectedConnectorId)}/materialize`,
          common,
          { timeout: 600000 }
        )
      setResult(response.data)
      const linkedCount = Number(response.data?.ledger?.linked_count || 0)
      setMessage(
        `${linkedCount.toLocaleString()}개 FAQ를 생성하고 통합 어드민 원장에 연결했습니다.${llmEnabled ? ' AI 찾기 힌트 보완은 작업 관리에서 진행 상태를 확인할 수 있습니다.' : ''}`
      )
      await onCreated()
    } catch (materializeError) {
      setError(errorMessage(materializeError, 'FAQ 일괄 생성을 완료하지 못했습니다.'))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <ToolModal title="표 데이터로 FAQ 일괄 생성" onClose={onClose}>
      <div className="col" style={{ height: '100%', minHeight: 0 }}>
        <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border-default)' }}>
          <div className="row wrap" style={{ gap: 8 }}>
            <div className="seg">
              <button type="button" className={sourceTab === 'excel' ? 'on' : ''} onClick={() => resetSource('excel')}>
                <FileSpreadsheetIcon className="size-4" /> Excel
              </button>
              <button type="button" className={sourceTab === 'connector' ? 'on' : ''} onClick={() => resetSource('connector')}>
                <DatabaseIcon className="size-4" /> DB·표 연결
              </button>
            </div>
            <span className="badge outline">워크스페이스 {workspace}</span>
            <div className="sp" />
            {[1, 2, 3].map((item) => (
              <button
                key={item}
                type="button"
                disabled={item > 1 && !sourceReady}
                onClick={() => setStep(item as 1 | 2 | 3)}
                style={{
                  border: 0,
                  background: 'transparent',
                  color: step === item ? 'var(--accent)' : 'var(--fg-secondary)',
                  fontWeight: step === item ? 750 : 550,
                  cursor: item > 1 && !sourceReady ? 'not-allowed' : 'pointer'
                }}
              >
                {item}. {item === 1 ? '자료 확인' : item === 2 ? '컬럼 매핑' : '생성 확인'}
              </button>
            ))}
          </div>
        </div>

        <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: 20 }}>
          {(error || message) && (
            <div
              style={{
                marginBottom: 14,
                padding: '11px 13px',
                borderRadius: 'var(--radius-md)',
                border: `1px solid ${error ? 'var(--danger)' : 'var(--accent)'}`,
                background: error ? 'var(--danger-soft)' : 'var(--accent-soft)'
              }}
            >
              {error || message}
            </div>
          )}

          {step === 1 && sourceTab === 'excel' && (
            <div className="col" style={{ gap: 18 }}>
              <div>
                <h3 style={{ margin: 0 }}>Excel 파일과 시트 확인</h3>
                <p className="muted" style={{ margin: '6px 0 0', lineHeight: 1.6 }}>
                  파일을 선택한 것만으로 FAQ가 생성되지 않습니다. 시트·헤더 위치를 확인하고 `Excel 분석`을 실행해야 다음 단계로 이동합니다.
                </p>
              </div>
              <div className="grid" style={{ gridTemplateColumns: 'minmax(280px, 1fr) 220px 160px 160px', gap: 10 }}>
                <label className="col" style={{ gap: 6 }}>
                  <span className="eyebrow">Excel 파일 · 최대 200MB</span>
                  <input
                    type="file"
                    accept=".xlsx,.xlsm,.xltx,.xltm"
                    onChange={(event) => {
                      setFile(event.target.files?.[0] || null)
                      setExcelPreview(null)
                      setProfile(null)
                      setStep(1)
                    }}
                  />
                </label>
                <label className="col" style={{ gap: 6 }}>
                  <span className="eyebrow">시트</span>
                  <select
                    className={selectClass}
                    value={sheetName}
                    onChange={(event) => setSheetName(event.target.value)}
                    disabled={!excelPreview?.sheets.length}
                  >
                    {!excelPreview?.sheets.length && <option value="">첫 시트 자동 선택</option>}
                    {excelPreview?.sheets.map((sheet) => (
                      <option key={sheet.name} value={sheet.name}>
                        {sheet.name} ({sheet.max_row.toLocaleString()}행)
                      </option>
                    ))}
                  </select>
                </label>
                <label className="col" style={{ gap: 6 }}>
                  <span className="eyebrow">헤더 행</span>
                  <Input type="number" min={1} value={headerRow} onChange={(event) => setHeaderRow(event.target.value)} />
                </label>
                <label className="col" style={{ gap: 6 }}>
                  <span className="eyebrow">데이터 시작 행</span>
                  <Input type="number" min={1} value={dataStartRow} onChange={(event) => setDataStartRow(event.target.value)} />
                </label>
              </div>
              <div>
                <Button type="button" onClick={analyzeExcel} disabled={!file || loading}>
                  <UploadIcon className={loading ? 'spin size-4' : 'size-4'} />
                  {loading ? 'Excel 분석 중' : excelPreview ? '선택 조건으로 다시 분석' : 'Excel 분석'}
                </Button>
              </div>
              {excelPreview && (
                <div className="col" style={{ gap: 10 }}>
                  <div className="row wrap" style={{ gap: 7 }}>
                    <span className="badge green">시트 {excelPreview.selected_sheet}</span>
                    <span className="badge outline">{excelPreview.row_count.toLocaleString()}행</span>
                    <span className="badge outline">{excelPreview.columns.length}개 컬럼</span>
                    {excelPreview.truncated && <span className="badge amber">1,000행까지만 준비됨</span>}
                  </div>
                  <SampleTable profile={excelPreview.profile} />
                </div>
              )}
            </div>
          )}

          {step === 1 && sourceTab === 'connector' && (
            <div className="grid" style={{ gridTemplateColumns: '360px minmax(0, 1fr)', gap: 18, alignItems: 'start' }}>
              <form
                onSubmit={createConnector}
                className="col"
                style={{ gap: 11, paddingRight: 18, borderRight: '1px solid var(--border-default)' }}
              >
                <div>
                  <h3 style={{ margin: 0 }}>새 표 데이터 연결</h3>
                  <p className="muted" style={{ margin: '5px 0 0', fontSize: 11.5, lineHeight: 1.5 }}>
                    외부 DB 비밀번호는 저장하지 않고 서버 환경변수 이름만 지정합니다.
                  </p>
                </div>
                <Input value={connectorName} onChange={(event) => setConnectorName(event.target.value)} placeholder="연결 이름" />
                <select className={selectClass} value={connectorType} onChange={(event) => setConnectorType(event.target.value)}>
                  <option value="db_table">DB 단일 테이블</option>
                  <option value="multi_table">DB 다중 테이블</option>
                  <option value="nosql_collection">NoSQL 컬렉션</option>
                  <option value="manual_table">직접 입력 표</option>
                  <option value="web">웹 데이터</option>
                </select>
                <Input
                  value={connectorSourceUri}
                  onChange={(event) => setConnectorSourceUri(event.target.value)}
                  placeholder="db://public.it_helpdesk_faq"
                />
                <Input
                  value={connectorAuthRef}
                  onChange={(event) => setConnectorAuthRef(event.target.value)}
                  placeholder="외부 DB URL 환경변수명 (선택)"
                />
                <textarea
                  className="textarea"
                  rows={5}
                  value={connectorRawContent}
                  onChange={(event) => setConnectorRawContent(event.target.value)}
                  placeholder="직접 입력 표인 경우 JSON 배열 또는 CSV 샘플"
                />
                <Button type="submit" disabled={creatingConnector || !connectorName.trim()}>
                  <PlusIcon className="size-4" /> {creatingConnector ? '등록 중' : '표 데이터 연결 등록'}
                </Button>
              </form>

              <div className="col" style={{ gap: 14, minWidth: 0 }}>
                <div className="row wrap" style={{ gap: 8 }}>
                  <select
                    className={selectClass}
                    value={selectedConnectorId}
                    onChange={(event) => {
                      setSelectedConnectorId(event.target.value)
                      setConnectorPreview(null)
                      setProfile(null)
                    }}
                    style={{ flex: 1, minWidth: 260 }}
                  >
                    <option value="">연결 선택</option>
                    {connectors.map((connector) => (
                      <option key={connector.connector_id} value={connector.connector_id}>
                        {connector.name} · {connector.connector_type} · {connector.status}
                      </option>
                    ))}
                  </select>
                  <Button type="button" variant="outline" onClick={loadConnectors}>
                    <RefreshCwIcon className="size-4" /> 목록 갱신
                  </Button>
                  <Button type="button" onClick={analyzeConnector} disabled={!selectedConnectorId || loading}>
                    <DatabaseIcon className={loading ? 'spin size-4' : 'size-4'} />
                    {loading ? '샘플 조회 중' : '샘플과 컬럼 확인'}
                  </Button>
                </div>
                {selectedConnector && (
                  <div className="row wrap" style={{ gap: 7 }}>
                    <span className="badge blue">{selectedConnector.connector_type}</span>
                    <span className="badge outline">{selectedConnector.status}</span>
                    <span className="badge outline mono">{selectedConnector.connector_id}</span>
                  </div>
                )}
                {connectorPreview ? (
                  <>
                    <div className="row wrap" style={{ gap: 7 }}>
                      <span className="badge green">{connectorPreview.sample.row_count.toLocaleString()}행 확인</span>
                      <span className="badge outline">{connectorPreview.profile.columns.length}개 컬럼</span>
                      {connectorPreview.sample.truncated && <span className="badge amber">일부 행만 조회됨</span>}
                    </div>
                    <SampleTable profile={connectorPreview.profile} />
                  </>
                ) : (
                  <div className="empty" style={{ minHeight: 220 }}>
                    연결을 선택하고 샘플을 조회하면 실제 컬럼과 행을 확인한 뒤 FAQ 매핑을 진행할 수 있습니다.
                  </div>
                )}
              </div>
            </div>
          )}

          {step === 2 && profile && (
            <div className="col" style={{ gap: 18 }}>
              <div className="row wrap" style={{ gap: 8 }}>
                <div>
                  <h3 style={{ margin: 0 }}>행별 FAQ 컬럼 매핑</h3>
                  <p className="muted" style={{ margin: '5px 0 0', lineHeight: 1.5 }}>
                    자동 추천값을 확인하고 실제 데이터 의미에 맞게 수정해 주세요.
                  </p>
                </div>
                <div className="sp" />
                <select
                  className={selectClass}
                  value={conversionPurpose}
                  onChange={(event) => setConversionPurpose(event.target.value as 'faq' | 'id_lookup')}
                  style={{ width: 190 }}
                >
                  <option value="faq">일반 FAQ</option>
                  <option value="id_lookup">상세정보로 ID 찾기</option>
                </select>
              </div>
              {conversionPurpose === 'id_lookup' && (
                <div style={{ padding: 11, border: '1px solid var(--accent)', borderRadius: 'var(--radius-md)', background: 'var(--accent-soft)' }}>
                  ID 컬럼은 반환할 업무 코드이며, 대표 질문·제목·본문·추가 힌트 컬럼은 사용자가 상세정보로 해당 ID를 찾는 데 사용됩니다.
                </div>
              )}
              <MappingFields profile={profile} mapping={mapping} setMapping={setMapping} />
              <GuidanceColumns
                profile={profile}
                mapping={mapping}
                selected={guidanceColumns}
                setSelected={setGuidanceColumns}
              />
              <SampleTable profile={profile} />
              <div className="row" style={{ gap: 8, justifyContent: 'space-between' }}>
                <Button type="button" variant="outline" onClick={() => setStep(1)}>이전 단계</Button>
                <Button type="button" onClick={() => setStep(3)} disabled={!requiredMappingReady}>생성 조건 확인</Button>
              </div>
            </div>
          )}

          {step === 3 && profile && (
            <div className="col" style={{ gap: 18 }}>
              <div>
                <h3 style={{ margin: 0 }}>FAQ 생성 조건 확인</h3>
                <p className="muted" style={{ margin: '5px 0 0', lineHeight: 1.55 }}>
                  {rowCount.toLocaleString()}개 행을 각각 하나의 FAQ 후보로 만들고 통합 어드민 원장에 자동 연결합니다.
                </p>
              </div>
              <div className="grid" style={{ gridTemplateColumns: 'minmax(280px, 2fr) minmax(220px, 1fr) minmax(180px, 1fr)', gap: 12 }}>
                <label className="col" style={{ gap: 6 }}>
                  <span className="eyebrow">생성 묶음 이름</span>
                  <Input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="IT헬프데스크 FAQ" />
                </label>
                <label className="col" style={{ gap: 6 }}>
                  <span className="eyebrow">카테고리</span>
                  <select className={selectClass} value={categoryId} onChange={(event) => setCategoryId(event.target.value)}>
                    <option value="">카테고리 없음</option>
                    {categories.map((category) => (
                      <option key={category.category_id} value={category.category_id}>
                        {category.path || category.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="col" style={{ gap: 6 }}>
                  <span className="eyebrow">생성 상태</span>
                  <select className={selectClass} value={status} onChange={(event) => setStatus(event.target.value)}>
                    <option value="draft">검토 필요</option>
                    <option value="published">바로 게시</option>
                  </select>
                </label>
              </div>
              <label className="col" style={{ gap: 6 }}>
                <span className="eyebrow">공통 태그</span>
                <Input value={tags} onChange={(event) => setTags(event.target.value)} placeholder="it-helpdesk, excel" />
              </label>
              <div
                className="grid"
                style={{
                  gridTemplateColumns: 'minmax(220px, 1fr) minmax(260px, 2fr)',
                  gap: 14,
                  padding: 14,
                  border: '1px solid var(--border-default)',
                  borderRadius: 'var(--radius-md)'
                }}
              >
                <label className="row" style={{ gap: 8, alignSelf: 'start' }}>
                  <input type="checkbox" checked={llmEnabled} onChange={(event) => setLlmEnabled(event.target.checked)} />
                  <span>
                    <strong className="row" style={{ gap: 6 }}><SparklesIcon className="size-4" /> AI 찾기 힌트 보완</strong>
                    <span className="muted" style={{ display: 'block', fontSize: 11.5, marginTop: 4 }}>
                      답변 본문은 바꾸지 않고 질문·동의어·한영 표현을 보완합니다.
                    </span>
                  </span>
                </label>
                <label className="col" style={{ gap: 6 }}>
                  <span className="eyebrow">보완 범위</span>
                  <select className={selectClass} value={llmScope} onChange={(event) => setLlmScope(event.target.value)} disabled={!llmEnabled}>
                    <option value="coverage">표현 범위 점검 · 권장</option>
                    <option value="missing_or_weak">힌트가 없거나 부족한 FAQ만</option>
                    <option value="all">모든 FAQ 다시 제안</option>
                  </select>
                </label>
              </div>
              <div className="row wrap" style={{ gap: 8 }}>
                <span className="badge blue">{rowCount.toLocaleString()}개 FAQ</span>
                <span className="badge outline">{conversionPurpose === 'id_lookup' ? 'ID 조회형' : '일반 FAQ'}</span>
                <span className="badge outline">힌트 컬럼 {guidanceColumns.length}개</span>
                <span className="badge outline">{llmEnabled ? 'AI 보완 사용' : 'AI 보완 안 함'}</span>
              </div>
              {result && (
                <div style={{ padding: 16, border: '1px solid var(--accent)', borderRadius: 'var(--radius-md)', background: 'var(--accent-soft)' }}>
                  <div className="row" style={{ gap: 8, fontWeight: 750 }}>
                    <CheckCircleIcon className="size-5" style={{ color: 'var(--accent)' }} /> 생성 완료
                  </div>
                  <div className="row wrap" style={{ gap: 7, marginTop: 10 }}>
                    <span className="badge green">원장 연결 {Number(result.ledger?.linked_count || 0).toLocaleString()}건</span>
                    <span className="badge outline mono">Batch {result.ledger?.batch_id || '-'}</span>
                    {(result.ledger?.task_ids || []).map((taskId: string) => (
                      <span key={taskId} className="badge outline mono">Task {taskId}</span>
                    ))}
                  </div>
                </div>
              )}
              <div className="row" style={{ gap: 8, justifyContent: 'space-between' }}>
                <Button type="button" variant="outline" onClick={() => setStep(2)}>이전 단계</Button>
                <Button
                  type="button"
                  onClick={createFaqBatch}
                  disabled={submitting || !title.trim() || !requiredMappingReady || Boolean(result)}
                >
                  <SparklesIcon className={submitting ? 'spin size-4' : 'size-4'} />
                  {submitting ? 'FAQ 생성 중' : `${rowCount.toLocaleString()}개 FAQ 생성`}
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>
    </ToolModal>
  )
}

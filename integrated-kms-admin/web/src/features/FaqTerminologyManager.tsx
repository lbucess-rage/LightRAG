import { type FormEvent, type ReactNode, useEffect, useMemo, useState } from 'react'
import {
  CheckIcon,
  LanguagesIcon,
  PlusIcon,
  RefreshCwIcon,
  SearchIcon,
  SparklesIcon,
  Trash2Icon,
  XIcon
} from 'lucide-react'

import { api } from '@/api/client'
import Button from '@/components/ui/Button'
import Input from '@/components/ui/Input'
import { selectClass } from '@/lib/form'

type AliasGroup = {
  alias_id: string
  canonical_term: string
  aliases: string[]
  enabled: boolean
  source?: string
  update_time?: string | null
}

type TermCandidate = {
  candidate_id: string
  canonical_term: string
  aliases: string[]
  term_type: 'synonym' | 'abbreviation' | 'neologism'
  status: 'suggested' | 'approved' | 'rejected'
  confidence: number
  rationale?: string | null
  evidence?: Array<Record<string, unknown>>
  source?: string
}

type FaqTerminologyManagerProps = {
  workspace: string
  onClose: () => void
}

function errorMessage(error: unknown, fallback: string) {
  const value = error as any
  const detail = value?.response?.data?.detail
  if (typeof detail === 'string') return detail
  if (detail && typeof detail === 'object') return JSON.stringify(detail)
  return value?.message || fallback
}

function splitTerms(value: string) {
  return Array.from(
    new Set(
      value
        .split(/[\n,]/)
        .map((item) => item.trim())
        .filter(Boolean)
    )
  )
}

function candidateTypeLabel(type: TermCandidate['term_type']) {
  if (type === 'abbreviation') return '약어'
  if (type === 'neologism') return '신조어'
  return '동의어'
}

function candidateStatusLabel(status: TermCandidate['status']) {
  if (status === 'approved') return '승인됨'
  if (status === 'rejected') return '제외됨'
  return '검토 대기'
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
    const handler = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose])

  return (
    <div className="overlay" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div
        className="modal xl"
        style={{ maxWidth: 'min(1280px, calc(100vw - 32px))', height: 'min(860px, calc(100vh - 32px))' }}
      >
        <div className="modal-h">
          <LanguagesIcon className="size-5" style={{ color: 'var(--accent)' }} />
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

export default function FaqTerminologyManager({ workspace, onClose }: FaqTerminologyManagerProps) {
  const [tab, setTab] = useState<'aliases' | 'candidates'>('aliases')
  const [aliases, setAliases] = useState<AliasGroup[]>([])
  const [candidates, setCandidates] = useState<TermCandidate[]>([])
  const [search, setSearch] = useState('')
  const [candidateStatus, setCandidateStatus] = useState('suggested')
  const [canonicalTerm, setCanonicalTerm] = useState('')
  const [aliasText, setAliasText] = useState('')
  const [loading, setLoading] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [analyzing, setAnalyzing] = useState(false)
  const [actionId, setActionId] = useState('')
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')

  const workspaceQuery = useMemo(
    () => `faq_workspace=${encodeURIComponent(workspace)}`,
    [workspace]
  )

  const loadAliases = async () => {
    const params = new URLSearchParams({ faq_workspace: workspace })
    if (search.trim()) params.set('search', search.trim())
    const response = await api.get(`/api/knowledge/faq-aliases?${params.toString()}`)
    setAliases(Array.isArray(response.data) ? response.data : [])
  }

  const loadCandidates = async () => {
    const params = new URLSearchParams({
      faq_workspace: workspace,
      limit: '500'
    })
    if (candidateStatus !== 'all') params.set('status', candidateStatus)
    if (search.trim()) params.set('search', search.trim())
    const response = await api.get(`/api/knowledge/faq-term-candidates?${params.toString()}`)
    setCandidates(Array.isArray(response.data) ? response.data : [])
  }

  const load = async () => {
    setLoading(true)
    setError('')
    try {
      if (tab === 'aliases') await loadAliases()
      else await loadCandidates()
    } catch (loadError) {
      setError(errorMessage(loadError, '공통 용어 정보를 불러오지 못했습니다.'))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
  }, [tab, candidateStatus, workspace])

  const submitSearch = (event: FormEvent) => {
    event.preventDefault()
    load()
  }

  const createAlias = async (event: FormEvent) => {
    event.preventDefault()
    const aliasValues = splitTerms(aliasText)
    if (!canonicalTerm.trim() || aliasValues.length === 0) return
    setSubmitting(true)
    setError('')
    setMessage('')
    try {
      await api.post(`/api/knowledge/faq-aliases?${workspaceQuery}`, {
        canonical_term: canonicalTerm.trim(),
        aliases: aliasValues,
        enabled: true,
        metadata: { created_from: 'integrated_kms_admin' }
      })
      setCanonicalTerm('')
      setAliasText('')
      setMessage('공통 용어가 등록되어 다음 FAQ 검색부터 적용됩니다.')
      await loadAliases()
    } catch (createError) {
      setError(errorMessage(createError, '공통 용어를 등록하지 못했습니다.'))
    } finally {
      setSubmitting(false)
    }
  }

  const deleteAlias = async (aliasId: string) => {
    if (!window.confirm('이 공통 용어 묶음을 삭제하시겠습니까? 다음 검색부터 확장에 사용되지 않습니다.')) return
    setActionId(aliasId)
    setError('')
    try {
      await api.delete(`/api/knowledge/faq-aliases/${encodeURIComponent(aliasId)}?${workspaceQuery}`)
      await loadAliases()
    } catch (deleteError) {
      setError(errorMessage(deleteError, '공통 용어를 삭제하지 못했습니다.'))
    } finally {
      setActionId('')
    }
  }

  const analyze = async () => {
    setAnalyzing(true)
    setError('')
    setMessage('')
    try {
      const response = await api.post(
        `/api/knowledge/faq-term-candidates/analyze?${workspaceQuery}`,
        {
          include_drafts: true,
          include_no_match_queries: true,
          answer_limit: 1000,
          event_limit: 300,
          batch_size: 20
        }
      )
      setMessage(
        `AI 용어 분석을 시작했습니다. 작업 ID ${response.data.job_id || response.data.task_id}는 작업 관리에서 확인할 수 있습니다.`
      )
    } catch (analyzeError) {
      setError(errorMessage(analyzeError, 'AI 용어 분석을 시작하지 못했습니다.'))
    } finally {
      setAnalyzing(false)
    }
  }

  const decideCandidate = async (candidateId: string, action: 'approve' | 'reject') => {
    setActionId(candidateId)
    setError('')
    setMessage('')
    try {
      await api.post(
        `/api/knowledge/faq-term-candidates/${encodeURIComponent(candidateId)}/${action}?${workspaceQuery}`
      )
      setMessage(
        action === 'approve'
          ? '승인한 용어가 공통 용어에 등록되어 다음 FAQ 검색부터 적용됩니다.'
          : '후보를 제외했습니다. 검색에는 반영되지 않습니다.'
      )
      await loadCandidates()
      if (action === 'approve') await loadAliases()
    } catch (actionError) {
      setError(errorMessage(actionError, '용어 후보 상태를 변경하지 못했습니다.'))
    } finally {
      setActionId('')
    }
  }

  return (
    <ToolModal title="FAQ 공통 용어" onClose={onClose}>
      <div className="col" style={{ height: '100%', minHeight: 0 }}>
        <div style={{ padding: '18px 22px 14px', borderBottom: '1px solid var(--border-default)' }}>
          <div className="row wrap" style={{ gap: 8 }}>
            <div className="seg">
              <button type="button" className={tab === 'aliases' ? 'on' : ''} onClick={() => setTab('aliases')}>
                적용 중인 용어
              </button>
              <button
                type="button"
                className={tab === 'candidates' ? 'on' : ''}
                onClick={() => setTab('candidates')}
              >
                AI 검토 후보
              </button>
            </div>
            <span className="badge outline">워크스페이스 {workspace}</span>
            <div className="sp" />
            {tab === 'candidates' && (
              <Button type="button" variant="outline" onClick={analyze} disabled={analyzing}>
                <SparklesIcon className={analyzing ? 'spin size-4' : 'size-4'} />
                {analyzing ? '분석 요청 중' : 'AI 용어 분석'}
              </Button>
            )}
            <Button type="button" variant="outline" onClick={load} disabled={loading}>
              <RefreshCwIcon className={loading ? 'spin size-4' : 'size-4'} /> 새로고침
            </Button>
          </div>
          <p className="muted" style={{ margin: '10px 0 0', lineHeight: 1.6 }}>
            답변별 찾기 힌트와 달리 이 용어는 워크스페이스의 모든 FAQ 검색에 적용됩니다.
            AI 후보는 승인하기 전까지 실제 검색에 영향을 주지 않습니다.
          </p>
        </div>

        <div
          className="grid"
          style={{
            gridTemplateColumns: tab === 'aliases' ? '330px minmax(0, 1fr)' : 'minmax(0, 1fr)',
            flex: 1,
            minHeight: 0
          }}
        >
          {tab === 'aliases' && (
            <form
              onSubmit={createAlias}
              className="col"
              style={{ gap: 14, padding: 20, borderRight: '1px solid var(--border-default)', overflowY: 'auto' }}
            >
              <div>
                <div style={{ fontWeight: 750 }}>직접 용어 등록</div>
                <div className="muted" style={{ fontSize: 12, marginTop: 4, lineHeight: 1.5 }}>
                  예: 대표어 `Microsoft Teams`, 같은 표현 `팀즈, MS Teams, 마이크로소프트 팀즈`
                </div>
              </div>
              <label className="col" style={{ gap: 6 }}>
                <span className="eyebrow">대표어</span>
                <Input
                  value={canonicalTerm}
                  onChange={(event) => setCanonicalTerm(event.target.value)}
                  placeholder="Microsoft Teams"
                />
              </label>
              <label className="col" style={{ gap: 6 }}>
                <span className="eyebrow">같은 표현</span>
                <textarea
                  className="textarea"
                  rows={6}
                  value={aliasText}
                  onChange={(event) => setAliasText(event.target.value)}
                  placeholder={'팀즈\nMS Teams\n마이크로소프트 팀즈'}
                />
                <span className="muted" style={{ fontSize: 11.5 }}>줄바꿈이나 쉼표로 구분합니다.</span>
              </label>
              <Button
                type="submit"
                disabled={submitting || !canonicalTerm.trim() || splitTerms(aliasText).length === 0}
              >
                <PlusIcon className="size-4" /> {submitting ? '등록 중' : '공통 용어 등록'}
              </Button>
            </form>
          )}

          <div className="col" style={{ minWidth: 0, minHeight: 0 }}>
            <form
              onSubmit={submitSearch}
              className="row wrap"
              style={{ gap: 8, padding: '14px 18px', borderBottom: '1px solid var(--border-default)' }}
            >
              {tab === 'candidates' && (
                <select
                  className={selectClass}
                  value={candidateStatus}
                  onChange={(event) => setCandidateStatus(event.target.value)}
                  style={{ width: 140 }}
                >
                  <option value="suggested">검토 대기</option>
                  <option value="approved">승인됨</option>
                  <option value="rejected">제외됨</option>
                  <option value="all">전체 상태</option>
                </select>
              )}
              <Input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="대표어 또는 같은 표현 검색"
                style={{ flex: 1, minWidth: 240 }}
              />
              <Button type="submit" variant="outline">
                <SearchIcon className="size-4" /> 조회
              </Button>
            </form>

            {(error || message) && (
              <div
                style={{
                  margin: '12px 18px 0',
                  padding: '10px 12px',
                  borderRadius: 'var(--radius-md)',
                  border: `1px solid ${error ? 'var(--danger)' : 'var(--accent)'}`,
                  background: error ? 'var(--danger-soft)' : 'var(--accent-soft)',
                  color: error ? 'var(--danger)' : 'var(--fg-primary)'
                }}
              >
                {error || message}
              </div>
            )}

            <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: 18 }}>
              {loading ? (
                <div className="empty">용어 정보를 불러오는 중입니다.</div>
              ) : tab === 'aliases' ? (
                aliases.length ? (
                  <div className="col" style={{ gap: 8 }}>
                    {aliases.map((group) => (
                      <div
                        key={group.alias_id}
                        className="row"
                        style={{
                          gap: 14,
                          padding: '13px 14px',
                          border: '1px solid var(--border-default)',
                          borderRadius: 'var(--radius-md)',
                          alignItems: 'flex-start'
                        }}
                      >
                        <div style={{ minWidth: 180 }}>
                          <div style={{ fontWeight: 750 }}>{group.canonical_term}</div>
                          <div className="muted mono" style={{ fontSize: 10.5, marginTop: 4 }}>
                            {group.alias_id}
                          </div>
                        </div>
                        <div className="row wrap grow" style={{ gap: 6 }}>
                          {group.aliases.map((alias) => (
                            <span key={alias} className="badge outline">{alias}</span>
                          ))}
                        </div>
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          title="공통 용어 삭제"
                          onClick={() => deleteAlias(group.alias_id)}
                          disabled={actionId === group.alias_id}
                        >
                          <Trash2Icon className="size-4" />
                        </Button>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="empty">등록된 공통 용어가 없습니다.</div>
                )
              ) : candidates.length ? (
                <div className="col" style={{ gap: 9 }}>
                  {candidates.map((candidate) => (
                    <div
                      key={candidate.candidate_id}
                      style={{
                        padding: 14,
                        border: '1px solid var(--border-default)',
                        borderRadius: 'var(--radius-md)'
                      }}
                    >
                      <div className="row wrap" style={{ gap: 8 }}>
                        <strong>{candidate.canonical_term}</strong>
                        <span className="badge blue">{candidateTypeLabel(candidate.term_type)}</span>
                        <span className={`badge ${candidate.status === 'approved' ? 'green' : candidate.status === 'rejected' ? 'gray' : 'amber'}`}>
                          {candidateStatusLabel(candidate.status)}
                        </span>
                        <span className="badge outline">신뢰도 {Math.round(candidate.confidence * 100)}%</span>
                        <div className="sp" />
                        {candidate.status === 'suggested' && (
                          <>
                            <Button
                              type="button"
                              size="sm"
                              onClick={() => decideCandidate(candidate.candidate_id, 'approve')}
                              disabled={actionId === candidate.candidate_id}
                            >
                              <CheckIcon className="size-4" /> 승인
                            </Button>
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              onClick={() => decideCandidate(candidate.candidate_id, 'reject')}
                              disabled={actionId === candidate.candidate_id}
                            >
                              <XIcon className="size-4" /> 제외
                            </Button>
                          </>
                        )}
                      </div>
                      <div className="row wrap" style={{ gap: 6, marginTop: 10 }}>
                        {candidate.aliases.map((alias) => (
                          <span key={alias} className="badge outline">{alias}</span>
                        ))}
                      </div>
                      {candidate.rationale && (
                        <p className="muted" style={{ margin: '10px 0 0', lineHeight: 1.55 }}>
                          {candidate.rationale}
                        </p>
                      )}
                      <div className="muted" style={{ marginTop: 8, fontSize: 11.5 }}>
                        근거 {candidate.evidence?.length || 0}건 · {candidate.source || 'AI 분석'}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="empty">
                  조건에 맞는 AI 용어 후보가 없습니다. `AI 용어 분석`을 실행한 뒤 작업 완료 후 새로고침해 주세요.
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </ToolModal>
  )
}

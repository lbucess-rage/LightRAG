import { useEffect, useMemo, useState } from 'react'
import {
  EyeIcon,
  Loader2Icon,
  NetworkIcon,
  RefreshCwIcon,
  SaveIcon,
  ShieldCheckIcon,
  XIcon
} from 'lucide-react'

import { api } from '@/api/client'
import Button from '@/components/ui/Button'
import Input from '@/components/ui/Input'
import { selectClass } from '@/lib/form'

type FaqGraphManagerProps = {
  workspace: string
  answers: Array<{ answer_id: string; title: string }>
  onClose: () => void
}

type GraphConfig = {
  enabled: boolean
  auto_sync: boolean
  graph_weight: number
  min_similarity: number
  max_hops: number
  precision_mode: boolean
  precision_min_score: number
  min_score_margin: number
  min_category_margin: number
  min_evidence_sources: number
  llm_min_confidence: number
  entity_types: string[]
  relation_types: string[]
  extraction_prompt: string
  schema_version: number
}

function errorMessage(error: unknown) {
  const value = error as any
  return value?.response?.data?.detail || value?.message || 'FAQ 그래프 요청을 처리하지 못했습니다.'
}

function splitTypes(value: string) {
  return Array.from(new Set(value.split(/[\n,]+/).map((item) => item.trim()).filter(Boolean)))
}

export default function FaqGraphManager({ workspace, answers, onClose }: FaqGraphManagerProps) {
  const [config, setConfig] = useState<GraphConfig | null>(null)
  const [status, setStatus] = useState<any>(null)
  const [entityTypes, setEntityTypes] = useState('')
  const [relationTypes, setRelationTypes] = useState('')
  const [prompt, setPrompt] = useState('')
  const [answerId, setAnswerId] = useState(answers[0]?.answer_id || '')
  const [useLlm, setUseLlm] = useState(false)
  const [preview, setPreview] = useState<any>(null)
  const [task, setTask] = useState<any>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState('')

  const params = useMemo(
    () => ({ params: { faq_workspace: workspace } }),
    [workspace]
  )

  const load = async () => {
    setBusy('load')
    setError('')
    try {
      const [configResponse, statusResponse] = await Promise.all([
        api.get('/api/knowledge/faq-graph/config', params),
        api.get('/api/knowledge/faq-graph/status', params)
      ])
      const nextConfig = configResponse.data as GraphConfig
      setConfig(nextConfig)
      setStatus(statusResponse.data)
      setEntityTypes(nextConfig.entity_types.join(', '))
      setRelationTypes(nextConfig.relation_types.join(', '))
      setPrompt(nextConfig.extraction_prompt)
    } catch (requestError) {
      setError(errorMessage(requestError))
    } finally {
      setBusy('')
    }
  }

  useEffect(() => {
    void load()
  }, [workspace])

  useEffect(() => {
    if (!task?.task_id || ['completed', 'failed', 'cancelled'].includes(task.status)) return
    const timer = window.setInterval(async () => {
      try {
        const response = await api.get(
          `/api/knowledge/faq-graph/tasks/${encodeURIComponent(task.task_id)}`,
          params
        )
        setTask(response.data)
        if (response.data.status === 'completed') void load()
      } catch (requestError) {
        setError(errorMessage(requestError))
      }
    }, 1500)
    return () => window.clearInterval(timer)
  }, [params, task?.status, task?.task_id])

  useEffect(() => {
    const handler = (event: KeyboardEvent) => event.key === 'Escape' && onClose()
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose])

  const save = async () => {
    if (!config) return
    setBusy('save')
    setError('')
    try {
      const response = await api.put(
        '/api/knowledge/faq-graph/config',
        {
          enabled: config.enabled,
          auto_sync: config.auto_sync,
          graph_weight: Number(config.graph_weight),
          min_similarity: Number(config.min_similarity),
          max_hops: Number(config.max_hops),
          precision_mode: config.precision_mode,
          precision_min_score: Number(config.precision_min_score),
          min_score_margin: Number(config.min_score_margin),
          min_category_margin: Number(config.min_category_margin),
          min_evidence_sources: Number(config.min_evidence_sources),
          llm_min_confidence: Number(config.llm_min_confidence),
          entity_types: splitTypes(entityTypes),
          relation_types: splitTypes(relationTypes),
          extraction_prompt: prompt
        },
        params
      )
      const saved = response.data as GraphConfig
      setConfig(saved)
      setEntityTypes(saved.entity_types.join(', '))
      setRelationTypes(saved.relation_types.join(', '))
      await load()
    } catch (requestError) {
      setError(errorMessage(requestError))
    } finally {
      setBusy('')
    }
  }

  const runPreview = async () => {
    if (!answerId) return
    setBusy('preview')
    setError('')
    try {
      const response = await api.post(
        '/api/knowledge/faq-graph/preview',
        { answer_id: answerId, use_llm: useLlm },
        params
      )
      setPreview(response.data)
    } catch (requestError) {
      setError(errorMessage(requestError))
    } finally {
      setBusy('')
    }
  }

  const rebuild = async () => {
    setBusy('rebuild')
    setError('')
    try {
      const response = await api.post(
        '/api/knowledge/faq-graph/rebuild',
        {
          include_drafts: true,
          only_stale: true,
          use_llm: useLlm,
          limit: 1000
        },
        params
      )
      setTask({
        task_id: response.data.task_id,
        status: 'pending',
        progress: 0,
        message: `${response.data.answer_count}건 구축 대기`
      })
    } catch (requestError) {
      setError(errorMessage(requestError))
    } finally {
      setBusy('')
    }
  }

  return (
    <div className="overlay" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div className="modal xl" style={{ maxWidth: 'min(1320px, calc(100vw - 32px))', height: 'min(900px, calc(100vh - 32px))' }}>
        <div className="modal-h">
          <NetworkIcon className="size-5" style={{ color: 'var(--accent)' }} />
          <span className="t">FAQ 그래프</span>
          <span className="badge outline">선택 기능</span>
          <div className="grow" />
          <Button type="button" variant="ghost" size="icon" onClick={onClose} aria-label="닫기">
            <XIcon className="size-4" />
          </Button>
        </div>
        <div className="modal-b" style={{ overflow: 'auto' }}>
          {error && <div className="alert error" style={{ marginBottom: 12 }}>{error}</div>}
          {!config ? (
            <div className="empty">{busy === 'load' ? '설정을 불러오는 중입니다.' : '설정을 불러오지 못했습니다.'}</div>
          ) : (
            <div className="graph-manager-grid">
              <section className="card graph-manager-settings">
                <div className="row" style={{ gap: 10, marginBottom: 12 }}>
                  <div>
                    <div style={{ fontWeight: 700 }}>워크스페이스 그래프 설정</div>
                    <div className="muted" style={{ marginTop: 3 }}>기존 검색은 유지하고 그래프 경로를 후보 점수에 보탭니다.</div>
                  </div>
                  <div className="grow" />
                  <span className="badge outline">스키마 v{config.schema_version}</span>
                </div>
                <div className="graph-manager-toggles">
                  <label className="check-row">
                    <input
                      type="checkbox"
                      checked={config.enabled}
                      onChange={(event) => setConfig({ ...config, enabled: event.target.checked })}
                    />
                    <span><strong>FAQ 그래프 사용</strong><small>그래프 결합 조회를 허용합니다.</small></span>
                  </label>
                  <label className="check-row">
                    <input
                      type="checkbox"
                      checked={config.auto_sync}
                      onChange={(event) => setConfig({ ...config, auto_sync: event.target.checked })}
                    />
                    <span><strong>변경 시 자동 갱신</strong><small>FAQ와 찾기 힌트 변경을 반영합니다.</small></span>
                  </label>
                </div>
                <label className="check-row" style={{ marginTop: 12 }}>
                  <input
                    type="checkbox"
                    checked={config.precision_mode}
                    onChange={(event) => setConfig({ ...config, precision_mode: event.target.checked })}
                  />
                  <ShieldCheckIcon className="size-4" style={{ color: 'var(--success)' }} />
                  <span>
                    <strong>확실한 경우만 답변</strong>
                    <small>최소 점수와 근거 기준을 통과하면 가장 높은 후보를 선택합니다.</small>
                  </span>
                </label>
                {config.precision_mode && (
                  <div className="grid3" style={{ marginTop: 12 }}>
                    <label className="field">
                      <span>최소 답변 점수</span>
                      <Input
                        type="number"
                        min={0}
                        max={1}
                        step={0.01}
                        value={config.precision_min_score}
                        onChange={(event) => setConfig({ ...config, precision_min_score: Number(event.target.value) })}
                      />
                    </label>
                    <label className="field">
                      <span>후보 접전 표시 기준</span>
                      <Input
                        type="number"
                        min={0}
                        max={1}
                        step={0.01}
                        value={config.min_score_margin}
                        onChange={(event) => setConfig({ ...config, min_score_margin: Number(event.target.value) })}
                      />
                    </label>
                    <label className="field">
                      <span>분야 접전 표시 기준</span>
                      <Input
                        type="number"
                        min={0}
                        max={1}
                        step={0.01}
                        value={config.min_category_margin}
                        onChange={(event) => setConfig({ ...config, min_category_margin: Number(event.target.value) })}
                      />
                    </label>
                    <label className="field">
                      <span>필수 근거 종류 수</span>
                      <select
                        className={selectClass}
                        value={config.min_evidence_sources}
                        onChange={(event) => setConfig({ ...config, min_evidence_sources: Number(event.target.value) })}
                      >
                        <option value={1}>1</option>
                        <option value={2}>2</option>
                        <option value={3}>3</option>
                      </select>
                    </label>
                    <label className="field">
                      <span>최소 AI 신뢰도</span>
                      <Input
                        type="number"
                        min={0}
                        max={1}
                        step={0.01}
                        value={config.llm_min_confidence}
                        onChange={(event) => setConfig({ ...config, llm_min_confidence: Number(event.target.value) })}
                      />
                    </label>
                  </div>
                )}
                <div className="grid3" style={{ marginTop: 12 }}>
                  <label className="field">
                    <span>그래프 점수 반영 비율</span>
                    <Input
                      type="number"
                      min={0}
                      max={1}
                      step={0.05}
                      value={config.graph_weight}
                      onChange={(event) => setConfig({ ...config, graph_weight: Number(event.target.value) })}
                    />
                  </label>
                  <label className="field">
                    <span>최소 그래프 유사도</span>
                    <Input
                      type="number"
                      min={0}
                      max={1}
                      step={0.05}
                      value={config.min_similarity}
                      onChange={(event) => setConfig({ ...config, min_similarity: Number(event.target.value) })}
                    />
                  </label>
                  <label className="field">
                    <span>최대 관계 단계</span>
                    <select
                      className={selectClass}
                      value={config.max_hops}
                      onChange={(event) => setConfig({ ...config, max_hops: Number(event.target.value) })}
                    >
                      <option value={1}>1</option>
                      <option value={2}>2</option>
                      <option value={3}>3</option>
                    </select>
                  </label>
                </div>
                <label className="field" style={{ marginTop: 12 }}>
                  <span>엔티티 유형</span>
                  <textarea className="textarea" rows={3} value={entityTypes} onChange={(event) => setEntityTypes(event.target.value)} />
                </label>
                <label className="field" style={{ marginTop: 12 }}>
                  <span>관계 유형</span>
                  <textarea className="textarea" rows={3} value={relationTypes} onChange={(event) => setRelationTypes(event.target.value)} />
                </label>
                <label className="field" style={{ marginTop: 12 }}>
                  <span>AI 추출 참고 프롬프트</span>
                  <textarea className="textarea code" rows={8} value={prompt} onChange={(event) => setPrompt(event.target.value)} />
                </label>
                <div className="row end" style={{ marginTop: 12 }}>
                  <Button type="button" onClick={save} disabled={Boolean(busy)}>
                    {busy === 'save' ? <Loader2Icon className="spin size-4" /> : <SaveIcon className="size-4" />}
                    설정 저장
                  </Button>
                </div>
              </section>

              <section className="card graph-manager-preview">
                <div className="row wrap" style={{ gap: 9 }}>
                  <div>
                    <div style={{ fontWeight: 700 }}>미리보기 및 구축</div>
                    <div className="muted" style={{ marginTop: 3 }}>
                      사용 가능 {status?.ready || 0} · 갱신 필요 {status?.stale || 0} · 미구축 {status?.missing || 0} · 실패 {status?.failed || 0}
                    </div>
                  </div>
                  <div className="grow" />
                  <Button type="button" variant="outline" onClick={load}>
                    <RefreshCwIcon className="size-4" /> 새로고침
                  </Button>
                </div>
                <div className="grid2" style={{ marginTop: 14 }}>
                  <label className="field">
                    <span>미리 볼 FAQ</span>
                    <select className={selectClass} value={answerId} onChange={(event) => setAnswerId(event.target.value)}>
                      {answers.map((answer) => (
                        <option key={answer.answer_id} value={answer.answer_id}>{answer.title}</option>
                      ))}
                    </select>
                  </label>
                  <label className="check-row compact">
                    <input type="checkbox" checked={useLlm} onChange={(event) => setUseLlm(event.target.checked)} />
                    <span><strong>AI 추출 보완</strong><small>필요할 때만 사용합니다.</small></span>
                  </label>
                </div>
                <div className="row wrap" style={{ gap: 8, marginTop: 12 }}>
                  <Button type="button" variant="outline" onClick={runPreview} disabled={!answerId || Boolean(busy)}>
                    {busy === 'preview' ? <Loader2Icon className="spin size-4" /> : <EyeIcon className="size-4" />}
                    미리보기
                  </Button>
                  <Button type="button" onClick={rebuild} disabled={!config.enabled || Boolean(busy)}>
                    {busy === 'rebuild' ? <Loader2Icon className="spin size-4" /> : <NetworkIcon className="size-4" />}
                    미구축·변경 FAQ 구축
                  </Button>
                </div>

                {task && (
                  <div className="graph-task-status">
                    <div className="row" style={{ gap: 8 }}>
                      {['pending', 'running'].includes(task.status) && <Loader2Icon className="spin size-4" />}
                      <strong>{task.status}</strong>
                      <span>{Math.round(Number(task.progress || 0))}%</span>
                    </div>
                    <div className="muted">{task.message || task.task_id}</div>
                  </div>
                )}

                {!preview ? (
                  <div className="empty graph-preview-empty">
                    FAQ를 선택하고 미리보기를 실행하면 저장 전에 노드와 관계를 확인할 수 있습니다.
                  </div>
                ) : (
                  <div className="graph-preview-content">
                    <div className="row wrap" style={{ gap: 7 }}>
                      <span className="badge outline">{preview.answer_id}</span>
                      <span className="badge gray">노드 {preview.nodes?.length || 0}</span>
                      <span className="badge gray">관계 {preview.relations?.length || 0}</span>
                    </div>
                    <div className="graph-node-grid">
                      {(preview.nodes || []).map((node: any) => (
                        <div key={node.node_id} className="graph-node">
                          <strong>{node.label}</strong>
                          <span className="badge outline">{node.entity_type}</span>
                        </div>
                      ))}
                    </div>
                    <div className="graph-relation-list">
                      {(preview.relations || []).map((relation: any, index: number) => (
                        <div key={`${relation.source_id}-${relation.target_id}-${index}`}>
                          <span>{String(relation.source_id).split('::').pop()}</span>
                          <span className="badge outline">{relation.relation_type}</span>
                          <span>{String(relation.target_id).split('::').pop()}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </section>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

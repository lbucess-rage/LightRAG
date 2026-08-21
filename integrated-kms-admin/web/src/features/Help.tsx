import { useEffect, useMemo, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import {
  BookOpenIcon,
  CheckCircleIcon,
  ChevronRightIcon,
  EyeOffIcon,
  FileImageIcon,
  HelpCircleIcon,
  SearchIcon,
  SettingsIcon,
  ShieldIcon,
  UsersIcon
} from 'lucide-react'
import { toast } from 'sonner'
import { api } from '@/api/client'
import { useAuthStore } from '@/stores/auth'

type HelpRole = 'user' | 'manager' | 'admin'

type HelpScreenshot = {
  screenshot_id: string
  file_path: string
  caption: string
  sort_order: number
}

type HelpTopic = {
  help_id: string
  nav_key: string
  menu_label: string
  title: string
  summary: string
  body_md: string
  status: 'draft' | 'review' | 'published' | 'hidden'
  sort_order: number
  visibility: Record<HelpRole, boolean>
  screenshots: HelpScreenshot[]
  update_time?: string
}

export const HELP_TOPICS_CHANGED_EVENT = 'kms-admin:help-topics-changed'
export const OPEN_HELP_TOPIC_EVENT = 'kms-admin:open-help-topic'

export const helpTopicSummaries: Record<string, { title: string; summary: string; menu: string }> = {
  'HELP-SEARCH-001': {
    menu: '통합 검색',
    title: '통합 검색 사용하기',
    summary: '질문 하나로 AI 답변과 FAQ 답변을 함께 확인하는 기본 흐름입니다.'
  },
  'HELP-SEARCH-002': {
    menu: '통합 검색',
    title: '카테고리로 검색 범위 좁히기',
    summary: '특정 업무 영역이나 문의 유형 안에서만 검색할 때 사용합니다.'
  },
  'HELP-SEARCH-003': {
    menu: '통합 검색',
    title: '근거 지식 확인하기',
    summary: '답변 번호와 근거 지식, 원문 보기의 관계를 확인합니다.'
  },
  'HELP-SEARCH-004': {
    menu: '통합 검색',
    title: '검색 후보 적용 내역 이해하기',
    summary: '유효기간이나 사용 여부 때문에 제외된 지식이 있는지 확인합니다.'
  },
  'HELP-SEARCH-005': {
    menu: '통합 검색',
    title: 'FAQ 그래프 결합 검색과 공통 용어 이해하기',
    summary: '기본 통합 검색에서 키워드, 벡터, FAQ 그래프와 승인된 공통 용어가 함께 적용되고 폴백 상태가 표시되는 방식을 확인합니다.'
  },
  'HELP-KNOWLEDGE-001': {
    menu: '지식 관리',
    title: '지식 관리 화면 이해하기',
    summary: '지식 목록, 등록 방식, 원장 연결 상태를 확인하는 시작 화면입니다.'
  },
  'HELP-KNOWLEDGE-002': {
    menu: '지식 관리',
    title: '지식 추가 전 필수 설정',
    summary: '카테고리, 유효기간, 답변 후보 사용 여부를 먼저 정합니다.'
  },
  'HELP-KNOWLEDGE-003': {
    menu: '지식 관리',
    title: '파일 업로드로 지식 등록하기',
    summary: 'PDF, 문서, 텍스트 파일을 검색 가능한 지식으로 등록합니다.'
  },
  'HELP-KNOWLEDGE-004': {
    menu: '지식 관리',
    title: '텍스트 지식 등록하기',
    summary: '짧은 안내문이나 처리 기준을 본문 텍스트로 바로 등록합니다.'
  },
  'HELP-KNOWLEDGE-005': {
    menu: '지식 관리',
    title: '여러 텍스트를 한 번에 등록하기',
    summary: '여러 안내문이나 기준을 한 번에 묶어 등록합니다.'
  },
  'HELP-KNOWLEDGE-006': {
    menu: '지식 관리',
    title: 'URL 지식 등록하기',
    summary: '웹 페이지 하나를 수집해 지식으로 등록합니다.'
  },
  'HELP-KNOWLEDGE-007': {
    menu: '지식 관리',
    title: 'URL 묶음 등록하기',
    summary: '여러 URL을 비동기 작업으로 한 번에 등록합니다.'
  },
  'HELP-KNOWLEDGE-008': {
    menu: '지식 관리',
    title: '게시판 API로 지식 등록하기',
    summary: '외부 목록 API를 필드 매핑으로 수집합니다.'
  },
  'HELP-KNOWLEDGE-009': {
    menu: '지식 관리',
    title: '멀티모달 문서 등록하기',
    summary: '이미지, 표, 수식이 포함된 문서를 멀티모달 방식으로 처리합니다.'
  },
  'HELP-KNOWLEDGE-010': {
    menu: '지식 관리',
    title: '이미지 지식 등록하기',
    summary: '이미지 한 장을 검색 근거로 사용할 수 있게 등록합니다.'
  },
  'HELP-KNOWLEDGE-011': {
    menu: '지식 관리',
    title: 'FAQ 답변과 첨부 자료 등록하기',
    summary: '정해진 질문과 답변을 등록하고 이미지, 영상, 음성, 표 또는 파일을 함께 제공합니다.'
  },
  'HELP-KNOWLEDGE-012': {
    menu: '지식 관리',
    title: 'FAQ 소스 초안 등록하기',
    summary: '원문과 가이드 후보를 저장해 검수 가능한 초안을 만듭니다.'
  },
  'HELP-KNOWLEDGE-013': {
    menu: '지식 관리',
    title: '기존 LightRAG 지식 연결하기',
    summary: '이미 있는 워크스페이스 지식을 어드민 원장에 연결합니다.'
  },
  'HELP-KNOWLEDGE-014': {
    menu: '지식 관리',
    title: '지식화 진행률 확인하기',
    summary: '등록 작업이 어디까지 진행됐는지 최근 작업에서 확인합니다.'
  },
  'HELP-KNOWLEDGE-015': {
    menu: '지식 관리',
    title: '지식 목록과 페이징 사용하기',
    summary: '지식 목록을 필터링하고 페이지 단위로 탐색합니다.'
  },
  'HELP-KNOWLEDGE-016': {
    menu: '지식 관리',
    title: 'Excel과 DB 표에서 FAQ 일괄 생성하기',
    summary: '표의 각 행을 FAQ로 바꾸고 열 연결, ID 조회형 FAQ와 AI 힌트 보완을 설정합니다.'
  },
  'HELP-KNOWLEDGE-017': {
    menu: '지식 관리',
    title: 'FAQ 공통 용어와 AI 후보 관리하기',
    summary: '동의어를 직접 등록하거나 AI가 찾은 후보를 승인해 여러 FAQ 검색에 함께 적용합니다.'
  },
  'HELP-KNOWLEDGE-018': {
    menu: '지식 관리',
    title: 'FAQ 그래프 구성과 그래프 결합 검색 사용하기',
    summary: 'FAQ 연결 근거를 구성하고, 확실한 경우만 답변하도록 점수·근거·후보 차이 기준을 관리합니다.'
  },
  'HELP-CATEGORY-001': {
    menu: '카테고리',
    title: '카테고리와 하위 카테고리 관리하기',
    summary: '지식을 업무 주제별 트리로 분류하고 하위 범위를 관리합니다.'
  },
  'HELP-JOBS-001': {
    menu: '작업 이력',
    title: '작업 이력 확인하기',
    summary: '지식 등록, 재처리, 롤백 결과와 메시지를 확인합니다.'
  },
  'HELP-STATS-001': {
    menu: '현황 · 통계',
    title: '현황과 통계 확인하기',
    summary: '검색량, 키워드, 카테고리, 외부 API 사용 현황을 봅니다.'
  },
  'HELP-EXTERNAL-001': {
    menu: 'API 관리',
    title: '외부 시스템 API 연동하기',
    summary: '타 시스템이 어드민 통합 검색 API를 호출하도록 연결합니다.'
  },
  'HELP-USERS-001': {
    menu: '사용자 관리',
    title: '사용자 계정 관리하기',
    summary: '사용자 생성, 권한, 고객센터 매핑, 비밀번호를 관리합니다.'
  },
  'HELP-TENANTS-001': {
    menu: '고객센터 관리',
    title: '고객센터 관리하기',
    summary: '고객센터별 KMS/FAQ 워크스페이스 페어를 관리합니다.'
  },
  'HELP-SYSTEM-001': {
    menu: '시스템',
    title: '시스템 상태 확인하기',
    summary: '어드민 API, DB, LightRAG 연동, 워크스페이스 상태를 확인합니다.'
  }
}

const roleOptions: Array<{ role: HelpRole; label: string; icon: typeof UsersIcon }> = [
  { role: 'user', label: '일반 사용자', icon: UsersIcon },
  { role: 'manager', label: '지식 관리자', icon: BookOpenIcon },
  { role: 'admin', label: '시스템 관리자', icon: ShieldIcon }
]

const statusOptions = [
  { value: 'draft', label: '작성중' },
  { value: 'review', label: '검수중' },
  { value: 'published', label: '게시' },
  { value: 'hidden', label: '숨김' }
] as const

function roleLabel(role?: string) {
  if (role === 'admin') return '시스템 관리자'
  if (role === 'manager') return '지식 관리자'
  return '일반 사용자'
}

function statusLabel(status: HelpTopic['status']) {
  return statusOptions.find((option) => option.value === status)?.label || status
}

function statusBadgeClass(status: HelpTopic['status']) {
  if (status === 'published') return 'badge green'
  if (status === 'review') return 'badge amber'
  if (status === 'hidden') return 'badge gray'
  return 'badge'
}

function normalizeRole(role?: string): HelpRole {
  if (role === 'admin' || role === 'manager') return role
  return 'user'
}

export function openHelpTopic(helpId: string) {
  window.dispatchEvent(new CustomEvent(OPEN_HELP_TOPIC_EVENT, { detail: { helpId } }))
}

export function RelatedHelp({ topicIds }: { topicIds: string[] }) {
  const [open, setOpen] = useState(false)
  const topics = topicIds.map((helpId) => ({ helpId, ...helpTopicSummaries[helpId] })).filter((topic) => topic.title)
  if (!topics.length) return null

  return (
    <div className="related-help">
      <button className="btn related-help-trigger" type="button" onClick={() => setOpen((value) => !value)}>
        <HelpCircleIcon className="size-4" /> 관련 도움말
      </button>
      {open && (
        <div className="related-help-panel">
          <div className="related-help-head">
            <b>이 화면의 도움말</b>
            <button type="button" onClick={() => setOpen(false)}>
              닫기
            </button>
          </div>
          <div className="related-help-list">
            {topics.map((topic) => (
              <div key={topic.helpId} className="related-help-item">
                <span>{topic.menu}</span>
                <b>{topic.title}</b>
                <p>{topic.summary}</p>
                <button
                  type="button"
                  onClick={() => {
                    openHelpTopic(topic.helpId)
                    setOpen(false)
                  }}
                >
                  자세히 보기 <ChevronRightIcon className="size-3" />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function ScreenshotPreview({ screenshot }: { screenshot: HelpScreenshot }) {
  const [failed, setFailed] = useState(false)
  return (
    <figure className="help-screenshot">
      {!failed ? (
        <img src={screenshot.file_path} alt={screenshot.caption || '도움말 화면'} onError={() => setFailed(true)} />
      ) : (
        <div className="help-screenshot-missing">
          <FileImageIcon className="size-8" />
          <b>스크린샷 준비 필요</b>
          <span>{screenshot.file_path}</span>
        </div>
      )}
      <figcaption>{screenshot.caption || screenshot.file_path}</figcaption>
    </figure>
  )
}

function groupTopics(topics: HelpTopic[]) {
  return topics.reduce<Record<string, HelpTopic[]>>((groups, topic) => {
    groups[topic.menu_label] = groups[topic.menu_label] || []
    groups[topic.menu_label].push(topic)
    return groups
  }, {})
}

export function helpBodyForRole(body: string, role: HelpRole) {
  if (role === 'admin') return body
  return body.replace(
    /(^|\n)\| 항목 \| 내용 \|\n\| --- \| --- \|\n(?:\| .+ \|\n)+(?=\n### )/,
    '\n'
  )
}

export function HelpCenter({ focusHelpId = '' }: { focusHelpId?: string }) {
  const user = useAuthStore((state) => state.user)
  const currentRole = normalizeRole(user?.role)
  const [previewRole, setPreviewRole] = useState<HelpRole>(currentRole)
  const [topics, setTopics] = useState<HelpTopic[]>([])
  const [selectedId, setSelectedId] = useState<string>('')
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(false)
  const [refreshVersion, setRefreshVersion] = useState(0)

  const canPreviewRoles = currentRole === 'admin'
  const effectiveRole = canPreviewRoles ? previewRole : currentRole

  useEffect(() => {
    setPreviewRole(currentRole)
  }, [currentRole])

  useEffect(() => {
    if (focusHelpId && canPreviewRoles) {
      setPreviewRole(currentRole)
    }
  }, [canPreviewRoles, currentRole, focusHelpId])

  useEffect(() => {
    const refreshHelpTopics = () => setRefreshVersion((version) => version + 1)
    window.addEventListener(HELP_TOPICS_CHANGED_EVENT, refreshHelpTopics)
    return () => window.removeEventListener(HELP_TOPICS_CHANGED_EVENT, refreshHelpTopics)
  }, [])

  useEffect(() => {
    setLoading(true)
    api
      .get('/api/help/topics', { params: canPreviewRoles ? { role: effectiveRole } : undefined })
      .then((response) => {
        const nextTopics = response.data.topics || []
        setTopics(nextTopics)
        setSelectedId((current) => (nextTopics.some((topic: HelpTopic) => topic.help_id === current) ? current : nextTopics[0]?.help_id || ''))
      })
      .catch(() => toast.error('도움말을 불러오지 못했습니다.'))
      .finally(() => setLoading(false))
  }, [canPreviewRoles, effectiveRole, refreshVersion])

  useEffect(() => {
    if (!focusHelpId) return
    if (topics.some((topic) => topic.help_id === focusHelpId)) {
      setSelectedId(focusHelpId)
    }
  }, [focusHelpId, topics])

  const filteredTopics = useMemo(() => {
    const normalized = query.trim().toLowerCase()
    if (!normalized) return topics
    return topics.filter((topic) => {
      const text = `${topic.menu_label} ${topic.title} ${topic.summary} ${topic.body_md}`.toLowerCase()
      return text.includes(normalized)
    })
  }, [query, topics])
  const grouped = groupTopics(filteredTopics)
  const selected = filteredTopics.find((topic) => topic.help_id === selectedId) || filteredTopics[0]

  return (
    <div className="content-inner wide fadein">
      <div className="page-head">
        <div>
          <h1>기능 도움말</h1>
          <p>현재 권한에서 사용할 수 있는 기능을 쉬운 설명과 화면 기준으로 확인합니다.</p>
        </div>
        {canPreviewRoles && (
          <div className="seg">
            {roleOptions.map(({ role, label }) => (
              <button key={role} className={effectiveRole === role ? 'on' : ''} onClick={() => setPreviewRole(role)}>
                {label}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="help-shell">
        <aside className="help-index card">
          <div className="help-index-head">
            <div>
              <b>{roleLabel(effectiveRole)} 도움말</b>
              <span>{filteredTopics.length}개 항목</span>
            </div>
          </div>
          <label className="field">
            <span>도움말 검색</span>
            <div className="searchbox">
              <SearchIcon className="size-4" />
              <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="기능명이나 설명 검색" />
            </div>
          </label>
          <div className="help-topic-list">
            {Object.entries(grouped).map(([menu, menuTopics]) => (
              <div key={menu} className="help-topic-group">
                <div className="help-topic-group-title">{menu}</div>
                {menuTopics.map((topic) => (
                  <button
                    key={topic.help_id}
                    className={`help-topic-item ${selected?.help_id === topic.help_id ? 'active' : ''}`}
                    onClick={() => setSelectedId(topic.help_id)}
                  >
                    <span>{topic.title}</span>
                    <small>{topic.summary}</small>
                  </button>
                ))}
              </div>
            ))}
            {!filteredTopics.length && <div className="empty">표시할 도움말이 없습니다.</div>}
          </div>
        </aside>

        <main className="help-detail card">
          {loading && !selected ? (
            <div className="empty">도움말을 불러오는 중입니다.</div>
          ) : selected ? (
            <>
              <div className="help-detail-head">
                <div>
                  <span className="badge blue">{selected.menu_label}</span>
                  <h2>{selected.title}</h2>
                  <p>{selected.summary}</p>
                </div>
                <span className="badge gray">{roleLabel(effectiveRole)} 기준</span>
              </div>
              <div className="help-screenshots">
                {selected.screenshots.map((screenshot) => (
                  <ScreenshotPreview key={screenshot.screenshot_id} screenshot={screenshot} />
                ))}
              </div>
              <article className="help-article">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{helpBodyForRole(selected.body_md, effectiveRole)}</ReactMarkdown>
              </article>
            </>
          ) : (
            <div className="empty">표시할 도움말이 없습니다.</div>
          )}
        </main>
      </div>
    </div>
  )
}

export function HelpAdmin() {
  const [topics, setTopics] = useState<HelpTopic[]>([])
  const [query, setQuery] = useState('')
  const [savingId, setSavingId] = useState<string>('')

  function loadTopics() {
    api
      .get('/api/help/admin/topics')
      .then((response) => setTopics(response.data.topics || []))
      .catch(() => toast.error('도움말 관리 목록을 불러오지 못했습니다.'))
  }

  useEffect(() => {
    loadTopics()
  }, [])

  const filteredTopics = useMemo(() => {
    const normalized = query.trim().toLowerCase()
    if (!normalized) return topics
    return topics.filter((topic) => `${topic.help_id} ${topic.menu_label} ${topic.title} ${topic.summary}`.toLowerCase().includes(normalized))
  }, [query, topics])

  async function patchTopic(helpId: string, payload: Record<string, unknown>) {
    setSavingId(helpId)
    try {
      const response = await api.patch(`/api/help/admin/topics/${encodeURIComponent(helpId)}`, payload)
      const updated = response.data.topic as HelpTopic
      setTopics((current) => current.map((topic) => (topic.help_id === helpId ? updated : topic)))
      window.dispatchEvent(new CustomEvent(HELP_TOPICS_CHANGED_EVENT, { detail: { helpId } }))
      toast.success('도움말 설정을 저장했습니다.')
    } catch {
      toast.error('도움말 설정 저장에 실패했습니다.')
    } finally {
      setSavingId('')
    }
  }

  return (
    <div className="content-inner wide fadein">
      <div className="page-head">
        <div>
          <h1>도움말 관리</h1>
          <p>기능 도움말의 게시 상태와 권한별 노출 여부를 운영 중에 조정합니다.</p>
        </div>
        <button className="btn" onClick={loadTopics}>
          새로고침
        </button>
      </div>

      <div className="card help-admin-toolbar">
        <div>
          <b>노출 관리</b>
          <p>테스트가 덜 되었거나 보강 중인 기능은 `검수중` 또는 권한별 숨김으로 조정합니다.</p>
        </div>
        <label className="field">
          <span>검색</span>
          <input className="input" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="도움말 ID, 메뉴, 제목 검색" />
        </label>
      </div>

      <div className="card table-scroll help-admin-table-wrap">
        <table className="tbl help-admin-table">
          <thead>
            <tr>
              <th>도움말</th>
              <th>상태</th>
              <th>권한별 노출</th>
              <th>스크린샷</th>
              <th>수정</th>
            </tr>
          </thead>
          <tbody>
            {filteredTopics.map((topic) => (
              <tr key={topic.help_id}>
                <td>
                  <div className="help-topic-cell">
                    <span className="badge gray">{topic.menu_label}</span>
                    <b>{topic.title}</b>
                    <small>{topic.help_id}</small>
                    <p>{topic.summary}</p>
                  </div>
                </td>
                <td>
                  <select
                    className="select"
                    value={topic.status}
                    disabled={savingId === topic.help_id}
                    onChange={(event) => patchTopic(topic.help_id, { status: event.target.value })}
                  >
                    {statusOptions.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                  <div className={statusBadgeClass(topic.status)}>{statusLabel(topic.status)}</div>
                </td>
                <td>
                  <div className="help-role-toggles">
                    {roleOptions.map(({ role, label, icon: Icon }) => (
                      <label key={role} className="help-role-toggle">
                        <input
                          type="checkbox"
                          checked={Boolean(topic.visibility?.[role])}
                          disabled={savingId === topic.help_id}
                          onChange={(event) =>
                            patchTopic(topic.help_id, {
                              visibility: { [role]: event.target.checked }
                            })
                          }
                        />
                        <Icon className="size-4" />
                        <span>{label}</span>
                      </label>
                    ))}
                  </div>
                </td>
                <td>
                  <div className="help-shot-paths">
                    {topic.screenshots.map((screenshot) => (
                      <span key={screenshot.screenshot_id}>{screenshot.file_path}</span>
                    ))}
                    {!topic.screenshots.length && <span>스크린샷 미지정</span>}
                  </div>
                </td>
                <td>
                  {savingId === topic.help_id ? (
                    <span className="badge blue">
                      <SettingsIcon className="size-3" /> 저장중
                    </span>
                  ) : topic.status === 'published' ? (
                    <span className="badge green">
                      <CheckCircleIcon className="size-3" /> 게시
                    </span>
                  ) : (
                    <span className="badge gray">
                      <EyeOffIcon className="size-3" /> {statusLabel(topic.status)}
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!filteredTopics.length && (
          <div className="empty">
            <HelpCircleIcon className="size-8" />
            조건에 맞는 도움말이 없습니다.
          </div>
        )}
      </div>
    </div>
  )
}

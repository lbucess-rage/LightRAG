import { FormEvent, useEffect, useMemo, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import {
  BookOpenIcon,
  CheckIcon,
  ChevronRightIcon,
  DownloadIcon,
  ExternalLinkIcon,
  FilterIcon,
  FileTextIcon,
  ImageIcon,
  InfoIcon,
  LanguagesIcon,
  RotateCcwIcon,
  SearchIcon,
  SlidersHorizontalIcon,
  SparklesIcon,
  TagIcon,
  XIcon
} from 'lucide-react'
import { api } from '@/api/client'
import WorkspaceSelect from '@/components/WorkspaceSelect'
import Button from '@/components/ui/Button'
import { RelatedHelp } from '@/features/Help'
import { canChooseWorkspace, resolveEffectiveWorkspaceScope } from '@/lib/workspaceAccess'
import { useAuthStore } from '@/stores/auth'
import { useWorkspaceScopeStore } from '@/stores/workspaceScope'

type Category = {
  category_id: string
  parent_id?: string | null
  name: string
  path: string
  is_active: boolean
  total_knowledge_count?: number
}

type QueryMode = 'naive' | 'local' | 'global' | 'hybrid' | 'mix' | 'bypass'

type KmsSearchOptions = {
  mode: QueryMode
  response_type: string
  top_k: number
  chunk_top_k: number
  include_references: boolean
  include_chunk_content: boolean
  highlight_entities: boolean
  enable_rerank: boolean
}

type FaqRetrievalMode = 'keyword' | 'vector' | 'hybrid' | 'llm_rerank'

type FaqSearchOptions = {
  retrieval_mode: FaqRetrievalMode
  top_k: number
  min_score: number
  include_candidates: boolean
}

type ReferencePreviewState = {
  kind: 'document' | 'board'
  title: string
  loading: boolean
  error: string
  data: any
}

const BRIEF_ANSWER_RESPONSE_TYPE = "Brief answer: MAXIMUM 5 bullet points using '- ' (hyphen+space). Each point is one concise line. Fewer is better."

const DEFAULT_KMS_OPTIONS: KmsSearchOptions = {
  mode: 'mix',
  response_type: BRIEF_ANSWER_RESPONSE_TYPE,
  top_k: 40,
  chunk_top_k: 20,
  include_references: true,
  include_chunk_content: true,
  highlight_entities: true,
  enable_rerank: true
}

const DEFAULT_FAQ_OPTIONS: FaqSearchOptions = {
  retrieval_mode: 'hybrid',
  top_k: 5,
  min_score: 0.18,
  include_candidates: true
}

const queryModeOptions: Array<{ value: QueryMode; label: string }> = [
  { value: 'mix', label: 'Mix' },
  { value: 'hybrid', label: 'Hybrid' },
  { value: 'global', label: 'Global' },
  { value: 'local', label: 'Local' },
  { value: 'naive', label: 'Naive' },
  { value: 'bypass', label: 'Bypass' }
]

const responseFormatOptions = [
  { value: BRIEF_ANSWER_RESPONSE_TYPE, label: '간단한 답변' },
  { value: "A single short paragraph, maximum 3 sentences. No bullet points.", label: '단일 단락' },
  { value: "Multiple paragraphs using markdown '- ' bullet lists. Each paragraph covers one subtopic with a bold heading.", label: '여러 단락' },
  { value: "Markdown bullet list using '- ' (hyphen+space). One fact per line. Maximum 10 items.", label: '글머리 기호' },
  { value: "Numbered list using '1. ', '2. ', etc. One fact per line.", label: '번호 목록' },
  { value: "Executive summary: 2-3 sentences covering the most critical points only.", label: '요약 보고서' }
]

function responseFormatLabel(value: string) {
  return responseFormatOptions.find((option) => option.value === value)?.label || value
}

function categoryLabel(category: Category) {
  return category.path.split('/').filter(Boolean).join(' > ') || category.name
}

function textFromGenerative(result: any) {
  return (
    result?.generative_answer?.response ||
    result?.generative_answer?.answer ||
    result?.generative_answer?.result ||
    '생성형 답변 결과가 없습니다.'
  )
}

function faqTitle(item: any) {
  return item.title || item.answer?.title || item.question || 'FAQ 후보'
}

function faqBody(item: any) {
  return item.response || item.body || item.answer?.body || item.answer?.approved_summary || item.approved_summary || '본문이 없습니다.'
}

function faqCandidateList(item: any) {
  for (const key of ['candidates', 'candidate_results', 'answer_candidates', 'related_candidates']) {
    if (Array.isArray(item?.[key])) return item[key].filter(Boolean)
  }
  return []
}

function faqCandidateAnswer(candidate: any) {
  return candidate?.answer || candidate?.selected_answer || candidate?.answer_item || candidate
}

function faqCandidateId(candidate: any, index: number) {
  const answer = faqCandidateAnswer(candidate)
  return String(answer?.answer_id || candidate?.answer_id || candidate?.id || index + 1)
}

function faqCandidateTitle(candidate: any, index: number) {
  const answer = faqCandidateAnswer(candidate)
  return answer?.title || candidate?.title || candidate?.question || `FAQ 후보 ${index + 1}`
}

function faqCandidateBody(candidate: any) {
  const answer = faqCandidateAnswer(candidate)
  return (
    candidate?.response ||
    candidate?.summary ||
    answer?.approved_summary ||
    answer?.summary ||
    answer?.body ||
    candidate?.reason ||
    '후보 본문이 없습니다.'
  )
}

function faqCandidateGuidance(candidate: any) {
  if (Array.isArray(candidate?.matched_guidance)) return candidate.matched_guidance
  if (Array.isArray(candidate?.guidance)) return candidate.guidance
  if (Array.isArray(candidate?.answer?.matched_guidance)) return candidate.answer.matched_guidance
  return []
}

function scorePercent(item: any) {
  const score = Number(item.score ?? item.confidence ?? item.similarity ?? 0)
  if (!Number.isFinite(score) || score <= 0) return null
  return Math.round(score <= 1 ? score * 100 : score)
}

function safeString(value: unknown) {
  if (value === null || value === undefined) return ''
  if (typeof value === 'string') return value
  if (typeof value === 'object') {
    const objectValue = value as Record<string, unknown>
    for (const key of ['description', 'summary', 'text', 'raw']) {
      const field = objectValue[key]
      if (typeof field === 'string') return field
    }
  }
  return String(value)
}

function referenceId(reference: any, index: number) {
  return String(reference.reference_id || reference.id || index + 1)
}

function referenceAnchorId(refId: string) {
  return `kms-reference-${refId.replace(/[^a-zA-Z0-9_-]/g, '-')}`
}

function clearReferenceHash() {
  if (window.location.hash.startsWith('#kms-reference-')) {
    window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}`)
  }
}

function referenceTitle(reference: any) {
  return reference.title || reference.doc_nm || reference.file_name || reference.file_path || reference.doc_id || '참조 문서'
}

function numericScore(value: unknown) {
  const score = Number(value)
  return Number.isFinite(score) ? score : null
}

function referenceScore(reference: any) {
  const ownScore = numericScore(reference?.score)
  if (ownScore !== null) return ownScore

  const scoreCandidates: number[] = []
  if (Array.isArray(reference?.scores)) {
    reference.scores.forEach((score: unknown) => {
      const parsed = numericScore(score)
      if (parsed !== null) scoreCandidates.push(parsed)
    })
  }
  if (Array.isArray(reference?.structured_content)) {
    reference.structured_content.forEach((item: any) => {
      const parsed = numericScore(item?.score)
      if (parsed !== null) scoreCandidates.push(parsed)
    })
  }
  return scoreCandidates.length ? Math.max(...scoreCandidates) : null
}

function sortReferencesByScore(references: any[]) {
  return references
    .map((reference, index) => ({ reference, index, score: referenceScore(reference) }))
    .sort((a, b) => {
      if (a.score === null && b.score === null) return a.index - b.index
      if (a.score === null) return 1
      if (b.score === null) return -1
      if (a.score !== b.score) return b.score - a.score
      return a.index - b.index
    })
    .map((item) => item.reference)
}

function referenceFilePath(reference: any) {
  return typeof reference?.file_path === 'string' ? reference.file_path.trim() : ''
}

function isBoardReference(reference: any) {
  const filePath = referenceFilePath(reference)
  if (!/^https?:\/\//.test(filePath)) return false
  try {
    const url = new URL(filePath)
    return /\/api\/board(\/|$)/.test(url.pathname)
  } catch {
    return filePath.includes('/api/board/')
  }
}

function referenceEmbeddedText(reference: any) {
  const content = Array.isArray(reference?.content) ? reference.content.filter(Boolean).join('\n\n') : ''
  if (content.trim()) return content
  const structured = Array.isArray(reference?.structured_content) ? reference.structured_content : []
  return structured
    .map((item: any) => safeString(item?.content || item?.text || item?.analysis?.description || item?.entity?.summary))
    .filter(Boolean)
    .join('\n\n')
}

function previewText(data: any) {
  const content = safeString(data?.content)
  if (content.trim()) return content
  const chunks = Array.isArray(data?.chunks) ? data.chunks : []
  return chunks.map((chunk: any) => safeString(chunk?.content)).filter(Boolean).join('\n\n')
}

function prettyJson(value: unknown) {
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

function imageSource(image: any) {
  if (!image) return ''
  if (typeof image === 'object') {
    return image.s3_url || image.url || image.path || ''
  }
  const value = String(image)
  if (value.startsWith('data:') || value.startsWith('http')) return value
  return value ? `data:image/png;base64,${value}` : ''
}

function visualCaption(item: any) {
  return (
    safeString(item.analysis?.description) ||
    safeString(item.entity?.summary) ||
    (Array.isArray(item.image?.captions) ? item.image.captions.join(' ') : '')
  )
}

function visualPageLabel(item: any) {
  const pageIndex = item.source?.page_idx
  return Number.isFinite(Number(pageIndex)) ? `페이지 ${Number(pageIndex) + 1}` : ''
}

function referenceImages(reference: any) {
  const structured = Array.isArray(reference.structured_content) ? reference.structured_content : []
  const scores = Array.isArray(reference.scores) ? reference.scores : []
  const seen = new Set<string>()
  return structured
    .map((item: any, index: number) => ({
      item,
      index,
      src: item?.type === 'image' ? imageSource(item.image) : '',
      score: Number.isFinite(Number(item?.score)) ? Number(item.score) : Number.isFinite(Number(scores[index])) ? Number(scores[index]) : null,
      caption: visualCaption(item),
      page: visualPageLabel(item)
    }))
    .filter((visual) => {
      if (!visual.src || seen.has(visual.src)) return false
      seen.add(visual.src)
      return true
    })
    .sort((a, b) => {
      if (a.score === null && b.score === null) return 0
      if (a.score === null) return 1
      if (b.score === null) return -1
      return b.score - a.score
    })
}

function ReferenceImages({ reference }: { reference: any }) {
  const images = referenceImages(reference)
  if (!images.length) return null

  return (
    <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px solid var(--border-subtle)' }}>
      <div className="row" style={{ gap: 6, marginBottom: 8, color: 'var(--fg-secondary)', fontSize: 12.5, fontWeight: 700 }}>
        <ImageIcon className="size-4" /> 이미지 근거 {images.length}건
      </div>
      <div className="reference-image-grid">
        {images.map((visual) => (
          <div key={visual.src} className="reference-image-card">
            <div className="reference-image-meta">
              <span className="row" style={{ gap: 5 }}>
                <ImageIcon className="size-3" />
                {visual.score !== null && <span className="num">{visual.score.toFixed(4)}</span>}
              </span>
              {visual.page && <span>{visual.page}</span>}
            </div>
            <a href={visual.src} target="_blank" rel="noopener noreferrer" title="이미지 원본 보기">
              <img src={visual.src} alt={visual.caption || referenceTitle(reference)} loading="lazy" />
            </a>
            {visual.caption && <div className="reference-image-caption">{visual.caption}</div>}
          </div>
        ))}
      </div>
    </div>
  )
}

function markdownWithCitationLinks(text: string, references: any[]) {
  const refsById = new Map(references.map((reference, index) => [referenceId(reference, index), reference]))
  return text.replace(/\[(\d{1,3})\]/g, (match, refId, offset, fullText) => {
    if (offset > 0 && fullText[offset - 1] === '^') return match
    if (!refsById.has(refId)) return match
    return `[\\[${refId}\\]](#${referenceAnchorId(refId)})`
  })
}

function CitationText({
  text,
  references,
  onReferenceSelect
}: {
  text: string
  references: any[]
  onReferenceSelect?: (refId: string) => void
}) {
  const markdown = markdownWithCitationLinks(text, references)

  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        a: ({ href, children }) => {
          const targetAnchor = href?.startsWith('#kms-reference-') ? href.slice(1) : ''
          const refId = targetAnchor
            ? references
              .map((reference, index) => referenceId(reference, index))
              .find((id) => referenceAnchorId(id) === targetAnchor)
            : ''
          const citationReference = refId
            ? references.find((reference, index) => referenceId(reference, index) === refId)
            : null
          if (refId) {
            return (
              <a
                className="citation-link"
                href={href}
                title={`${citationReference ? referenceTitle(citationReference) : `참조 ${refId}`} 근거 보기`}
                onClick={(event) => {
                  event.preventDefault()
                  onReferenceSelect?.(refId)
                }}
              >
                {children}
              </a>
            )
          }
          return (
          <a
            href={href}
            target={href?.startsWith('http') ? '_blank' : undefined}
            rel={href?.startsWith('http') ? 'noopener noreferrer' : undefined}
          >
            {children}
          </a>
          )
        }
      }}
    >
      {markdown}
    </ReactMarkdown>
  )
}

function referenceOpenInfo(reference: any) {
  const downloadUrl = typeof reference.download_url === 'string' ? reference.download_url.trim() : ''
  const boardRef = isBoardReference(reference)
  const filePathUrl = /^https?:\/\//.test(referenceFilePath(reference)) ? referenceFilePath(reference) : ''
  const openUrl = downloadUrl || (!boardRef ? filePathUrl : '')
  const hasTextPreview = Boolean(reference.doc_id || referenceEmbeddedText(reference).trim())
  const imageCount = referenceImages(reference).length
  const embeddedText = referenceEmbeddedText(reference).trim()
  return { downloadUrl, boardRef, openUrl, hasTextPreview, imageCount, embeddedText }
}

function ReferenceActionRow({
  reference,
  openDocumentPreview,
  openBoardPreview
}: {
  reference: any
  openDocumentPreview: (reference: any) => void
  openBoardPreview: (reference: any) => void
}) {
  const { downloadUrl, boardRef, openUrl, hasTextPreview } = referenceOpenInfo(reference)

  return (
    <div className="reference-actions">
      {hasTextPreview && (
        <button
          type="button"
          className="btn btn-secondary btn-sm"
          onClick={() => openDocumentPreview(reference)}
          title="추출된 본문과 청크 보기"
          style={{ whiteSpace: 'nowrap' }}
        >
          <FileTextIcon className="size-4" /> 본문 보기
        </button>
      )}
      {boardRef && (
        <button
          type="button"
          className="btn btn-secondary btn-sm"
          onClick={() => openBoardPreview(reference)}
          title="게시판 API 원문 보기"
          style={{ whiteSpace: 'nowrap' }}
        >
          <BookOpenIcon className="size-4" /> 게시글 보기
        </button>
      )}
      {openUrl ? (
        <a
          className="btn btn-ghost btn-sm"
          href={openUrl}
          target="_blank"
          rel="noopener noreferrer"
          title={downloadUrl ? '원본 파일 열기' : '원본 링크 열기'}
          style={{ whiteSpace: 'nowrap' }}
        >
          <ExternalLinkIcon className="size-4" /> {downloadUrl ? '원본 파일' : '원본 링크'}
        </a>
      ) : (
        <span className="muted" style={{ fontSize: 12 }}>
          원본 파일 없음
        </span>
      )}
      {downloadUrl && (
        <a
          className="btn btn-ghost btn-sm"
          href={downloadUrl}
          download
          title="원본 문서 다운로드"
          style={{ whiteSpace: 'nowrap' }}
        >
          <DownloadIcon className="size-4" /> 다운로드
        </a>
      )}
    </div>
  )
}

function ReferenceSummaryList({
  references,
  onOpen
}: {
  references: any[]
  onOpen: (refId?: string) => void
}) {
  if (!references.length) {
    return (
      <div className="empty" style={{ padding: '12px 0', textAlign: 'left' }}>
        연결된 근거 지식이 없습니다.
      </div>
    )
  }

  const topReferences = references.slice(0, 3)

  return (
    <div className="reference-summary">
      <div className="reference-summary-list">
        {topReferences.map((reference: any, index: number) => {
          const refId = referenceId(reference, index)
          const refScore = referenceScore(reference)
          const { imageCount } = referenceOpenInfo(reference)
          return (
            <button
              type="button"
              key={reference.id || reference.doc_id || refId}
              className="reference-summary-card"
              onClick={() => onOpen(refId)}
              title="근거 상세 보기"
            >
              <span className="reference-summary-rank">{refId}</span>
              <span className="reference-summary-main">
                <span className="reference-summary-title">{referenceTitle(reference)}</span>
                <span className="reference-summary-meta">
                  {reference.workspace || reference.category || 'KMS'}
                  {refScore !== null && <span className="num" title="검색 관련도 점수"> · 점수 {refScore.toFixed(4)}</span>}
                  {imageCount > 0 && ` · 이미지 ${imageCount}건`}
                </span>
              </span>
              <ChevronRightIcon className="size-4" />
            </button>
          )
        })}
      </div>
      <button type="button" className="btn btn-secondary btn-sm" onClick={() => onOpen()}>
        근거 전체 보기 {references.length}건
      </button>
    </div>
  )
}

function ReferenceDrawer({
  open,
  references,
  selectedRefId,
  onSelect,
  onClose,
  openDocumentPreview,
  openBoardPreview
}: {
  open: boolean
  references: any[]
  selectedRefId: string | null
  onSelect: (refId: string) => void
  onClose: () => void
  openDocumentPreview: (reference: any) => void
  openBoardPreview: (reference: any) => void
}) {
  if (!open || !references.length) return null

  const selectedIndex = Math.max(
    0,
    references.findIndex((reference, index) => referenceId(reference, index) === selectedRefId)
  )
  const selectedReference = references[selectedIndex]
  const selectedId = referenceId(selectedReference, selectedIndex)
  const selectedScore = referenceScore(selectedReference)
  const { imageCount, embeddedText } = referenceOpenInfo(selectedReference)

  return (
    <div className="source-drawer-overlay" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <aside className="source-drawer" aria-label="근거 지식 상세">
        <div className="source-drawer-h">
          <div>
            <div className="source-drawer-title">근거 지식</div>
            <div className="muted" style={{ fontSize: 12 }}>점수 순 {references.length}건</div>
          </div>
          <button type="button" className="x" onClick={onClose} aria-label="닫기">
            <XIcon className="size-5" />
          </button>
        </div>
        <div className="source-drawer-b">
          <div className="source-drawer-list">
            {references.map((reference, index) => {
              const refId = referenceId(reference, index)
              const refScore = referenceScore(reference)
              const isSelected = refId === selectedId
              return (
                <button
                  type="button"
                  key={reference.id || reference.doc_id || refId}
                  className={`source-drawer-list-item${isSelected ? ' active' : ''}`}
                  onClick={() => onSelect(refId)}
                >
                  <span className="reference-summary-rank">{refId}</span>
                  <span className="source-drawer-list-text">
                    <span>{referenceTitle(reference)}</span>
                    <small>
                      {reference.workspace || reference.category || 'KMS'}
                      {refScore !== null && ` · ${refScore.toFixed(4)}`}
                    </small>
                  </span>
                </button>
              )
            })}
          </div>
          <div id={referenceAnchorId(selectedId)} className="source-drawer-detail">
            <div className="source-drawer-detail-head">
              <div style={{ minWidth: 0 }}>
                <div className="row wrap" style={{ gap: 8, marginBottom: 8 }}>
                  <span className="reference-summary-rank">{selectedId}</span>
                  <span className="badge outline">{selectedReference.workspace || selectedReference.category || 'KMS'}</span>
                  {selectedScore !== null && (
                    <span className="badge outline num" title="검색 관련도 점수">
                      점수 {selectedScore.toFixed(4)}
                    </span>
                  )}
                  {imageCount > 0 && <span className="badge gray">이미지 {imageCount}건</span>}
                </div>
                <div className="source-drawer-detail-title">{referenceTitle(selectedReference)}</div>
              </div>
              <ReferenceActionRow
                reference={selectedReference}
                openDocumentPreview={openDocumentPreview}
                openBoardPreview={openBoardPreview}
              />
            </div>

            <div className="source-drawer-meta">
              {selectedReference.doc_id && <span className="badge outline">문서 ID {selectedReference.doc_id}</span>}
              {referenceFilePath(selectedReference) && (
                <span className="badge outline reference-path" title={referenceFilePath(selectedReference)}>
                  출처 {referenceFilePath(selectedReference)}
                </span>
              )}
            </div>

            {embeddedText && (
              <div className="source-drawer-text">
                {embeddedText}
              </div>
            )}
            <ReferenceImages reference={selectedReference} />
            {!embeddedText && imageCount === 0 && (
              <div className="empty" style={{ padding: '18px 0', textAlign: 'left' }}>
                표시할 상세 정보가 없습니다. 필요한 경우 본문 보기 또는 원본 파일을 확인하세요.
              </div>
            )}
          </div>
        </div>
      </aside>
    </div>
  )
}

const exclusionReasonLabels: Record<string, string> = {
  expired: '유효기간 만료',
  inactive: '사용 안 함',
  not_started: '유효 시작 전'
}

function eligibilityMessages(result: any) {
  const eligibility = result?.trace?.eligibility
  if (!eligibility) return []
  return (['kms', 'faq'] as const).flatMap((section) => {
    const summary = eligibility[section]
    if (!summary?.excluded_count) return []
    const label = section === 'kms' ? '생성형 KMS' : 'FAQ KMS'
    const reasonTexts = Object.entries(summary.excluded_by_reason || {})
      .filter(([, count]) => Number(count) > 0)
      .map(([reason, count]) => `${exclusionReasonLabels[reason] || reason} ${count}건`)
    return [
      {
        key: section,
        label,
        count: Number(summary.excluded_count),
        reasons: reasonTexts.join(', '),
        items: (summary.excluded_items || []).slice(0, 3)
      }
    ]
  })
}

function EligibilityNotice({ result }: { result: any }) {
  const messages = eligibilityMessages(result)
  if (!messages.length) return null

  return (
    <div className="card" style={{ padding: 12, borderColor: 'var(--border-default)', background: 'var(--bg-elevated)' }}>
      <div className="row" style={{ gap: 9, alignItems: 'flex-start' }}>
        <InfoIcon className="size-4" style={{ color: 'var(--fg-secondary)', marginTop: 2, flexShrink: 0 }} />
        <div className="col" style={{ gap: 7, minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--fg-primary)' }}>
            검색 후보 적용 내역
          </div>
          <div className="row wrap" style={{ gap: 7 }}>
            {messages.map((message) => (
              <span key={message.key} className="badge gray">
                {message.label} 제외 {message.count}건{message.reasons ? ` · ${message.reasons}` : ''}
              </span>
            ))}
          </div>
          <div className="muted" style={{ fontSize: 12, lineHeight: 1.55 }}>
            선택한 고객센터, 워크스페이스, 카테고리 범위에는 있었지만 유효기간 또는 사용 여부 조건을 통과하지 못한 항목은 LightRAG 검색 후보로 전달하지 않았습니다.
          </div>
          {messages.some((message) => message.items.length > 0) && (
            <div className="row wrap" style={{ gap: 6 }}>
              {messages.flatMap((message) =>
                message.items.map((item: any) => (
                  <span key={`${message.key}-${item.item_id}`} className="badge outline eligibility-chip" title={item.title}>
                    {message.label}: {item.title}
                  </span>
                ))
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function ReferencePreviewModal({ preview, onClose }: { preview: ReferencePreviewState | null; onClose: () => void }) {
  if (!preview) return null

  const documentText = preview.kind === 'document' ? previewText(preview.data) : ''
  const board = preview.kind === 'board' ? preview.data : null
  const attachments = Array.isArray(board?.attachments) ? board.attachments : []

  return (
    <div className="overlay" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div className="modal lg">
        <div className="modal-h">
          {preview.kind === 'board' ? <BookOpenIcon className="size-5" /> : <FileTextIcon className="size-5" />}
          <div className="t">{preview.title}</div>
          <button type="button" className="x" onClick={onClose} aria-label="닫기">
            <XIcon className="size-5" />
          </button>
        </div>
        <div className="modal-b">
          {preview.loading && <div className="empty">내용을 불러오는 중입니다.</div>}
          {preview.error && (
            <div className="badge red" style={{ justifyContent: 'flex-start', whiteSpace: 'normal', borderRadius: 'var(--radius-md)', padding: 10 }}>
              {preview.error}
            </div>
          )}
          {!preview.loading && !preview.error && preview.kind === 'document' && (
            <div className="col" style={{ gap: 14 }}>
              <div className="row wrap" style={{ gap: 8 }}>
                {preview.data?.raw_kind && <span className="badge gray">{preview.data.raw_kind}</span>}
                {preview.data?.chunks_count !== undefined && <span className="badge outline">청크 {preview.data.chunks_count}개</span>}
                {preview.data?.content_length !== undefined && <span className="badge outline">본문 {Number(preview.data.content_length || 0).toLocaleString()}자</span>}
              </div>
              <div
                className="card"
                style={{
                  padding: 14,
                  maxHeight: '52vh',
                  overflow: 'auto',
                  whiteSpace: 'pre-wrap',
                  lineHeight: 1.65,
                  color: 'var(--fg-primary-soft)'
                }}
              >
                {documentText || '표시할 텍스트 본문이 없습니다.'}
              </div>
              {Array.isArray(preview.data?.chunks) && preview.data.chunks.length > 0 && (
                <details>
                  <summary className="eyebrow" style={{ cursor: 'pointer' }}>청크별 본문 보기</summary>
                  <div className="col" style={{ gap: 8, marginTop: 10 }}>
                    {preview.data.chunks.map((chunk: any, index: number) => (
                      <div key={chunk.id || index} className="card" style={{ padding: 12 }}>
                        <div className="row wrap" style={{ gap: 7, marginBottom: 8 }}>
                          <span className="badge outline">#{index + 1}</span>
                          {chunk.tokens !== undefined && <span className="badge gray">{chunk.tokens} tokens</span>}
                        </div>
                        <div style={{ whiteSpace: 'pre-wrap', fontSize: 12.5, lineHeight: 1.6 }}>
                          {chunk.content || '청크 본문이 없습니다.'}
                        </div>
                      </div>
                    ))}
                  </div>
                </details>
              )}
            </div>
          )}
          {!preview.loading && !preview.error && preview.kind === 'board' && (
            <div className="col" style={{ gap: 14 }}>
              {!board?.success && (
                <div className="badge red" style={{ justifyContent: 'flex-start', whiteSpace: 'normal', borderRadius: 'var(--radius-md)', padding: 10 }}>
                  {board?.error || '게시글 원문을 불러오지 못했습니다.'}
                </div>
              )}
              {board?.success && (
                <>
                  <div>
                    <div style={{ fontSize: 18, fontWeight: 800, color: 'var(--fg-primary)' }}>{board.title || preview.title}</div>
                    <div className="row wrap muted" style={{ gap: 10, marginTop: 8, fontSize: 12 }}>
                      {board.date && <span>{board.date}</span>}
                      {board.author && <span>작성자 {board.author}</span>}
                    </div>
                  </div>
                  <div className="card" style={{ padding: 14, maxHeight: '44vh', overflow: 'auto', whiteSpace: 'pre-wrap', lineHeight: 1.65 }}>
                    {board.body || '게시글 본문이 없습니다.'}
                  </div>
                  {attachments.length > 0 && (
                    <div>
                      <div className="eyebrow" style={{ marginBottom: 8 }}>첨부 {attachments.length}건</div>
                      <div className="row wrap" style={{ gap: 8 }}>
                        {attachments.map((attachment: any, index: number) => {
                          const url = attachment.url || attachment.download_url || attachment.filePath || attachment.file_path
                          const name = attachment.name || attachment.fileName || attachment.file_name || `첨부 ${index + 1}`
                          return url ? (
                            <a key={`${url}-${index}`} className="btn btn-secondary btn-sm" href={url} target="_blank" rel="noopener noreferrer">
                              <ExternalLinkIcon className="size-4" /> {name}
                            </a>
                          ) : (
                            <span key={`${name}-${index}`} className="badge gray">{name}</span>
                          )
                        })}
                      </div>
                    </div>
                  )}
                  {board.raw_data && (
                    <details>
                      <summary className="eyebrow" style={{ cursor: 'pointer' }}>원본 JSON 보기</summary>
                      <pre className="mono" style={{ marginTop: 10, maxHeight: 260, overflow: 'auto', padding: 12, borderRadius: 'var(--radius-md)', background: 'var(--bg-subtle)', fontSize: 11.5 }}>
                        {prettyJson(board.raw_data)}
                      </pre>
                    </details>
                  )}
                </>
              )}
            </div>
          )}
        </div>
        <div className="modal-f">
          <Button type="button" variant="outline" onClick={onClose}>닫기</Button>
        </div>
      </div>
    </div>
  )
}

function AiAnswer({ result, kmsWorkspace }: { result: any; kmsWorkspace: string }) {
  const answerText = textFromGenerative(result)
  const references = useMemo(
    () => sortReferencesByScore(result?.references || result?.generative_answer?.references || []),
    [result]
  )
  const keywords = result?.keywords || []
  const [preview, setPreview] = useState<ReferencePreviewState | null>(null)
  const [referenceDrawerOpen, setReferenceDrawerOpen] = useState(false)
  const [selectedReferenceId, setSelectedReferenceId] = useState<string | null>(null)

  useEffect(() => {
    const refIdFromHash = window.location.hash.match(/^#kms-reference-(.+)$/)?.[1]
    if (!refIdFromHash) return
    const refId = references
      .map((reference, index) => referenceId(reference, index))
      .find((id) => referenceAnchorId(id).replace(/^kms-reference-/, '') === refIdFromHash)
    if (refId) {
      setSelectedReferenceId(refId)
      setReferenceDrawerOpen(true)
    }
  }, [references])

  const openReferenceDrawer = (refId?: string) => {
    const nextRefId = refId || selectedReferenceId || (references[0] ? referenceId(references[0], 0) : null)
    if (!nextRefId) return
    setSelectedReferenceId(nextRefId)
    setReferenceDrawerOpen(true)
    window.history.replaceState(null, '', `#${referenceAnchorId(nextRefId)}`)
  }

  const selectReference = (refId: string) => {
    setSelectedReferenceId(refId)
    window.history.replaceState(null, '', `#${referenceAnchorId(refId)}`)
  }

  const openDocumentPreview = async (reference: any) => {
    const title = referenceTitle(reference)
    setPreview({ kind: 'document', title, loading: true, error: '', data: null })
    const embeddedText = referenceEmbeddedText(reference)
    try {
      if (reference.doc_id) {
        const response = await api.get(`/api/knowledge/kms-documents/${encodeURIComponent(reference.doc_id)}/preview`, {
          params: { kms_workspace: kmsWorkspace }
        })
        setPreview({ kind: 'document', title, loading: false, error: '', data: response.data })
      } else {
        setPreview({
          kind: 'document',
          title,
          loading: false,
          error: embeddedText ? '' : '문서 ID가 없어 원문 미리보기를 불러올 수 없습니다.',
          data: { content: embeddedText, chunks: [] }
        })
      }
    } catch (error: any) {
      setPreview({
        kind: 'document',
        title,
        loading: false,
        error: error?.response?.data?.detail || '본문을 불러오지 못했습니다.',
        data: embeddedText ? { content: embeddedText, chunks: [] } : null
      })
    }
  }

  const openBoardPreview = async (reference: any) => {
    const title = referenceTitle(reference)
    const filePath = referenceFilePath(reference)
    setPreview({ kind: 'board', title, loading: true, error: '', data: null })
    try {
      const response = await api.post(
        '/api/knowledge/board/view',
        { file_path: filePath },
        { params: { kms_workspace: kmsWorkspace } }
      )
      setPreview({ kind: 'board', title: response.data?.title || title, loading: false, error: '', data: response.data })
    } catch (error: any) {
      setPreview({
        kind: 'board',
        title,
        loading: false,
        error: error?.response?.data?.detail || '게시글 원문을 불러오지 못했습니다.',
        data: null
      })
    }
  }

  return (
    <div className="card" style={{ overflow: 'hidden', borderColor: '#c9d8f7' }}>
      <ReferencePreviewModal preview={preview} onClose={() => setPreview(null)} />
      <ReferenceDrawer
        open={referenceDrawerOpen}
        references={references}
        selectedRefId={selectedReferenceId}
        onSelect={selectReference}
        onClose={() => setReferenceDrawerOpen(false)}
        openDocumentPreview={openDocumentPreview}
        openBoardPreview={openBoardPreview}
      />
      <div style={{ background: 'linear-gradient(180deg, var(--accent-soft), #fff)', padding: 'var(--pad-card)' }}>
        <div className="row" style={{ gap: 9, marginBottom: 12 }}>
          <span className="row" style={{ gap: 7, color: 'var(--accent)', fontWeight: 700, fontSize: 13 }}>
            <SparklesIcon className="size-4" /> AI 생성형 답변
          </span>
          <span className="badge green">
            <CheckIcon className="size-3" /> 완료
          </span>
          <div className="grow" />
          <span className="badge outline">생성형 KMS</span>
        </div>

        <div className="rich markdown-answer">
          <CitationText text={answerText} references={references} onReferenceSelect={openReferenceDrawer} />
        </div>

        {keywords.length > 0 && (
          <div style={{ marginTop: 16 }}>
            <div className="eyebrow" style={{ marginBottom: 8 }}>
              주요 키워드
            </div>
            <div className="row wrap" style={{ gap: 7 }}>
              {keywords.map((keyword: string) => (
                <span key={keyword} className="badge blue">
                  <TagIcon className="size-3" /> {keyword}
                </span>
              ))}
            </div>
          </div>
        )}

        <div style={{ marginTop: 16 }}>
          <div className="eyebrow" style={{ marginBottom: 8 }}>
            근거 지식 {references.length}건
          </div>
          <ReferenceSummaryList references={references} onOpen={openReferenceDrawer} />
        </div>

        <div className="row" style={{ gap: 6, marginTop: 14, fontSize: 11.5, color: 'var(--fg-muted)' }}>
          <InfoIcon className="size-3" /> AI 생성형 답변은 등록된 지식을 바탕으로 작성되며, 정확성 검토가 필요할 수 있습니다.
        </div>
      </div>
    </div>
  )
}

function FaqResult({ item, rank }: { item: any; rank: number }) {
  const pct = scorePercent(item)
  const keywords = item.keywords || item.tags || []
  const candidates = faqCandidateList(item)
  const [showCandidates, setShowCandidates] = useState(false)
  const selectedAnswerId = item.answer_id || item.answer?.answer_id

  return (
    <div className="card" style={{ padding: 'var(--pad-card)' }}>
      <div className="row" style={{ gap: 10, alignItems: 'flex-start' }}>
        <span
          style={{
            width: 26,
            height: 26,
            borderRadius: 7,
            background: 'var(--bg-subtle)',
            color: 'var(--fg-secondary)',
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 12,
            fontWeight: 700,
            flexShrink: 0
          }}
        >
          {rank}
        </span>
        <div className="grow" style={{ minWidth: 0 }}>
          <div className="row wrap" style={{ gap: 8 }}>
            <span style={{ fontSize: 15, fontWeight: 600, color: 'var(--accent)' }}>{faqTitle(item)}</span>
            <span className="badge gray">{item.category || item.cat || 'FAQ'}</span>
          </div>
          <div className="rich" style={{ marginTop: 8 }}>
            <p>{faqBody(item)}</p>
          </div>
          <div className="row wrap" style={{ gap: 12, marginTop: 12 }}>
            {pct !== null && (
              <div className="row" style={{ gap: 8 }}>
                <div className={`bar ${pct >= 85 ? 'green' : pct >= 70 ? '' : 'amber'}`} style={{ width: 64 }}>
                  <i style={{ width: `${pct}%` }} />
                </div>
                <span className="num" style={{ fontSize: 12, fontWeight: 700, color: 'var(--fg-secondary)' }}>
                  {pct}%
                </span>
              </div>
            )}
            <div className="row wrap" style={{ gap: 6 }}>
              {keywords.slice(0, 6).map((keyword: string) => (
                <span key={keyword} className="badge outline">
                  {keyword}
                </span>
              ))}
            </div>
          </div>
          {candidates.length > 0 && (
            <div className="faq-candidate-section">
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="faq-candidate-toggle"
                onClick={() => setShowCandidates((current) => !current)}
                aria-expanded={showCandidates}
              >
                <ChevronRightIcon
                  className="size-4"
                  style={{ transform: showCandidates ? 'rotate(90deg)' : 'rotate(0deg)' }}
                />
                후보 근거 보기 {candidates.length}건
              </Button>

              {showCandidates && (
                <div className="faq-candidate-panel">
                  <div className="eyebrow">FAQ 후보 근거</div>
                  <div className="faq-candidate-list">
                    {candidates.map((candidate: any, candidateIndex: number) => {
                      const candidatePct = scorePercent(candidate)
                      const candidateId = faqCandidateId(candidate, candidateIndex)
                      const guidance = faqCandidateGuidance(candidate)
                      const isSelected = selectedAnswerId && selectedAnswerId === candidateId

                      return (
                        <div
                          key={`${candidateId}-${candidateIndex}`}
                          className={`faq-candidate-card${isSelected ? ' selected' : ''}`}
                        >
                          <div className="faq-candidate-head">
                            <span className="reference-summary-rank">{candidateIndex + 1}</span>
                            <div className="grow" style={{ minWidth: 0 }}>
                              <div className="faq-candidate-title">{faqCandidateTitle(candidate, candidateIndex)}</div>
                              <div className="reference-summary-meta">
                                {candidateId}
                                {candidate.selected_by && ` · ${candidate.selected_by}`}
                                {candidate.reason && ` · ${candidate.reason}`}
                              </div>
                            </div>
                            {isSelected && <span className="badge green">선택 답변</span>}
                            {candidatePct !== null && <span className="badge outline">점수 {candidatePct}%</span>}
                          </div>
                          <div className="faq-candidate-body">{faqCandidateBody(candidate)}</div>
                          {guidance.length > 0 && (
                            <div className="row wrap" style={{ gap: 6, marginTop: 8 }}>
                              {guidance.slice(0, 6).map((guide: unknown, guideIndex: number) => (
                                <span key={`${candidateId}-guide-${guideIndex}`} className="badge gray">
                                  {safeString(guide)}
                                </span>
                              ))}
                            </div>
                          )}
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function SearchReadyPreview({ includeGenerative, includeFaq }: { includeGenerative: boolean; includeFaq: boolean }) {
  return (
    <div className="col" style={{ gap: 'var(--gap)' }}>
      {includeGenerative && (
        <div className="card" style={{ overflow: 'hidden', borderColor: '#c9d8f7' }}>
          <div style={{ background: 'linear-gradient(180deg, var(--accent-soft), #fff)', padding: 'var(--pad-card)' }}>
            <div className="row" style={{ gap: 9, marginBottom: 12 }}>
              <span className="row" style={{ gap: 7, color: 'var(--accent)', fontWeight: 700, fontSize: 13 }}>
                <SparklesIcon className="size-4" /> AI 생성형 답변
              </span>
              <span className="badge gray">대기</span>
              <div className="grow" />
              <span className="badge outline">생성형 KMS</span>
            </div>
            <div className="rich">
              <p>검색을 실행하면 선택한 KMS 워크스페이스의 유효한 문서를 기준으로 AI 답변이 이 영역에 표시됩니다.</p>
            </div>
            <div style={{ marginTop: 16 }}>
              <div className="eyebrow" style={{ marginBottom: 8 }}>
                근거 지식
              </div>
              <div className="empty" style={{ padding: '12px 0', textAlign: 'left' }}>
                검색 결과의 참조 문서, 청크 본문, 엔티티 강조 정보가 함께 표시됩니다.
              </div>
            </div>
          </div>
        </div>
      )}

      {includeFaq && (
        <div className="col" style={{ gap: 'var(--gap)' }}>
          <div className="row" style={{ gap: 8 }}>
            <BookOpenIcon className="size-4" style={{ color: 'var(--fg-secondary)' }} />
            <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--fg-primary)' }}>FAQ 답변</span>
            <span className="badge gray">대기</span>
          </div>
          <div className="card" style={{ padding: 'var(--pad-card)' }}>
            <div className="empty" style={{ padding: 18 }}>
              검색을 실행하면 FAQ 워크스페이스의 후보 답변이 점수와 주요 키워드 기준으로 표시됩니다.
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function DisabledReadyCard({ title, description }: { title: string; description: string }) {
  return (
    <div className="card" style={{ padding: 'var(--pad-card)' }}>
      <div className="empty" style={{ padding: 18, textAlign: 'left' }}>
        <b style={{ display: 'block', marginBottom: 6, color: 'var(--fg-primary)' }}>{title}</b>
        <span>{description}</span>
      </div>
    </div>
  )
}

export default function IntegratedSearch() {
  const user = useAuthStore((state) => state.user)
  const [query, setQuery] = useState('')
  const [categories, setCategories] = useState<Category[]>([])
  const [categoryIds, setCategoryIds] = useState<string[]>([])
  const kmsWorkspace = useWorkspaceScopeStore((state) => state.kmsWorkspace)
  const faqWorkspace = useWorkspaceScopeStore((state) => state.faqWorkspace)
  const setKmsWorkspace = useWorkspaceScopeStore((state) => state.setKmsWorkspace)
  const setFaqWorkspace = useWorkspaceScopeStore((state) => state.setFaqWorkspace)
  const [layout, setLayout] = useState<'rail' | 'overview' | 'tabs'>('rail')
  const [tab, setTab] = useState<'all' | 'ai' | 'faq'>('all')
  const [includeGenerative, setIncludeGenerative] = useState(true)
  const [includeFaq, setIncludeFaq] = useState(true)
  const [showSearchSettings, setShowSearchSettings] = useState(false)
  const [showCategoryPicker, setShowCategoryPicker] = useState(false)
  const [categorySearch, setCategorySearch] = useState('')
  const [kmsOptions, setKmsOptions] = useState<KmsSearchOptions>(DEFAULT_KMS_OPTIONS)
  const [faqOptions, setFaqOptions] = useState<FaqSearchOptions>(DEFAULT_FAQ_OPTIONS)
  const [result, setResult] = useState<any>(null)
  const [loading, setLoading] = useState(false)
  const canChooseWorkspaceForUser = canChooseWorkspace(user?.role)
  const { kmsWorkspace: effectiveKmsWorkspace, faqWorkspace: effectiveFaqWorkspace } = resolveEffectiveWorkspaceScope({
    role: user?.role,
    selectedKmsWorkspace: kmsWorkspace,
    selectedFaqWorkspace: faqWorkspace,
    userKmsWorkspace: user?.kms_workspace,
    userFaqWorkspace: user?.faq_workspace
  })

  useEffect(() => {
    api.get('/api/categories').then((response) => setCategories(response.data.categories || []))
  }, [])

  useEffect(() => {
    if (effectiveKmsWorkspace !== kmsWorkspace) setKmsWorkspace(effectiveKmsWorkspace)
    if (effectiveFaqWorkspace !== faqWorkspace) setFaqWorkspace(effectiveFaqWorkspace)
  }, [effectiveFaqWorkspace, effectiveKmsWorkspace, faqWorkspace, kmsWorkspace, setFaqWorkspace, setKmsWorkspace])

  const categoryMap = useMemo(
    () => new Map(categories.map((category) => [category.category_id, category])),
    [categories]
  )
  const activeCategories = categories.filter((category) => category.is_active)
  const shownCategories = [...activeCategories].sort((a, b) => categoryLabel(a).localeCompare(categoryLabel(b)))
  const selectedCategoryLabels = categoryIds.map((id) => categoryMap.get(id)).filter(Boolean) as Category[]
  const categorySearchKeyword = categorySearch.trim().toLowerCase()
  const filteredCategoryOptions = shownCategories.filter((category) => {
    if (!categorySearchKeyword) return true
    return categoryLabel(category).toLowerCase().includes(categorySearchKeyword)
  })

  const toggleCategory = (categoryId: string) => {
    setCategoryIds((value) =>
      value.includes(categoryId) ? value.filter((item) => item !== categoryId) : [...value, categoryId]
    )
  }

  const updateKmsOption = <K extends keyof KmsSearchOptions>(key: K, value: KmsSearchOptions[K]) => {
    setKmsOptions((current) => {
      const next = { ...current, [key]: value }
      if (key === 'include_references' && value === false) {
        next.include_chunk_content = false
      }
      return next
    })
  }

  const submit = async (event?: FormEvent) => {
    event?.preventDefault()
    if (!query.trim()) return
    clearReferenceHash()
    setResult(null)
    setLoading(true)
    try {
      const response = await api.post('/api/search/integrated', {
        query,
        category_ids: categoryIds,
        include_generative: includeGenerative,
        include_faq: includeFaq,
        kms_workspace: effectiveKmsWorkspace,
        faq_workspace: effectiveFaqWorkspace,
        kms_options: {
          ...kmsOptions,
          top_k: Number(kmsOptions.top_k) || DEFAULT_KMS_OPTIONS.top_k,
          chunk_top_k: Number(kmsOptions.chunk_top_k) || DEFAULT_KMS_OPTIONS.chunk_top_k
        },
        faq_options: {
          ...faqOptions,
          top_k: Number(faqOptions.top_k) || DEFAULT_FAQ_OPTIONS.top_k,
          min_score: Number(faqOptions.min_score)
        }
      })
      setResult(response.data)
    } finally {
      setLoading(false)
    }
  }

  const faqResults = result?.faq_results || []
  const faqMetadata = result?.faq_metadata || {}
  const aliasExpansions = Array.isArray(faqMetadata.alias_expansions) ? faqMetadata.alias_expansions : []
  const hasResult = Boolean(result)
  const elapsedSeconds = result ? (Number(result.latency_ms || 0) / 1000).toFixed(2) : '0.00'
  const eligibilityNotice = <EligibilityNotice result={result} />
  const aiBlock = includeGenerative && result ? <AiAnswer result={result} kmsWorkspace={effectiveKmsWorkspace} /> : null
  const faqBlock = includeFaq && result ? (
    <div className="col" style={{ gap: 'var(--gap)' }}>
      <div className="row" style={{ gap: 8 }}>
        <BookOpenIcon className="size-4" style={{ color: 'var(--fg-secondary)' }} />
        <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--fg-primary)' }}>FAQ 답변</span>
        <span className="badge gray">{faqResults.length}건</span>
        {faqMetadata.retrieval_mode && <span className="badge outline">{faqMetadata.retrieval_mode}</span>}
      </div>
      {aliasExpansions.length > 0 && (
        <div
          className="row wrap"
          style={{
            gap: 7,
            padding: '10px 12px',
            border: '1px solid var(--accent)',
            borderRadius: 'var(--radius-md)',
            background: 'var(--accent-soft)'
          }}
        >
          <LanguagesIcon className="size-4" style={{ color: 'var(--accent)' }} />
          <strong style={{ fontSize: 12 }}>적용된 공통 용어</strong>
          {aliasExpansions.map((expansion: any, index: number) => (
            <span key={`${expansion.matched_term}-${index}`} className="badge blue">
              {expansion.matched_term} → {expansion.canonical_term}
            </span>
          ))}
        </div>
      )}
      {faqResults.length ? (
        faqResults.map((item: any, index: number) => (
          <FaqResult key={item.answer_id || item.id || index} item={item} rank={index + 1} />
        ))
      ) : (
        <div className="card">
          <div className="empty">FAQ 결과가 없습니다.</div>
        </div>
      )}
    </div>
  ) : null

  const keywords = result?.keywords || []
  const readyOverview = <SearchReadyPreview includeGenerative={includeGenerative} includeFaq={includeFaq} />
  const readyAiBlock = includeGenerative ? (
    <SearchReadyPreview includeGenerative includeFaq={false} />
  ) : (
    <DisabledReadyCard title="AI 생성형 답변" description="검색 범위에서 AI 생성형 답변이 꺼져 있습니다." />
  )
  const readyFaqBlock = includeFaq ? (
    <SearchReadyPreview includeGenerative={false} includeFaq />
  ) : (
    <DisabledReadyCard title="FAQ 답변" description="검색 범위에서 FAQ 답변이 꺼져 있습니다." />
  )
  const readyTabs = (
    <div>
      <div className="tabs" style={{ marginBottom: 16 }}>
        <button type="button" className={tab === 'all' ? 'on' : ''} onClick={() => setTab('all')}>
          전체
        </button>
        <button type="button" className={tab === 'ai' ? 'on' : ''} onClick={() => setTab('ai')}>
          <SparklesIcon className="size-4" /> AI 답변
        </button>
        <button type="button" className={tab === 'faq' ? 'on' : ''} onClick={() => setTab('faq')}>
          <BookOpenIcon className="size-4" /> FAQ
        </button>
      </div>
      <div className="col" style={{ gap: 'var(--gap)' }}>
        {(tab === 'all' || tab === 'ai') && readyAiBlock}
        {(tab === 'all' || tab === 'faq') && readyFaqBlock}
      </div>
    </div>
  )
  const sideRail = (
    <aside className="col" style={{ gap: 'var(--gap)', position: 'sticky', top: 0 }}>
      <div className="card">
        <div className="card-h">
          <div>
            <div className="t">워크스페이스</div>
            <div className="sub">LightRAG 조회 범위</div>
          </div>
        </div>
        <div className="card-b">
          <div className="col" style={{ gap: 10 }}>
            <label className="field">
              <span>KMS 워크스페이스</span>
              <WorkspaceSelect
                value={effectiveKmsWorkspace}
                mode="kms"
                onChange={setKmsWorkspace}
                placeholder="KMS 워크스페이스"
                disabled={!canChooseWorkspaceForUser}
              />
            </label>
            <label className="field">
              <span>FAQ 워크스페이스</span>
              <WorkspaceSelect
                value={effectiveFaqWorkspace}
                mode="answer_catalog"
                onChange={setFaqWorkspace}
                placeholder="FAQ 워크스페이스"
                disabled={!canChooseWorkspaceForUser}
              />
            </label>
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card-h">
          <div>
            <div className="t">검색 범위</div>
            <div className="sub">통합 검색 대상</div>
          </div>
        </div>
        <div className="card-b">
          <div className="col" style={{ gap: 8, fontSize: 12.5 }}>
            <div className="row">
              <SparklesIcon className="size-3" style={{ color: 'var(--accent)' }} />
              <span className="grow">생성형 KMS</span>
              <span className={includeGenerative ? 'badge green' : 'badge gray'}>
                <span className="d" /> {includeGenerative ? 'ON' : 'OFF'}
              </span>
            </div>
            <div className="row">
              <BookOpenIcon className="size-3" style={{ color: 'var(--fg-secondary)' }} />
              <span className="grow">FAQ KMS</span>
              <span className={includeFaq ? 'badge green' : 'badge gray'}>
                <span className="d" /> {includeFaq ? 'ON' : 'OFF'}
              </span>
            </div>
          </div>
        </div>
      </div>

      {hasResult && eligibilityNotice}

      <div className="card">
        <div className="card-h">
          <div>
            <div className="t">생성형 검색 설정</div>
            <div className="sub">LightRAG query options</div>
          </div>
          <div className="sp" />
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setShowSearchSettings((value) => !value)}>
            {showSearchSettings ? '접기' : '수정'}
          </button>
        </div>
        <div className="card-b">
          <div className="col" style={{ gap: 8, fontSize: 12.5 }}>
            <div className="row"><span className="grow muted">쿼리모드</span><b>{queryModeOptions.find((option) => option.value === kmsOptions.mode)?.label}</b></div>
            <div className="row"><span className="grow muted">응답형식</span><b>{responseFormatLabel(kmsOptions.response_type)}</b></div>
            <div className="row"><span className="grow muted">그래프 후보</span><span className="num">{kmsOptions.top_k}</span></div>
            <div className="row"><span className="grow muted">청크 후보</span><span className="num">{kmsOptions.chunk_top_k}</span></div>
            <div className="row wrap" style={{ gap: 6 }}>
              {kmsOptions.include_references && <span className="badge green"><span className="d" />참조</span>}
              {kmsOptions.include_chunk_content && <span className="badge green"><span className="d" />청크</span>}
              {kmsOptions.highlight_entities && <span className="badge green"><span className="d" />엔티티</span>}
              {kmsOptions.enable_rerank && <span className="badge green"><span className="d" />리랭크</span>}
            </div>
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card-h">
          <div>
            <div className="t">{hasResult ? '추출 키워드' : '카테고리 필터'}</div>
          </div>
        </div>
        <div className="card-b">
          {hasResult ? (
            <div className="row wrap" style={{ gap: 7 }}>
              {keywords.length ? (
                keywords.map((keyword: string) => (
                  <span key={keyword} className="badge blue">
                    <TagIcon className="size-3" /> {keyword}
                  </span>
                ))
              ) : (
                <span className="muted" style={{ fontSize: 12 }}>
                  추출된 키워드가 없습니다.
                </span>
              )}
            </div>
          ) : (
            <div className="col" style={{ gap: 8 }}>
              {selectedCategoryLabels.length ? (
                selectedCategoryLabels.map((category) => (
                  <span key={category.category_id} className="badge outline">
                    {categoryLabel(category)}
                  </span>
                ))
              ) : (
                <span className="muted" style={{ fontSize: 12 }}>
                  전체 카테고리
                </span>
              )}
            </div>
          )}
        </div>
      </div>
    </aside>
  )

  return (
    <div className="content-inner fadein">
      <div className="page-head">
        <div>
          <h1>통합 검색</h1>
          <p>질문 하나로 생성형 AI 답변과 FAQ 답변을 함께 조회합니다.</p>
        </div>
        <div className="sp" />
        <RelatedHelp
          topicIds={[
            'HELP-SEARCH-001',
            'HELP-SEARCH-002',
            'HELP-SEARCH-003',
            'HELP-SEARCH-004',
            'HELP-SEARCH-005'
          ]}
        />
        <div className="seg">
          {[
            ['rail', '출처 패널'],
            ['overview', 'AI 오버뷰'],
            ['tabs', '탭 전환']
          ].map(([key, label]) => (
            <button
              key={key}
              className={layout === key ? 'on' : ''}
              type="button"
              onClick={() => setLayout(key as 'rail' | 'overview' | 'tabs')}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <form onSubmit={submit} className="card" style={{ padding: 14, marginBottom: 16 }}>
        <div className="row" style={{ gap: 10 }}>
          <div className="grow" style={{ position: 'relative' }}>
            <SearchIcon
              className="size-5"
              style={{ position: 'absolute', left: 13, top: 11, color: 'var(--fg-secondary)' }}
            />
            <input
              className="input"
              style={{ paddingLeft: 40, height: 42, fontSize: 15 }}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="질문을 입력하세요. 예) 환불은 며칠 걸리나요?"
            />
          </div>
          <Button type="submit" disabled={loading || !query.trim() || (!includeGenerative && !includeFaq)} style={{ height: 42, padding: '0 22px' }}>
            <SearchIcon className="size-4" /> {loading ? '검색 중' : '검색'}
          </Button>
        </div>

        <div className="row wrap" style={{ gap: 12, marginTop: 12 }}>
          <label className="check">
            <input
              type="checkbox"
              checked={includeGenerative}
              onChange={(event) => setIncludeGenerative(event.target.checked)}
            />
            <SparklesIcon className="size-4" style={{ color: 'var(--accent)' }} /> AI 생성형 답변
          </label>
          <label className="check">
            <input type="checkbox" checked={includeFaq} onChange={(event) => setIncludeFaq(event.target.checked)} />
            <BookOpenIcon className="size-4" style={{ color: 'var(--fg-secondary)' }} /> FAQ 답변
          </label>
          <div style={{ width: 1, height: 18, background: 'var(--border-default)' }} />
          <button
            type="button"
            className={`btn btn-secondary btn-sm${showCategoryPicker ? ' on' : ''}`}
            onClick={() => setShowCategoryPicker((value) => !value)}
          >
            <FilterIcon className="size-4" /> 카테고리 선택
            {categoryIds.length > 0 && <span className="category-filter-count">{categoryIds.length}</span>}
          </button>
          {selectedCategoryLabels.length ? (
            selectedCategoryLabels.map((category) => (
              <button
                type="button"
                key={category.category_id}
                className="chip on"
                onClick={() => toggleCategory(category.category_id)}
                title={`${categoryLabel(category)} 선택 해제`}
              >
                {categoryLabel(category)}
                <XIcon className="size-3" />
              </button>
            ))
          ) : (
            <span className="badge outline">전체 카테고리</span>
          )}
        </div>

        {showCategoryPicker && (
          <div className="category-picker-panel">
            <div className="row wrap" style={{ gap: 8 }}>
              <div className="grow">
                <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--fg-primary)' }}>카테고리 선택</div>
                <div className="muted" style={{ fontSize: 12 }}>
                  선택한 카테고리와 하위 카테고리 범위의 지식만 검색 후보로 사용합니다.
                </div>
              </div>
              {categoryIds.length > 0 && (
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => setCategoryIds([])}>
                  전체 해제
                </button>
              )}
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setShowCategoryPicker(false)}>
                닫기
              </button>
            </div>
            <input
              className="input"
              value={categorySearch}
              onChange={(event) => setCategorySearch(event.target.value)}
              placeholder="카테고리명 검색"
              style={{ height: 36, marginTop: 10 }}
            />
            <div className="category-picker-list">
              {filteredCategoryOptions.length ? (
                filteredCategoryOptions.map((category) => {
                  const checked = categoryIds.includes(category.category_id)
                  return (
                    <label key={category.category_id} className={`category-picker-option${checked ? ' on' : ''}`}>
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleCategory(category.category_id)}
                      />
                      <span className="grow" title={categoryLabel(category)}>
                        {categoryLabel(category)}
                      </span>
                      {typeof category.total_knowledge_count === 'number' && (
                        <span className="badge outline">{category.total_knowledge_count}건</span>
                      )}
                    </label>
                  )
                })
              ) : (
                <div className="empty" style={{ padding: 18 }}>
                  조건에 맞는 카테고리가 없습니다.
                </div>
              )}
            </div>
          </div>
        )}

        <div className="row wrap" style={{ gap: 8, marginTop: 12 }}>
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={() => setShowSearchSettings((value) => !value)}
          >
            <SlidersHorizontalIcon className="size-4" /> 검색 설정
          </button>
          <span className="badge blue">쿼리모드 {queryModeOptions.find((option) => option.value === kmsOptions.mode)?.label}</span>
          <span className="badge outline">응답형식 {responseFormatLabel(kmsOptions.response_type)}</span>
          <span className={kmsOptions.include_references ? 'badge green' : 'badge gray'}>
            <span className="d" /> 참조 문서
          </span>
          <span className={kmsOptions.include_chunk_content ? 'badge green' : 'badge gray'}>
            <span className="d" /> 청크 본문
          </span>
          <span className={kmsOptions.highlight_entities ? 'badge green' : 'badge gray'}>
            <span className="d" /> 엔티티 강조
          </span>
          <span className={kmsOptions.enable_rerank ? 'badge green' : 'badge gray'}>
            <span className="d" /> 리랭크
          </span>
          {includeFaq && (
            <span className="badge blue">
              FAQ {faqOptions.retrieval_mode === 'hybrid' ? '하이브리드' : faqOptions.retrieval_mode}
            </span>
          )}
        </div>

        {showSearchSettings && (
          <div
            className="grid"
            style={{
              gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))',
              gap: 12,
              marginTop: 12,
              padding: 14,
              border: '1px solid var(--border-default)',
              borderRadius: 'var(--radius-md)',
              background: 'var(--bg-subtle)'
            }}
          >
            <label className="field">
              <span>쿼리모드</span>
              <select
                className="select"
                value={kmsOptions.mode}
                onChange={(event) => updateKmsOption('mode', event.target.value as QueryMode)}
              >
                {queryModeOptions.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>응답형식</span>
              <select
                className="select"
                value={kmsOptions.response_type}
                onChange={(event) => updateKmsOption('response_type', event.target.value)}
              >
                {responseFormatOptions.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>그래프 후보 수</span>
              <input
                className="input"
                type="number"
                min={1}
                value={kmsOptions.top_k}
                onChange={(event) => updateKmsOption('top_k', Number(event.target.value))}
              />
            </label>
            <label className="field">
              <span>청크 후보 수</span>
              <input
                className="input"
                type="number"
                min={1}
                value={kmsOptions.chunk_top_k}
                onChange={(event) => updateKmsOption('chunk_top_k', Number(event.target.value))}
              />
            </label>
            <label className="field">
              <span>FAQ 조회 방식</span>
              <select
                className="select"
                value={faqOptions.retrieval_mode}
                onChange={(event) => setFaqOptions((current) => ({
                  ...current,
                  retrieval_mode: event.target.value as FaqRetrievalMode
                }))}
                disabled={!includeFaq}
              >
                <option value="hybrid">하이브리드 · 권장</option>
                <option value="keyword">키워드</option>
                <option value="vector">벡터</option>
                <option value="llm_rerank">LLM 최종 선택</option>
              </select>
            </label>
            <label className="field">
              <span>FAQ 후보 수</span>
              <input
                className="input"
                type="number"
                min={1}
                max={20}
                value={faqOptions.top_k}
                onChange={(event) => setFaqOptions((current) => ({
                  ...current,
                  top_k: Number(event.target.value)
                }))}
                disabled={!includeFaq}
              />
            </label>
            <label className="field">
              <span>FAQ 최소 점수</span>
              <input
                className="input"
                type="number"
                min={0}
                max={1}
                step={0.01}
                value={faqOptions.min_score}
                onChange={(event) => setFaqOptions((current) => ({
                  ...current,
                  min_score: Number(event.target.value)
                }))}
                disabled={!includeFaq}
              />
            </label>
            <label className="check" style={{ minHeight: 38 }}>
              <input
                type="checkbox"
                checked={kmsOptions.include_references}
                onChange={(event) => updateKmsOption('include_references', event.target.checked)}
              />
              참조 문서 포함
            </label>
            <label className="check" style={{ minHeight: 38, opacity: kmsOptions.include_references ? 1 : 0.55 }}>
              <input
                type="checkbox"
                checked={kmsOptions.include_chunk_content}
                disabled={!kmsOptions.include_references}
                onChange={(event) => updateKmsOption('include_chunk_content', event.target.checked)}
              />
              청크 컨텐츠 포함
            </label>
            <label className="check" style={{ minHeight: 38 }}>
              <input
                type="checkbox"
                checked={kmsOptions.highlight_entities}
                onChange={(event) => updateKmsOption('highlight_entities', event.target.checked)}
              />
              엔티티 강조
            </label>
            <div className="row" style={{ gap: 10, minHeight: 38 }}>
              <label className="check">
                <input
                  type="checkbox"
                  checked={kmsOptions.enable_rerank}
                  onChange={(event) => updateKmsOption('enable_rerank', event.target.checked)}
                />
                리랭크 활성화
              </label>
              <div className="grow" />
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => {
                setKmsOptions(DEFAULT_KMS_OPTIONS)
                setFaqOptions(DEFAULT_FAQ_OPTIONS)
              }}>
                <RotateCcwIcon className="size-4" /> 기본값
              </button>
            </div>
          </div>
        )}

        <div className="row wrap" style={{ gap: 8, marginTop: 12, paddingTop: 12, borderTop: '1px solid var(--border-subtle)' }}>
          <span className="muted" style={{ fontSize: 12 }}>
            KMS <span className="mono">{effectiveKmsWorkspace}</span>
          </span>
          <span className="muted" style={{ fontSize: 12 }}>
            FAQ <span className="mono">{effectiveFaqWorkspace}</span>
          </span>
          {categoryIds.length > 0 && (
            <span className="muted" style={{ fontSize: 12 }}>
              선택 카테고리 {categoryIds.length}개
            </span>
          )}
        </div>
      </form>

      {hasResult ? (
        <div className="fadein">
          <div className="row" style={{ marginBottom: 14, gap: 8 }}>
            <span className="muted" style={{ fontSize: 13 }}>
              "<b style={{ color: 'var(--fg-primary)' }}>{query}</b>" 검색 결과
            </span>
            <span className="muted" style={{ fontSize: 12.5 }}>
              · 약 {elapsedSeconds}초
            </span>
          </div>

          {layout === 'overview' && (
            <div className="col" style={{ gap: 'var(--gap)' }}>
              {aiBlock}
              {faqBlock}
              {eligibilityNotice}
            </div>
          )}

          {layout === 'tabs' && (
            <div>
              <div className="tabs" style={{ marginBottom: 16 }}>
                <button className={tab === 'all' ? 'on' : ''} onClick={() => setTab('all')}>
                  전체
                </button>
                <button className={tab === 'ai' ? 'on' : ''} onClick={() => setTab('ai')}>
                  <SparklesIcon className="size-4" /> AI 답변
                </button>
                <button className={tab === 'faq' ? 'on' : ''} onClick={() => setTab('faq')}>
                  <BookOpenIcon className="size-4" /> FAQ <span className="ct">{faqResults.length}</span>
                </button>
              </div>
              <div className="col" style={{ gap: 'var(--gap)' }}>
                {(tab === 'all' || tab === 'ai') && aiBlock}
                {(tab === 'all' || tab === 'faq') && faqBlock}
                {eligibilityNotice}
              </div>
            </div>
          )}

          {layout === 'rail' && (
            <div className="grid search-result-grid" style={{ gridTemplateColumns: 'minmax(0,1fr) 300px', alignItems: 'start' }}>
              <div className="col" style={{ gap: 'var(--gap)' }}>
                {aiBlock}
                {faqBlock}
              </div>
              {sideRail}
            </div>
          )}
        </div>
      ) : (
        <>
          {layout === 'overview' && <div className="fadein">{readyOverview}</div>}

          {layout === 'tabs' && <div className="fadein">{readyTabs}</div>}

          {layout === 'rail' && (
            <div className="grid search-result-grid" style={{ gridTemplateColumns: 'minmax(0,1fr) 300px', alignItems: 'start' }}>
              {readyOverview}
              {sideRail}
            </div>
          )}
        </>
      )}
    </div>
  )
}

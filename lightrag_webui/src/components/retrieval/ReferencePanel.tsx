import { useState, useMemo, useEffect, useRef } from 'react'
import { ReferenceItem, StructuredContentItem, BoardViewResponse, viewBoardPost } from '@/api/lightrag'
import { ChevronDownIcon, DownloadIcon, ExternalLinkIcon, ImageIcon, FileTextIcon, BookOpenIcon, XIcon, TableIcon, EyeIcon, Loader2Icon, BracesIcon } from 'lucide-react'
import Button from '@/components/ui/Button'
import { useTranslation } from 'react-i18next'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { toast } from 'sonner'
import { BoardPostDialog } from '@/components/board/BoardPostDialog'

// ─── Utilities ───────────────────────────────────────────────────────────────

function safeString(val: unknown): string {
  if (val === null || val === undefined) return ''
  if (typeof val === 'string') return val
  if (typeof val === 'object') {
    const obj = val as Record<string, unknown>
    if ('raw' in obj && typeof obj.raw === 'string') return obj.raw
    if ('text' in obj && typeof obj.text === 'string') return obj.text
    if ('description' in obj && typeof obj.description === 'string') return obj.description
    try { return JSON.stringify(val) } catch { return String(val) }
  }
  return String(val)
}

function getImageSrc(imageField: StructuredContentItem['image']): string {
  if (!imageField) return ''
  if (typeof imageField === 'object') {
    if (imageField.s3_url) return imageField.s3_url
    if (imageField.path) return imageField.path
    return ''
  }
  const str = String(imageField)
  if (str.startsWith('data:') || str.startsWith('http')) return str
  return str ? `data:image/png;base64,${str}` : ''
}

function getImageCaption(item: StructuredContentItem): string {
  return safeString(item.entity?.summary)
    || safeString(item.analysis?.description)
    || item.image?.captions?.join(' ')
    || ''
}

function getTableCaption(item: StructuredContentItem): string {
  return item.table?.caption?.join(' ') || safeString(item.entity?.summary) || ''
}

function isViewableInBrowser(filePath: string): boolean {
  const ext = filePath.split('.').pop()?.toLowerCase() || ''
  return ['pdf', 'png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'bmp', 'ico'].includes(ext)
}

/** Board URL: HTTP URL containing /api/board/ pattern (board API ingestion) */
function isBoardUrl(reference: ReferenceItem): boolean {
  return /^https?:\/\//.test(reference.file_path) && /\/api\/board\//.test(reference.file_path)
}

/** Check if file_path is an external URL */
function isExternalUrl(filePath: string): boolean {
  return /^https?:\/\//.test(filePath)
}

// formatBoardBody, formatDate are in @/components/board/BoardPostDialog

function getScoreColor(score: number): string {
  if (score >= 0.5) return 'bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300'
  if (score >= 0.3) return 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900 dark:text-yellow-300'
  return 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400'
}

function getContentText(item: StructuredContentItem): string {
  if (item.type === 'equation' && item.equation) return item.equation.text || ''
  if (item.content) return safeString(item.content)
  return safeString(item.analysis?.description) || safeString(item.entity?.summary) || ''
}

/** Resolve score: prefer item.score (embedded), fallback to parallel scores array */
function resolveScore(
  item: StructuredContentItem,
  allItems: StructuredContentItem[],
  scores?: (number | null)[]
): number | null {
  if (item.score !== undefined && item.score !== null) return item.score
  if (!scores) return null
  const idx = allItems.indexOf(item)
  return idx >= 0 ? (scores[idx] ?? null) : null
}

/** Highlight evidence snippets within text by wrapping matches in <mark> */
function highlightEvidence(text: string, snippets: string[]): React.ReactNode {
  const escaped = snippets
    .filter(s => s.length >= 10) // skip short snippets to avoid false positives
    .map(s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
  if (escaped.length === 0) return text

  const pattern = new RegExp(`(${escaped.join('|')})`, 'gi')
  const parts = text.split(pattern)
  if (parts.length === 1) return text

  return parts.map((part, i) => {
    const isMatch = escaped.some(s => part.toLowerCase().includes(s.toLowerCase()))
    return isMatch
      ? <mark key={i} className="bg-yellow-200 dark:bg-yellow-800/60 rounded-sm px-0.5">{part}</mark>
      : part
  })
}

// ─── Types ───────────────────────────────────────────────────────────────────

type ScoredVisualItem = {
  item: StructuredContentItem
  score: number | null
  type: 'image' | 'table'
  /** image src (only for images) */
  src?: string
  caption: string
  pageInfo: string
}

// ─── Build Visual Items (images + tables, deduplicated, scored, sorted) ─────

function buildVisualItems(
  allItems: StructuredContentItem[],
  scores?: (number | null)[],
  t?: (key: string, opts?: Record<string, unknown>) => string
): ScoredVisualItem[] {
  const result: ScoredVisualItem[] = []
  const seenImageUrls = new Map<string, number>() // url -> index in result

  for (const item of allItems) {
    if (item.type === 'image') {
      const src = getImageSrc(item.image)
      if (!src) continue

      const score = resolveScore(item, allItems, scores)
      const caption = getImageCaption(item)
      const pageInfo = item.source?.page_idx !== undefined && t
        ? `${t('retrievePanel.references.page')} ${item.source.page_idx + 1}`
        : ''

      // Dedup by URL: keep the one with higher score
      const existingIdx = seenImageUrls.get(src)
      if (existingIdx !== undefined) {
        const existing = result[existingIdx]
        if (score !== null && (existing.score === null || score > existing.score)) {
          result[existingIdx] = { item, score, type: 'image', src, caption, pageInfo }
        }
        continue
      }

      seenImageUrls.set(src, result.length)
      result.push({ item, score, type: 'image', src, caption, pageInfo })
    } else if (item.type === 'table') {
      const score = resolveScore(item, allItems, scores)
      const caption = getTableCaption(item)
      const pageInfo = item.source?.page_idx !== undefined && t
        ? `${t('retrievePanel.references.page')} ${item.source.page_idx + 1}`
        : ''
      result.push({ item, score, type: 'table', caption, pageInfo })
    }
  }

  // Sort by score descending (nulls last)
  result.sort((a, b) => {
    if (a.score === null && b.score === null) return 0
    if (a.score === null) return 1
    if (b.score === null) return -1
    return b.score - a.score
  })

  return result
}

// ─── Image Preview Modal ─────────────────────────────────────────────────────

function ImagePreviewModal({
  isOpen, onClose, imageUrl, title
}: {
  isOpen: boolean; onClose: () => void; imageUrl: string; title: string
}) {
  if (!isOpen) return null
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onClose}>
      <div className="relative max-h-[90vh] max-w-[90vw] bg-background rounded-lg p-4 shadow-lg" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-sm font-medium truncate max-w-[80%]">{title}</h3>
          <Button variant="ghost" size="icon" onClick={onClose} className="h-6 w-6">
            <XIcon className="h-4 w-4" />
          </Button>
        </div>
        <div className="overflow-auto max-h-[80vh]">
          <img
            src={imageUrl} alt={title} className="max-w-full h-auto"
            onError={(e) => {
              (e.target as HTMLImageElement).src = 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200"><text x="50%" y="50%" text-anchor="middle" dominant-baseline="middle" fill="gray">Image not found</text></svg>'
            }}
          />
        </div>
      </div>
    </div>
  )
}

// ─── Content Card (unified image/table card for 2-column grid) ───────────────

function ContentCard({ visual, onPreview }: {
  visual: ScoredVisualItem
  onPreview?: () => void
}) {
  const bodyMarkdown = visual.item.table?.body_markdown || safeString(visual.item.content) || ''

  return (
    <div className="border rounded-md bg-muted/20 overflow-hidden flex flex-col">
      {/* Card header: type icon + score + page */}
      <div className="flex items-center gap-1.5 px-2 py-1.5 bg-muted/30 border-b">
        {visual.type === 'image'
          ? <ImageIcon className="h-3 w-3 shrink-0 text-muted-foreground" />
          : <TableIcon className="h-3 w-3 shrink-0 text-muted-foreground" />
        }
        {visual.score !== null && (
          <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-mono ${getScoreColor(visual.score)}`}>
            {visual.score.toFixed(4)}
          </span>
        )}
        {visual.pageInfo && (
          <span className="text-[10px] text-muted-foreground">{visual.pageInfo}</span>
        )}
      </div>

      {/* Card body */}
      <div className="p-2 flex-1">
        {visual.type === 'image' && visual.src && (
          <>
            <img
              src={visual.src}
              alt={visual.caption || 'Image'}
              className="max-h-48 w-full object-contain rounded bg-white dark:bg-gray-900 cursor-pointer"
              onClick={onPreview}
              onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }}
            />
            {visual.caption && (
              <div className="text-[11px] text-muted-foreground mt-1 line-clamp-2">{visual.caption}</div>
            )}
          </>
        )}

        {visual.type === 'table' && (
          <>
            {visual.caption && (
              <div className="text-[11px] font-medium mb-1 text-muted-foreground line-clamp-2">{visual.caption}</div>
            )}
            <div className="text-xs prose dark:prose-invert max-w-none overflow-x-auto [&_table]:text-xs [&_th]:px-2 [&_th]:py-1 [&_td]:px-2 [&_td]:py-1">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{bodyMarkdown}</ReactMarkdown>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

// ─── Collapsible Text Content ────────────────────────────────────────────────

function CollapsibleTextContent({ items, plainContent, evidence, autoOpen }: {
  items: StructuredContentItem[]
  plainContent?: string[]
  evidence?: string[]
  autoOpen?: boolean
}) {
  const { t } = useTranslation()
  const [isOpen, setIsOpen] = useState(false)

  // Auto-open when evidence highlight is triggered
  useEffect(() => {
    if (autoOpen) setIsOpen(true)
  }, [autoOpen])

  const textItems = items.filter(item => {
    const text = getContentText(item)
    return text.length > 0
  })

  const totalCount = textItems.length + (plainContent?.length || 0)
  if (totalCount === 0) return null

  const renderText = (text: string) =>
    evidence && evidence.length > 0 ? highlightEvidence(text, evidence) : text

  return (
    <div className="mt-2">
      <button
        className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors"
        onClick={() => setIsOpen(!isOpen)}
      >
        <FileTextIcon className="h-3 w-3" />
        <span>{t('retrievePanel.references.textContent')} ({totalCount})</span>
        <ChevronDownIcon className={`h-3 w-3 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
      </button>
      {isOpen && (
        <div className="mt-1.5 space-y-1">
          {textItems.map((item, idx) => {
            const text = getContentText(item)
            return (
              <div key={idx} className="text-xs text-muted-foreground bg-muted/30 rounded p-2 whitespace-pre-wrap break-words max-h-40 overflow-y-auto">
                {item.type === 'equation' && <span className="text-[10px] font-mono text-primary/60 mr-1">[eq]</span>}
                {renderText(text)}
              </div>
            )
          })}
          {plainContent?.map((chunk, idx) => (
            <div key={`plain-${idx}`} className="text-xs text-muted-foreground bg-muted/30 rounded p-2 whitespace-pre-wrap break-words max-h-40 overflow-y-auto">
              {renderText(typeof chunk === 'string' ? chunk : safeString(chunk))}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// BoardPostDialog imported from @/components/board/BoardPostDialog

// ─── Reference Card ──────────────────────────────────────────────────────────

function ReferenceCard({ reference, isHighlighted }: {
  reference: ReferenceItem
  isHighlighted?: boolean
}) {
  const { t } = useTranslation()
  const [isExpanded, setIsExpanded] = useState(false)
  const [previewImage, setPreviewImage] = useState<{ url: string; title: string } | null>(null)
  const [boardLoading, setBoardLoading] = useState(false)
  const [boardData, setBoardData] = useState<BoardViewResponse | null>(null)

  // Auto-expand when highlighted and has evidence
  useEffect(() => {
    if (isHighlighted && reference.evidence?.length) {
      setIsExpanded(true)
    }
  }, [isHighlighted, reference.evidence])

  const isBoardRef = isBoardUrl(reference)

  const handleViewBoardPost = async () => {
    setBoardLoading(true)
    try {
      const data = await viewBoardPost(reference.file_path)
      if (data.success) {
        setBoardData(data)
      } else {
        toast.error(data.error || t('boardView.fetchError'))
      }
    } catch {
      toast.error(t('boardView.fetchError'))
    } finally {
      setBoardLoading(false)
    }
  }

  const isUrlRef = isExternalUrl(reference.file_path)
  // Board refs: prefer doc_nm (post title), fallback to URL; others: show last path segment
  const displayName = isBoardRef
    ? (reference.doc_nm || reference.file_path)
    : (reference.doc_nm || reference.file_path.split('/').pop() || reference.file_path)

  const allStructured = reference.structured_content || []
  const others = allStructured.filter(sc => sc.type !== 'image' && sc.type !== 'table')

  // Build deduplicated, scored, sorted visual items (images + tables merged)
  const visualItems = useMemo(
    () => buildVisualItems(allStructured, reference.scores, t),
    [allStructured, reference.scores, t]
  )

  const imageCount = visualItems.filter(v => v.type === 'image').length
  const tableCount = visualItems.filter(v => v.type === 'table').length

  const hasContent = allStructured.length > 0 || (reference.content && reference.content.length > 0)

  return (
    <div className="border rounded-md bg-muted/20 overflow-hidden">
      {/* Header */}
      <div
        className="flex items-center gap-2 px-3 py-2 cursor-pointer hover:bg-muted/40 transition-colors"
        onClick={() => hasContent && setIsExpanded(!isExpanded)}
      >
        {hasContent && (
          <ChevronDownIcon className={`h-3 w-3 shrink-0 transition-transform ${isExpanded ? 'rotate-180' : ''}`} />
        )}

        {/* File name / URL link */}
        {isBoardRef ? (
          <span
            className="text-xs font-medium truncate flex-1 text-primary hover:underline cursor-pointer"
            title={reference.file_path}
            onClick={(e) => { e.stopPropagation(); handleViewBoardPost() }}
          >
            {boardLoading ? t('boardView.loading') : displayName}
          </span>
        ) : isUrlRef ? (
          <a
            href={reference.file_path}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs font-medium truncate flex-1 text-primary hover:underline"
            title={reference.file_path}
            onClick={(e) => e.stopPropagation()}
          >
            {displayName}
          </a>
        ) : (
          <span className="text-xs font-medium truncate flex-1" title={reference.file_path}>{displayName}</span>
        )}

        {/* Score badge */}
        {reference.score !== undefined && reference.score !== null && (
          <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-mono ${getScoreColor(reference.score)}`}>
            {reference.score.toFixed(4)}
          </span>
        )}

        {/* Content summary badges */}
        {imageCount > 0 && (
          <span className="text-[10px] text-muted-foreground flex items-center gap-0.5">
            <ImageIcon className="h-2.5 w-2.5" />{imageCount}
          </span>
        )}
        {tableCount > 0 && (
          <span className="text-[10px] text-muted-foreground flex items-center gap-0.5">
            <TableIcon className="h-2.5 w-2.5" />{tableCount}
          </span>
        )}

        {/* Action buttons */}
        <div className="flex gap-1" onClick={(e) => e.stopPropagation()}>
          {isBoardRef && (
            <>
              <button
                onClick={handleViewBoardPost}
                disabled={boardLoading}
                className="p-1 rounded hover:bg-muted transition-colors"
                title={t('boardView.viewPost')}
              >
                {boardLoading
                  ? <Loader2Icon className="h-3 w-3 text-muted-foreground animate-spin" />
                  : <EyeIcon className="h-3 w-3 text-muted-foreground" />
                }
              </button>
              <a
                href={reference.file_path}
                target="_blank"
                rel="noopener noreferrer"
                className="p-1 rounded hover:bg-muted transition-colors"
                title={t('boardView.viewApiJson')}
              >
                <BracesIcon className="h-3 w-3 text-muted-foreground" />
              </a>
            </>
          )}
          {reference.download_url && isViewableInBrowser(reference.file_path) && (
            <a href={reference.download_url} target="_blank" rel="noopener noreferrer"
              className="p-1 rounded hover:bg-muted transition-colors"
              title={t('retrievePanel.references.viewFile')}>
              <ExternalLinkIcon className="h-3 w-3 text-muted-foreground" />
            </a>
          )}
          {reference.download_url && (
            <a href={reference.download_url} download
              className="p-1 rounded hover:bg-muted transition-colors"
              title={t('retrievePanel.references.download')}>
              <DownloadIcon className="h-3 w-3 text-muted-foreground" />
            </a>
          )}
        </div>
      </div>

      {/* Content — 2-column grid for visual items */}
      {isExpanded && hasContent && (
        <div className="px-3 pb-3 border-t">
          {/* Images + Tables in 2-column grid, sorted by score */}
          {visualItems.length > 0 && (
            <div className="mt-2 grid grid-cols-2 gap-2">
              {visualItems.map((visual, idx) => (
                <ContentCard
                  key={idx}
                  visual={visual}
                  onPreview={visual.type === 'image' && visual.src
                    ? () => setPreviewImage({ url: visual.src!, title: visual.caption || displayName })
                    : undefined
                  }
                />
              ))}
            </div>
          )}

          {/* Text / Equation / Generic — collapsible, default hidden */}
          <CollapsibleTextContent
            items={others}
            plainContent={allStructured.length === 0 ? reference.content : undefined}
            evidence={reference.evidence}
            autoOpen={isHighlighted && (reference.evidence?.length ?? 0) > 0}
          />
        </div>
      )}

      {/* Image preview modal */}
      {previewImage && (
        <ImagePreviewModal
          isOpen={true}
          onClose={() => setPreviewImage(null)}
          imageUrl={previewImage.url}
          title={previewImage.title}
        />
      )}

      {/* Board post dialog */}
      {boardData && (
        <BoardPostDialog
          isOpen={true}
          onClose={() => setBoardData(null)}
          data={boardData}
        />
      )}
    </div>
  )
}

// ─── Main ReferencePanel ─────────────────────────────────────────────────────

export default function ReferencePanel({
  references,
  highlightRefId
}: {
  references: ReferenceItem[]
  highlightRefId?: string | null
}) {
  const { t } = useTranslation()
  const [isExpanded, setIsExpanded] = useState(false)
  const cardRefs = useRef<Record<string, HTMLDivElement | null>>({})

  useEffect(() => {
    if (highlightRefId) {
      setIsExpanded(true)
      setTimeout(() => {
        const el = cardRefs.current[highlightRefId]
        if (el) {
          el.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
          el.classList.add('ring-2', 'ring-primary', 'ring-offset-1')
          setTimeout(() => el.classList.remove('ring-2', 'ring-primary', 'ring-offset-1'), 2000)
        }
      }, 100)
    }
  }, [highlightRefId])

  // Sort references by score descending (nulls last)
  const sortedReferences = useMemo(() =>
    [...references].sort((a, b) => {
      if (a.score == null && b.score == null) return 0
      if (a.score == null) return 1
      if (b.score == null) return -1
      return b.score - a.score
    }),
    [references]
  )

  if (!sortedReferences || sortedReferences.length === 0) return null

  return (
    <div className="mt-3 border-t pt-3">
      <button
        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors select-none ${
          isExpanded
            ? 'bg-primary/10 text-primary'
            : 'bg-muted/60 text-foreground hover:bg-muted'
        }`}
        onClick={() => setIsExpanded(!isExpanded)}
      >
        <BookOpenIcon className="h-3.5 w-3.5 shrink-0" />
        <span>{t('retrievePanel.references.title')} ({sortedReferences.length})</span>
        <ChevronDownIcon className={`h-3.5 w-3.5 shrink-0 transition-transform ${isExpanded ? 'rotate-180' : ''}`} />
      </button>

      {isExpanded && (
        <div className="mt-2 space-y-2">
          {sortedReferences.map((ref, idx) => (
            <div key={ref.reference_id || idx} ref={el => { cardRefs.current[ref.reference_id] = el }}>
              <ReferenceCard reference={ref} isHighlighted={highlightRefId === ref.reference_id} />
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

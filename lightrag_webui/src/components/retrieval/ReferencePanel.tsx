import { useState, useMemo } from 'react'
import { ReferenceItem, StructuredContentItem } from '@/api/lightrag'
import { ChevronDownIcon, DownloadIcon, ExternalLinkIcon, ImageIcon, FileTextIcon, BookOpenIcon, XIcon } from 'lucide-react'
import Button from '@/components/ui/Button'
import { useTranslation } from 'react-i18next'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

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

function isViewableInBrowser(filePath: string): boolean {
  const ext = filePath.split('.').pop()?.toLowerCase() || ''
  return ['pdf', 'png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'bmp', 'ico'].includes(ext)
}

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

// ─── Types ───────────────────────────────────────────────────────────────────

type ScoredImage = {
  item: StructuredContentItem
  score: number | null
  src: string
  caption: string
  pageInfo: string
}

// ─── Deduplication & Scoring ─────────────────────────────────────────────────

function buildScoredImages(
  images: StructuredContentItem[],
  allItems: StructuredContentItem[],
  scores?: (number | null)[],
  t?: (key: string, opts?: Record<string, unknown>) => string
): ScoredImage[] {
  const result: ScoredImage[] = []
  const seenUrls = new Map<string, number>() // url -> index in result

  for (const img of images) {
    const src = getImageSrc(img.image)
    if (!src) continue

    // Find the score for this item from the parallel scores array
    const idx = allItems.indexOf(img)
    const score = scores && idx >= 0 ? (scores[idx] ?? null) : null

    const caption = getImageCaption(img)
    const pageInfo = img.source?.page_idx !== undefined && t
      ? `${t('retrievePanel.references.page')} ${img.source.page_idx + 1}`
      : ''

    // Dedup by URL: keep the one with higher score
    const existingIdx = seenUrls.get(src)
    if (existingIdx !== undefined) {
      const existing = result[existingIdx]
      if (score !== null && (existing.score === null || score > existing.score)) {
        result[existingIdx] = { item: img, score, src, caption, pageInfo }
      }
      continue
    }

    seenUrls.set(src, result.length)
    result.push({ item: img, score, src, caption, pageInfo })
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

// ─── Best Image Section (top image shown prominently) ────────────────────────

function BestImageSection({ image, onPreview }: { image: ScoredImage; onPreview: () => void }) {
  const { t } = useTranslation()
  return (
    <div className="mt-2">
      <div className="flex items-center gap-1.5 mb-1.5">
        <span className="text-[10px] font-medium text-primary/80 bg-primary/10 px-1.5 py-0.5 rounded">
          {t('retrievePanel.references.bestMatch')}
        </span>
        {image.score !== null && (
          <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-mono ${getScoreColor(image.score)}`}>
            {image.score.toFixed(4)}
          </span>
        )}
        {image.pageInfo && (
          <span className="text-[10px] text-muted-foreground">{image.pageInfo}</span>
        )}
      </div>
      <img
        src={image.src}
        alt={image.caption || 'Best match'}
        className="max-h-64 w-full object-contain rounded border bg-white dark:bg-gray-900 cursor-pointer"
        onClick={onPreview}
        onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }}
      />
      {image.caption && (
        <div className="text-xs text-muted-foreground mt-1 line-clamp-2">{image.caption}</div>
      )}
    </div>
  )
}

// ─── Other Images as clickable description tags ──────────────────────────────

function ImageTagList({ images, onPreview }: {
  images: ScoredImage[]
  onPreview: (img: ScoredImage) => void
}) {
  const { t } = useTranslation()
  const [expandedIdx, setExpandedIdx] = useState<number | null>(null)

  if (images.length === 0) return null

  return (
    <div className="mt-2">
      <span className="text-[10px] font-medium text-muted-foreground mb-1 block">
        {t('retrievePanel.references.otherImages')} ({images.length})
      </span>
      <div className="flex flex-wrap gap-1.5">
        {images.map((img, idx) => {
          const label = img.caption
            ? (img.caption.length > 40 ? img.caption.slice(0, 40) + '...' : img.caption)
            : `${t('retrievePanel.references.imageLabel')} ${idx + 2}`
          const isExpanded = expandedIdx === idx

          return (
            <div key={idx} className="flex flex-col">
              <button
                className={`inline-flex items-center gap-1 text-[11px] px-2 py-1 rounded-md border transition-colors ${
                  isExpanded
                    ? 'bg-primary/10 border-primary/30 text-primary'
                    : 'bg-muted/40 border-border hover:bg-muted/60 text-muted-foreground hover:text-foreground'
                }`}
                onClick={() => setExpandedIdx(isExpanded ? null : idx)}
                title={img.caption || undefined}
              >
                <ImageIcon className="h-3 w-3 shrink-0" />
                <span className="truncate max-w-[200px]">{label}</span>
                {img.score !== null && (
                  <span className="text-[9px] font-mono opacity-60 ml-0.5">{img.score.toFixed(2)}</span>
                )}
              </button>
              {isExpanded && (
                <div className="mt-1.5 mb-1">
                  <img
                    src={img.src}
                    alt={img.caption || `Image ${idx + 2}`}
                    className="max-h-48 w-auto object-contain rounded border bg-white dark:bg-gray-900 cursor-pointer"
                    onClick={() => onPreview(img)}
                    onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }}
                  />
                  {img.pageInfo && (
                    <span className="text-[10px] text-muted-foreground mt-0.5 block">{img.pageInfo}</span>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ─── Table Renderer ──────────────────────────────────────────────────────────

function TableRenderer({ item }: { item: StructuredContentItem }) {
  const tableData = item.table
  const bodyMarkdown = tableData?.body_markdown || safeString(item.content) || ''
  const caption = tableData?.caption?.join(' ') || safeString(item.entity?.summary) || ''

  return (
    <div className="mt-2 border rounded p-2 bg-muted/30 overflow-x-auto">
      {caption && <div className="text-xs font-medium mb-1 text-muted-foreground">{caption}</div>}
      <div className="text-xs prose dark:prose-invert max-w-none [&_table]:text-xs [&_th]:px-2 [&_th]:py-1 [&_td]:px-2 [&_td]:py-1">
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{bodyMarkdown}</ReactMarkdown>
      </div>
    </div>
  )
}

// ─── Collapsible Text Content ────────────────────────────────────────────────

function CollapsibleTextContent({ items, plainContent }: {
  items: StructuredContentItem[]
  plainContent?: string[]
}) {
  const { t } = useTranslation()
  const [isOpen, setIsOpen] = useState(false)

  const textItems = items.filter(item => {
    const text = getContentText(item)
    return text.length > 0
  })

  const totalCount = textItems.length + (plainContent?.length || 0)
  if (totalCount === 0) return null

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
                {text}
              </div>
            )
          })}
          {plainContent?.map((chunk, idx) => (
            <div key={`plain-${idx}`} className="text-xs text-muted-foreground bg-muted/30 rounded p-2 whitespace-pre-wrap break-words max-h-40 overflow-y-auto">
              {typeof chunk === 'string' ? chunk : safeString(chunk)}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ─── Reference Card ──────────────────────────────────────────────────────────

function ReferenceCard({ reference }: { reference: ReferenceItem }) {
  const { t } = useTranslation()
  const [isExpanded, setIsExpanded] = useState(false)
  const [previewImage, setPreviewImage] = useState<{ url: string; title: string } | null>(null)

  const fileName = reference.file_path.split('/').pop() || reference.file_path

  const allStructured = reference.structured_content || []
  const images = allStructured.filter(sc => sc.type === 'image')
  const tables = allStructured.filter(sc => sc.type === 'table')
  const others = allStructured.filter(sc => sc.type !== 'image' && sc.type !== 'table')

  // Build deduplicated, scored, sorted image list
  const scoredImages = useMemo(
    () => buildScoredImages(images, allStructured, reference.scores, t),
    [images, allStructured, reference.scores, t]
  )

  const bestImage = scoredImages.length > 0 ? scoredImages[0] : null
  const otherImages = scoredImages.slice(1)

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
        <span className="text-xs font-medium truncate flex-1" title={reference.file_path}>{fileName}</span>

        {/* Score badge */}
        {reference.score !== undefined && reference.score !== null && (
          <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-mono ${getScoreColor(reference.score)}`}>
            {reference.score.toFixed(4)}
          </span>
        )}

        {/* Content summary badges */}
        {scoredImages.length > 0 && (
          <span className="text-[10px] text-muted-foreground flex items-center gap-0.5">
            <ImageIcon className="h-2.5 w-2.5" />{scoredImages.length}
          </span>
        )}

        {/* View/Download buttons */}
        <div className="flex gap-1" onClick={(e) => e.stopPropagation()}>
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

      {/* Content */}
      {isExpanded && hasContent && (
        <div className="px-3 pb-3 border-t">
          {/* Best matching image — shown prominently */}
          {bestImage && (
            <BestImageSection
              image={bestImage}
              onPreview={() => setPreviewImage({ url: bestImage.src, title: bestImage.caption || fileName })}
            />
          )}

          {/* Other images — as clickable description tags */}
          <ImageTagList
            images={otherImages}
            onPreview={(img) => setPreviewImage({ url: img.src, title: img.caption || fileName })}
          />

          {/* Tables */}
          {tables.length > 0 && (
            <div className="mt-2">
              <span className="text-xs font-medium text-muted-foreground">{t('retrievePanel.references.tables')} ({tables.length})</span>
              {tables.map((table, idx) => (
                <TableRenderer key={idx} item={table} />
              ))}
            </div>
          )}

          {/* Text / Equation / Generic — collapsible, default hidden */}
          <CollapsibleTextContent
            items={others}
            plainContent={allStructured.length === 0 ? reference.content : undefined}
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
    </div>
  )
}

// ─── Main ReferencePanel ─────────────────────────────────────────────────────

export default function ReferencePanel({ references }: { references: ReferenceItem[] }) {
  const { t } = useTranslation()
  const [isExpanded, setIsExpanded] = useState(false)

  if (!references || references.length === 0) return null

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
        <span>{t('retrievePanel.references.title')} ({references.length})</span>
        <ChevronDownIcon className={`h-3.5 w-3.5 shrink-0 transition-transform ${isExpanded ? 'rotate-180' : ''}`} />
      </button>

      {isExpanded && (
        <div className="mt-2 space-y-2">
          {references.map((ref, idx) => (
            <ReferenceCard key={ref.reference_id || idx} reference={ref} />
          ))}
        </div>
      )}
    </div>
  )
}

import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { BoardViewResponse, viewBoardPost } from '@/api/lightrag'
import { XIcon, DownloadIcon, PaperclipIcon, UserIcon, CalendarIcon, EyeIcon, Loader2Icon } from 'lucide-react'
import Button from '@/components/ui/Button'
import { toast } from 'sonner'

// ─── Utilities ───────────────────────────────────────────────────────────────

/** Convert plain text body to formatted HTML with enhanced readability:
 *  - Escape HTML entities (plain text only)
 *  - Detect [Section] headers → styled headings
 *  - Detect bullet-like lines (※, -, •, ▶) → list styling
 *  - Auto-link URLs
 *  - Paragraph grouping with proper spacing
 */
export function formatBoardBody(body: string): string {
  if (!body) return ''
  // If already contains HTML tags, return as-is
  if (/<[a-z][\s\S]*>/i.test(body)) return body

  const lines = body.split('\n')
  const htmlParts: string[] = []

  for (const rawLine of lines) {
    const line = rawLine
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')

    // Empty line → paragraph break
    if (!line.trim()) {
      htmlParts.push('<div class="h-3"></div>')
      continue
    }

    // Auto-link URLs
    const linked = line.replace(
      /(https?:\/\/[^\s<]+)/g,
      '<a href="$1" target="_blank" rel="noopener noreferrer" class="text-primary hover:underline break-all">$1</a>'
    )

    // [Section Header] pattern
    if (/^\[.+\]$/.test(line.trim())) {
      htmlParts.push(`<div class="font-semibold text-foreground mt-3 mb-1 pb-1 border-b border-border/50">${linked}</div>`)
      continue
    }

    // Bullet-like lines: ※, -, •, ▶, ◆, ●, ○
    if (/^\s*[※\-•▶◆●○]\s/.test(line)) {
      htmlParts.push(`<div class="pl-3 py-0.5 text-muted-foreground">${linked}</div>`)
      continue
    }

    // Key: Value pattern (short key followed by colon)
    if (/^[^:]{1,20}\s*:\s+/.test(line.trim())) {
      const colonIdx = line.indexOf(':')
      const key = line.substring(0, colonIdx).replace(/&/g, '&amp;').replace(/</g, '&lt;')
      const val = linked.substring(linked.indexOf(':') + 1).trim()
      htmlParts.push(`<div class="py-0.5"><span class="font-medium text-foreground">${key}:</span> ${val}</div>`)
      continue
    }

    // Normal line
    htmlParts.push(`<div class="py-0.5">${linked}</div>`)
  }

  return htmlParts.join('\n')
}

/** Format timestamp (epoch ms or ISO string) to readable date */
export function formatDate(dateStr: string): string {
  if (!dateStr) return ''
  try {
    const num = Number(dateStr)
    if (!isNaN(num) && num > 1e12) {
      // epoch milliseconds
      return new Date(num).toLocaleString()
    }
    if (!isNaN(num) && num > 1e9) {
      // epoch seconds
      return new Date(num * 1000).toLocaleString()
    }
    // Try ISO / date string parse
    const d = new Date(dateStr)
    if (!isNaN(d.getTime())) return d.toLocaleString()
  } catch { /* ignore */ }
  return dateStr
}

// ─── Board Post Dialog ───────────────────────────────────────────────────────

export function BoardPostDialog({
  isOpen, onClose, data
}: {
  isOpen: boolean; onClose: () => void; data: BoardViewResponse
}) {
  const { t } = useTranslation()
  if (!isOpen) return null

  const displayDate = formatDate(data.date)

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onClose}>
      <div
        className="relative w-[90vw] max-w-2xl max-h-[85vh] bg-background rounded-lg shadow-lg flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Title bar */}
        <div className="flex items-start justify-between gap-3 px-5 py-3 border-b bg-muted/30">
          <div className="flex-1 min-w-0">
            <h3 className="text-base font-semibold leading-snug break-words">
              {data.title || t('boardView.viewPost')}
            </h3>
            {/* Meta inline under title */}
            {(data.author || displayDate) && (
              <div className="flex items-center gap-3 mt-1.5 text-xs text-muted-foreground">
                {data.author && (
                  <span className="flex items-center gap-1">
                    <UserIcon className="h-3 w-3 shrink-0" />
                    {data.author}
                  </span>
                )}
                {displayDate && (
                  <span className="flex items-center gap-1">
                    <CalendarIcon className="h-3 w-3 shrink-0" />
                    {displayDate}
                  </span>
                )}
              </div>
            )}
          </div>
          <Button variant="ghost" size="icon" onClick={onClose} className="h-7 w-7 shrink-0 -mr-1 -mt-0.5">
            <XIcon className="h-4 w-4" />
          </Button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-4">
          <div
            className="max-w-none text-sm text-foreground break-words leading-relaxed [&_img]:max-w-full [&_img]:h-auto [&_a]:break-all"
            dangerouslySetInnerHTML={{ __html: formatBoardBody(data.body) }}
          />
        </div>

        {/* Attachments */}
        {data.attachments && data.attachments.length > 0 && (
          <div className="px-5 py-2.5 border-t bg-muted/20">
            <div className="text-xs font-medium text-muted-foreground mb-1.5 flex items-center gap-1">
              <PaperclipIcon className="h-3 w-3" />
              {t('boardView.attachments')} ({data.attachments.length})
            </div>
            <div className="flex flex-wrap gap-2">
              {data.attachments.map((att: any, idx: number) => {
                const name = typeof att === 'string' ? att : (att?.name || att?.fileName || att?.file_name || `file-${idx + 1}`)
                const url = typeof att === 'string' ? att : (att?.url || att?.download_url || att?.link || '')
                return url ? (
                  <a key={idx} href={url} target="_blank" rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-xs text-primary hover:underline bg-background px-2 py-1 rounded border">
                    <DownloadIcon className="h-3 w-3" />{name}
                  </a>
                ) : (
                  <span key={idx} className="inline-flex items-center gap-1 text-xs text-muted-foreground bg-background px-2 py-1 rounded border">
                    <PaperclipIcon className="h-3 w-3" />{name}
                  </span>
                )
              })}
            </div>
          </div>
        )}

        {/* Footer */}
        <div className="flex justify-end px-5 py-2 border-t">
          <Button variant="outline" size="sm" onClick={onClose}>
            {t('boardView.close')}
          </Button>
        </div>
      </div>
    </div>
  )
}

// ─── Board View Button (reusable trigger) ────────────────────────────────────

export function useBoardPostView() {
  const { t } = useTranslation()
  const [loading, setLoading] = useState(false)
  const [data, setData] = useState<BoardViewResponse | null>(null)

  const open = async (filePath: string, options?: { silentOnError?: boolean }): Promise<boolean> => {
    setLoading(true)
    try {
      const result = await viewBoardPost(filePath)
      if (result.success) {
        setData(result)
        return true
      } else {
        if (!options?.silentOnError) {
          toast.error(result.error || t('boardView.fetchError'))
        }
        return false
      }
    } catch {
      if (!options?.silentOnError) {
        toast.error(t('boardView.fetchError'))
      }
      return false
    } finally {
      setLoading(false)
    }
  }

  const close = () => setData(null)

  return { loading, data, open, close }
}

export function BoardViewButton({
  filePath,
  className = '',
  iconOnly = false,
}: {
  filePath: string
  className?: string
  iconOnly?: boolean
}) {
  const { t } = useTranslation()
  const { loading, data, open, close } = useBoardPostView()

  return (
    <>
      <button
        onClick={(e) => { e.stopPropagation(); open(filePath) }}
        disabled={loading}
        className={className || 'p-1 rounded hover:bg-muted transition-colors'}
        title={t('boardView.viewPost')}
      >
        {loading
          ? <Loader2Icon className="h-3 w-3 text-muted-foreground animate-spin" />
          : <EyeIcon className="h-3 w-3 text-muted-foreground" />
        }
        {!iconOnly && loading && <span className="ml-1 text-xs">{t('boardView.loading')}</span>}
      </button>
      {data && (
        <BoardPostDialog isOpen={true} onClose={close} data={data} />
      )}
    </>
  )
}

export default BoardPostDialog

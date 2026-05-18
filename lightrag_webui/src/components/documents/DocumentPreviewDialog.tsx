import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/Dialog'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/Tabs'
import Button from '@/components/ui/Button'
import Badge from '@/components/ui/Badge'
import { cn } from '@/lib/utils'
import {
  buildDocumentRawUrl,
  getDocumentPreview,
  type DocumentPreview,
  type DocumentPreviewChunk,
} from '@/api/lightrag'
import {
  Loader2,
  AlertCircle,
  Download,
  ExternalLink,
  Image as ImageIcon,
  Table2,
  FileText,
  Copy,
  Check,
  FileCode,
} from 'lucide-react'

interface DocumentPreviewDialogProps {
  docId: string | null
  onClose: () => void
}

const KB = 1024
const MB = KB * 1024

function formatBytes(bytes?: number | null): string {
  if (bytes == null) return '-'
  if (bytes < KB) return `${bytes} B`
  if (bytes < MB) return `${(bytes / KB).toFixed(1)} KB`
  return `${(bytes / MB).toFixed(2)} MB`
}

function shortFilename(path?: string | null, fallback = 'document'): string {
  if (!path) return fallback
  const parts = path.split('/')
  return parts[parts.length - 1] || fallback
}

function isMarkdownPath(filePath?: string | null): boolean {
  if (!filePath) return false
  return /\.(md|markdown)$/i.test(filePath)
}

function getInitialPreviewTab(preview: DocumentPreview): string {
  if (preview.raw_kind === 'pdf' && preview.chunks?.length) return 'extracted'
  return preview.can_preview_inline ? 'original' : 'extracted'
}

function ChunkCard({ chunk, t }: { chunk: DocumentPreviewChunk; t: (key: string) => string }) {
  const structuredContent = chunk.structured_content
  const structuredType = (structuredContent?.type as string | undefined)?.toLowerCase()
  const Icon =
    structuredType === 'image'
      ? ImageIcon
      : structuredType === 'table'
        ? Table2
        : structuredType === 'equation'
          ? FileCode
          : FileText
  const iconClass =
    structuredType === 'image'
      ? 'text-blue-500'
      : structuredType === 'table'
        ? 'text-orange-500'
        : structuredType === 'equation'
          ? 'text-purple-500'
          : 'text-gray-500'

  const image = structuredContent?.image as Record<string, any> | undefined
  const entity = structuredContent?.entity as Record<string, any> | undefined
  const analysis = structuredContent?.analysis as Record<string, any> | undefined
  const imageUrl = (image?.s3_url || image?.path || '') as string

  return (
    <div className="space-y-2 rounded-md border bg-card p-3">
      <div className="flex flex-wrap items-center gap-2">
        <Icon className={cn('h-4 w-4 shrink-0', iconClass)} />
        <span className="font-mono text-xs text-muted-foreground">
          #{chunk.chunk_order_index ?? '?'}
        </span>
        {structuredType && (
          <Badge variant="outline" className="text-[10px] uppercase">
            {structuredType}
          </Badge>
        )}
        {entity?.name && <span className="truncate text-sm font-medium">{String(entity.name)}</span>}
        {chunk.tokens != null && (
          <span className="ml-auto text-[11px] text-muted-foreground">
            {t('documentPanel.preview.tokens')}: {chunk.tokens}
          </span>
        )}
      </div>

      {structuredType === 'image' && imageUrl && (
        <div className="rounded border bg-muted/30 p-2">
          <img
            src={imageUrl}
            alt={String(entity?.name || 'image')}
            className="mx-auto max-h-80 rounded object-contain"
            loading="lazy"
            onError={(event) => {
              ;(event.target as HTMLImageElement).style.display = 'none'
            }}
          />
        </div>
      )}

      {entity?.summary && (
        <div className="whitespace-pre-wrap text-xs text-muted-foreground">
          <span className="font-semibold">{t('documentPanel.preview.summary')}:</span>{' '}
          {String(entity.summary)}
        </div>
      )}

      {analysis?.description && (
        <div className="whitespace-pre-wrap text-xs">
          <span className="font-semibold">{t('documentPanel.preview.analysis')}:</span>{' '}
          {String(analysis.description)}
        </div>
      )}

      {chunk.content && structuredType !== 'image' && structuredType !== 'table' && structuredType !== 'equation' && (
        <pre className="max-h-[60vh] overflow-auto rounded bg-muted/40 p-2 font-mono text-xs whitespace-pre-wrap">
          {chunk.content}
        </pre>
      )}
    </div>
  )
}

export default function DocumentPreviewDialog({ docId, onClose }: DocumentPreviewDialogProps) {
  const { t } = useTranslation()
  const [data, setData] = useState<DocumentPreview | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState('original')
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (!docId) {
      setData(null)
      setError(null)
      setActiveTab('original')
      return
    }

    let cancelled = false
    setLoading(true)
    setError(null)
    setData(null)

    getDocumentPreview(docId)
      .then((preview) => {
        if (cancelled) return
        setData(preview)
        setActiveTab(getInitialPreviewTab(preview))
      })
      .catch((err) => {
        if (cancelled) return
        setError(err?.message || String(err))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [docId])

  const handleOpenChange = useCallback((open: boolean) => {
    if (!open) onClose()
  }, [onClose])

  const handleCopyContent = useCallback(async () => {
    if (!data?.content) return
    try {
      await navigator.clipboard.writeText(data.content)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      // Clipboard may be unavailable in restricted browser contexts.
    }
  }, [data?.content])

  const title = useMemo(() => {
    if (!data) return docId || ''
    return data.doc_nm || shortFilename(data.file_path, data.id)
  }, [data, docId])

  const rawUrl = docId ? buildDocumentRawUrl(docId) : ''
  const proxiedPdfUrl = docId ? buildDocumentRawUrl(docId, { proxy: data?.raw_kind === 'pdf' }) : ''
  const downloadUrl = docId ? buildDocumentRawUrl(docId, { download: true }) : ''

  return (
    <Dialog open={!!docId} onOpenChange={handleOpenChange}>
      <DialogContent className="flex h-[85vh] w-[95vw] max-w-5xl flex-col">
        <DialogHeader className="space-y-1">
          <DialogTitle className="flex items-center gap-2 pr-8">
            <FileText className="h-5 w-5 shrink-0 text-muted-foreground" />
            <span className="truncate">{title}</span>
            {data?.raw_kind && (
              <Badge variant="outline" className="shrink-0 text-[10px] uppercase">
                {data.raw_kind}
              </Badge>
            )}
          </DialogTitle>
          <DialogDescription className="truncate font-mono text-xs">
            {data?.id || docId}
          </DialogDescription>
        </DialogHeader>

        {loading && (
          <div className="flex items-center justify-center py-16 text-muted-foreground">
            <Loader2 className="mr-2 h-5 w-5 animate-spin" />
            {t('documentPanel.preview.loading')}
          </div>
        )}

        {error && (
          <div className="flex items-start gap-2 rounded-md border border-red-200 bg-red-50/50 p-3 text-sm text-red-600 dark:border-red-900 dark:bg-red-950/30 dark:text-red-400">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <span className="break-words">{error}</span>
          </div>
        )}

        {data && (
          <Tabs value={activeTab} onValueChange={setActiveTab} className="flex min-h-0 flex-1 flex-col">
            <TabsList className="grid w-full max-w-md grid-cols-3">
              <TabsTrigger value="original">{t('documentPanel.preview.tabs.original')}</TabsTrigger>
              <TabsTrigger value="extracted">
                {t('documentPanel.preview.tabs.extracted')}
                {data.chunks?.length ? ` (${data.chunks.length})` : ''}
              </TabsTrigger>
              <TabsTrigger value="metadata">{t('documentPanel.preview.tabs.metadata')}</TabsTrigger>
            </TabsList>

            <TabsContent
              value="original"
              className="mt-3 min-h-0 flex-1 overflow-auto data-[state=inactive]:!hidden"
            >
              {data.raw_kind === 'text' && data.content && (
                <div className="space-y-2">
                  <div className="flex items-center justify-end gap-2">
                    <Button variant="outline" size="sm" onClick={handleCopyContent}>
                      {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                      {copied ? t('documentPanel.preview.copied') : t('documentPanel.preview.copyContent')}
                    </Button>
                    <a href={downloadUrl} download className="inline-block">
                      <Button variant="outline" size="sm">
                        <Download className="h-3.5 w-3.5" />
                        {t('documentPanel.preview.download')}
                      </Button>
                    </a>
                  </div>
                  {isMarkdownPath(data.file_path) || !data.file_path ? (
                    <div className="prose prose-sm dark:prose-invert max-w-none break-words">
                      <ReactMarkdown remarkPlugins={[remarkGfm]}>
                        {data.content}
                      </ReactMarkdown>
                    </div>
                  ) : (
                    <pre className="rounded bg-muted/40 p-3 font-mono text-xs whitespace-pre-wrap">
                      {data.content}
                    </pre>
                  )}
                </div>
              )}

              {data.raw_kind === 'image' && (data.s3_url || data.can_preview_inline) && (
                <div className="space-y-2">
                  <div className="flex items-center justify-end gap-2">
                    <a href={data.s3_url || rawUrl} target="_blank" rel="noopener noreferrer" className="inline-block">
                      <Button variant="outline" size="sm">
                        <ExternalLink className="h-3.5 w-3.5" />
                        {t('documentPanel.preview.openOriginal')}
                      </Button>
                    </a>
                  </div>
                  <div className="flex items-center justify-center rounded border bg-muted/30 p-2">
                    <img src={data.s3_url || rawUrl} alt={title} className="max-h-[65vh] object-contain" />
                  </div>
                </div>
              )}

              {data.raw_kind === 'pdf' && (data.s3_url || data.can_preview_inline) && (
                <div className="h-full space-y-2">
                  <div className="flex items-center justify-end gap-2">
                    <a href={data.s3_url || rawUrl} target="_blank" rel="noopener noreferrer" className="inline-block">
                      <Button variant="outline" size="sm">
                        <ExternalLink className="h-3.5 w-3.5" />
                        {t('documentPanel.preview.openOriginal')}
                      </Button>
                    </a>
                  </div>
                  <iframe src={proxiedPdfUrl || rawUrl} title={title} className="h-[70vh] w-full rounded border bg-muted/30" />
                </div>
              )}

              {!data.can_preview_inline && (
                <div className="flex flex-col items-center justify-center gap-3 py-10 text-center text-sm">
                  <AlertCircle className="h-8 w-8 text-amber-500" />
                  <div className="space-y-1">
                    <div className="font-medium">{t('documentPanel.preview.unsupportedTitle')}</div>
                    <div className="max-w-md text-muted-foreground">
                      {t('documentPanel.preview.unsupportedHint')}
                    </div>
                  </div>
                  <div className="flex gap-2">
                    {(data.s3_url || data.raw_kind === 'text') && (
                      <a href={downloadUrl} download className="inline-block">
                        <Button size="sm">
                          <Download className="h-3.5 w-3.5" />
                          {t('documentPanel.preview.download')}
                        </Button>
                      </a>
                    )}
                    <Button variant="outline" size="sm" onClick={() => setActiveTab('extracted')}>
                      {t('documentPanel.preview.goToExtracted')}
                    </Button>
                  </div>
                </div>
              )}
            </TabsContent>

            <TabsContent
              value="extracted"
              className="mt-3 min-h-0 flex-1 overflow-auto data-[state=inactive]:!hidden"
            >
              {data.chunks && data.chunks.length > 0 ? (
                <div className="space-y-3">
                  {data.chunks.map((chunk) => (
                    <ChunkCard key={chunk.id} chunk={chunk} t={t} />
                  ))}
                </div>
              ) : (
                <div className="py-6 text-center text-sm text-muted-foreground">
                  {t('documentPanel.preview.noChunks')}
                </div>
              )}
            </TabsContent>

            <TabsContent
              value="metadata"
              className="mt-3 min-h-0 flex-1 overflow-auto data-[state=inactive]:!hidden"
            >
              <dl className="grid grid-cols-1 gap-x-4 gap-y-2 text-sm sm:grid-cols-[160px_1fr]">
                <dt className="text-muted-foreground">{t('documentPanel.preview.fields.id')}</dt>
                <dd className="break-all font-mono">{data.id}</dd>

                <dt className="text-muted-foreground">{t('documentPanel.preview.fields.status')}</dt>
                <dd>{data.status}</dd>

                <dt className="text-muted-foreground">{t('documentPanel.preview.fields.filePath')}</dt>
                <dd className="break-all">{data.file_path || '-'}</dd>

                <dt className="text-muted-foreground">{t('documentPanel.preview.fields.docName')}</dt>
                <dd className="break-all">{data.doc_nm || '-'}</dd>

                <dt className="text-muted-foreground">{t('documentPanel.preview.fields.mime')}</dt>
                <dd>{data.mime_type || '-'}</dd>

                <dt className="text-muted-foreground">{t('documentPanel.preview.fields.size')}</dt>
                <dd>{formatBytes(data.content_length)}</dd>

                <dt className="text-muted-foreground">{t('documentPanel.preview.fields.chunksCount')}</dt>
                <dd>{data.chunks_count ?? data.chunks?.length ?? 0}</dd>

                <dt className="text-muted-foreground">{t('documentPanel.preview.fields.trackId')}</dt>
                <dd className="break-all font-mono">{data.track_id || '-'}</dd>

                <dt className="text-muted-foreground">{t('documentPanel.preview.fields.createdAt')}</dt>
                <dd>{data.created_at || '-'}</dd>

                <dt className="text-muted-foreground">{t('documentPanel.preview.fields.updatedAt')}</dt>
                <dd>{data.updated_at || '-'}</dd>

                <dt className="text-muted-foreground">{t('documentPanel.preview.fields.s3Url')}</dt>
                <dd className="break-all">
                  {data.s3_url ? (
                    <a
                      href={data.s3_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-primary hover:underline"
                    >
                      <ExternalLink className="h-3 w-3" />
                      {data.s3_url}
                    </a>
                  ) : (
                    '-'
                  )}
                </dd>

                {data.error_msg && (
                  <>
                    <dt className="text-muted-foreground">{t('documentPanel.preview.fields.error')}</dt>
                    <dd className="break-all text-red-600 dark:text-red-400">{data.error_msg}</dd>
                  </>
                )}

                {data.metadata && Object.keys(data.metadata).length > 0 && (
                  <>
                    <dt className="text-muted-foreground">{t('documentPanel.preview.fields.metadata')}</dt>
                    <dd>
                      <pre className="break-all rounded bg-muted/40 p-2 text-xs whitespace-pre-wrap">
                        {JSON.stringify(data.metadata, null, 2)}
                      </pre>
                    </dd>
                  </>
                )}
              </dl>
            </TabsContent>
          </Tabs>
        )}
      </DialogContent>
    </Dialog>
  )
}

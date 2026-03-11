import { useState, useEffect, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { TaskStatusResponse, getTaskStatus } from '@/api/lightrag'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription
} from '@/components/ui/Dialog'
import Badge from '@/components/ui/Badge'
import Progress from '@/components/ui/Progress'
import {
  CheckCircle2,
  XCircle,
  Clock,
  Loader2,
  Ban,
  Image,
  Table2,
  FunctionSquare,
  ChevronDown,
  ChevronRight,
  FileText,
  AlertTriangle
} from 'lucide-react'
import { cn } from '@/lib/utils'

interface TaskResultDialogProps {
  task: TaskStatusResponse | null
  onClose: () => void
}

interface ResultItem {
  type?: string
  entity_name?: string
  entity_type?: string
  description?: string
  chunk_id?: string
  page?: number
  page_idx?: number
  src?: string
  s3_url?: string
  success?: boolean
  error?: string
}

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)}s`
  const mins = Math.floor(seconds / 60)
  const secs = Math.round(seconds % 60)
  return `${mins}m ${secs}s`
}

function formatTimestamp(epoch: number): string {
  // Server returns seconds
  const date = new Date(epoch * 1000)
  return date.toLocaleString()
}

function getTypeIcon(type?: string) {
  switch (type?.toLowerCase()) {
  case 'image':
    return <Image className="h-4 w-4 text-blue-500" />
  case 'table':
    return <Table2 className="h-4 w-4 text-orange-500" />
  case 'equation':
    return <FunctionSquare className="h-4 w-4 text-purple-500" />
  default:
    return <FileText className="h-4 w-4 text-gray-500" />
  }
}

function getStatusIcon(status: string) {
  switch (status) {
  case 'completed':
    return <CheckCircle2 className="h-5 w-5 text-green-500" />
  case 'failed':
    return <XCircle className="h-5 w-5 text-red-500" />
  case 'cancelled':
    return <Ban className="h-5 w-5 text-gray-500" />
  case 'running':
    return <Loader2 className="h-5 w-5 text-blue-500 animate-spin" />
  case 'pending':
    return <Clock className="h-5 w-5 text-yellow-500" />
  default:
    return <Clock className="h-5 w-5 text-gray-400" />
  }
}

function getStatusBadgeVariant(status: string): 'default' | 'secondary' | 'destructive' | 'outline' {
  switch (status) {
  case 'completed':
    return 'default'
  case 'failed':
    return 'destructive'
  default:
    return 'secondary'
  }
}

function ResultItemCard({ item, t }: { item: ResultItem; t: (key: string) => string }) {
  const [expanded, setExpanded] = useState(false)
  const [imgExpanded, setImgExpanded] = useState(false)
  const desc = item.description || ''
  const needsTruncation = desc.length > 200

  // Image preview URL: prefer s3_url (uploaded to S3), fallback to src (original URL)
  const imagePreviewUrl = item.type === 'image' ? (item.s3_url || item.src) : undefined
  const pageNum = item.page ?? item.page_idx

  return (
    <div className={cn(
      'border rounded-md p-3 space-y-1.5',
      item.success === false ? 'border-red-200 bg-red-50/50 dark:border-red-900 dark:bg-red-950/30' : 'bg-card'
    )}>
      <div className="flex items-center gap-2">
        {getTypeIcon(item.type)}
        {item.success === false ? (
          <XCircle className="h-3.5 w-3.5 text-red-500 shrink-0" />
        ) : (
          <CheckCircle2 className="h-3.5 w-3.5 text-green-500 shrink-0" />
        )}
        {item.entity_name && (
          <span className="font-medium text-sm truncate">{item.entity_name}</span>
        )}
        {item.entity_type && (
          <Badge variant="outline" className="text-[10px] shrink-0">{item.entity_type}</Badge>
        )}
      </div>

      {/* Image preview */}
      {imagePreviewUrl && (
        <div className="mt-1">
          <button
            className="block w-full text-left"
            onClick={() => setImgExpanded(!imgExpanded)}
          >
            <img
              src={imagePreviewUrl}
              alt={item.entity_name || 'image'}
              className={cn(
                'rounded border object-contain bg-muted/30 transition-all',
                imgExpanded ? 'max-h-96 w-full' : 'max-h-24 max-w-48'
              )}
              loading="lazy"
              onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }}
            />
          </button>
        </div>
      )}

      {desc && (
        <div className="text-xs text-muted-foreground">
          {needsTruncation && !expanded ? (
            <>
              {desc.slice(0, 200)}...
              <button
                className="ml-1 text-blue-500 hover:underline"
                onClick={() => setExpanded(true)}
              >
                {t('documentPanel.taskResult.showDescription')}
              </button>
            </>
          ) : needsTruncation ? (
            <>
              {desc}
              <button
                className="ml-1 text-blue-500 hover:underline"
                onClick={() => setExpanded(false)}
              >
                {t('documentPanel.taskResult.hideDescription')}
              </button>
            </>
          ) : desc}
        </div>
      )}

      <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
        {pageNum !== undefined && (
          <span>{t('documentPanel.taskResult.page')}: {pageNum}</span>
        )}
        {item.chunk_id && (
          <span className="font-mono">{t('documentPanel.taskResult.chunkId')}: {item.chunk_id}</span>
        )}
      </div>

      {item.src && (
        <div className="text-[11px] text-muted-foreground truncate">
          {t('documentPanel.taskResult.source')}: {item.src}
        </div>
      )}

      {item.error && (
        <div className="text-xs text-red-600 dark:text-red-400 mt-1">
          {item.error}
        </div>
      )}
    </div>
  )
}

export default function TaskResultDialog({ task, onClose }: TaskResultDialogProps) {
  const { t } = useTranslation()
  const [fullTask, setFullTask] = useState<TaskStatusResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [errorsExpanded, setErrorsExpanded] = useState(false)

  const fetchFullTask = useCallback(async (taskId: string) => {
    setLoading(true)
    try {
      const data = await getTaskStatus(taskId)
      setFullTask(data)
    } catch {
      // Use what we have
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!task) {
      setFullTask(null)
      return
    }
    // If task already has result data, use it directly
    if (task.result && Object.keys(task.result).length > 0) {
      setFullTask(task)
    } else {
      // Fetch full task data
      fetchFullTask(task.task_id)
    }
  }, [task, fetchFullTask])

  const displayTask = fullTask || task
  if (!displayTask) return null

  const result = displayTask.result || {}
  const results: ResultItem[] = result.results || result.items || []
  const errors: string[] = result.errors || []
  const totalItems = result.total_items ?? results.length
  const successCount = result.success_count ?? results.filter(r => r.success !== false).length
  const errorCount = result.error_count ?? errors.length

  const taskUrl = displayTask.metadata?.url || displayTask.metadata?.file_name || displayTask.metadata?.file_path_label || ''
  const taskType = displayTask.task_type === 'url_ingest' ? 'URL' : displayTask.task_type === 'multimodal_process' ? 'Multimodal' : displayTask.task_type
  const duration = displayTask.updated_at && displayTask.created_at
    ? displayTask.updated_at - displayTask.created_at
    : null

  return (
    <Dialog open={!!task} onOpenChange={(open) => { if (!open) onClose() }}>
      <DialogContent className="max-w-2xl max-h-[85vh] flex flex-col overflow-hidden">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Badge variant="outline" className="text-xs">{taskType}</Badge>
            <span className="truncate text-base" title={taskUrl}>{taskUrl || displayTask.task_id.slice(0, 12)}</span>
          </DialogTitle>
          <DialogDescription className="flex items-center gap-3 text-xs">
            <span>{t('documentPanel.taskResult.taskId')}: {displayTask.task_id.slice(0, 12)}...</span>
            <span>{t('documentPanel.taskResult.created')}: {formatTimestamp(displayTask.created_at)}</span>
            {duration !== null && duration > 0 && (
              <span>{t('documentPanel.taskResult.duration')}: {formatDuration(duration)}</span>
            )}
          </DialogDescription>
        </DialogHeader>

        {/* Status summary bar */}
        <div className="flex items-center gap-3 py-2 px-3 bg-muted/50 rounded-md">
          {getStatusIcon(displayTask.status)}
          <Badge variant={getStatusBadgeVariant(displayTask.status)}>
            {t(`documentPanel.taskProgress.status.${displayTask.status}`)}
          </Badge>
          {displayTask.status === 'running' && (
            <Progress value={displayTask.progress} className="flex-1 h-2" />
          )}
          {totalItems > 0 && (
            <span className="text-xs text-muted-foreground">
              {t('documentPanel.taskResult.processedItems', { success: successCount, total: totalItems })}
            </span>
          )}
          {errorCount > 0 && (
            <span className="text-xs text-red-600 dark:text-red-400">
              {t('documentPanel.taskResult.errors', { count: errorCount })}
            </span>
          )}
        </div>

        {/* Loading state */}
        {loading && (
          <div className="flex items-center justify-center py-8 text-sm text-muted-foreground gap-2">
            <Loader2 className="h-4 w-4 animate-spin" />
            {t('documentPanel.taskResult.loading')}
          </div>
        )}

        {/* Results section */}
        {!loading && results.length > 0 && (
          <div className="flex flex-col min-h-0 flex-1">
            <h4 className="text-sm font-medium mb-2">{t('documentPanel.taskResult.results')}</h4>
            <div className="flex-1 min-h-0 overflow-y-auto pr-1">
              <div className="space-y-2">
                {results.map((item, idx) => (
                  <ResultItemCard key={idx} item={item} t={t} />
                ))}
              </div>
            </div>
          </div>
        )}

        {/* No results */}
        {!loading && results.length === 0 && displayTask.status !== 'running' && displayTask.status !== 'pending' && (
          <div className="text-sm text-muted-foreground text-center py-4">
            {displayTask.message || t('documentPanel.taskResult.noResults')}
          </div>
        )}

        {/* Running message */}
        {!loading && (displayTask.status === 'running' || displayTask.status === 'pending') && displayTask.message && (
          <div className="text-sm text-muted-foreground text-center py-2">
            {displayTask.message}
          </div>
        )}

        {/* Errors section */}
        {!loading && errors.length > 0 && (
          <div className="border border-red-200 dark:border-red-900 rounded-md overflow-hidden">
            <button
              className="w-full flex items-center gap-2 px-3 py-2 bg-red-50 dark:bg-red-950/30 hover:bg-red-100 dark:hover:bg-red-950/50 transition-colors text-sm text-red-700 dark:text-red-400"
              onClick={() => setErrorsExpanded(!errorsExpanded)}
            >
              <AlertTriangle className="h-4 w-4 shrink-0" />
              {errorsExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
              <span className="font-medium">{t('documentPanel.taskResult.errorList')} ({errors.length})</span>
            </button>
            {errorsExpanded && (
              <div className="px-3 py-2 space-y-1 max-h-40 overflow-y-auto">
                {errors.map((err, idx) => (
                  <div key={idx} className="text-xs text-red-600 dark:text-red-400 font-mono">
                    {err}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Failed task error message */}
        {!loading && displayTask.status === 'failed' && displayTask.error && errors.length === 0 && (
          <div className="border border-red-200 dark:border-red-900 rounded-md px-3 py-2 bg-red-50 dark:bg-red-950/30">
            <div className="text-xs text-red-600 dark:text-red-400 font-mono">
              {displayTask.error}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}

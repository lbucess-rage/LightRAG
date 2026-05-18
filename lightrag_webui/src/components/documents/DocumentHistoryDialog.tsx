import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  ArchiveRestoreIcon,
  Clock3Icon,
  DatabaseIcon,
  HistoryIcon,
  RefreshCwIcon,
  RotateCcwIcon,
  ShieldAlertIcon
} from 'lucide-react'
import { toast } from 'sonner'
import {
  executeRestoreDeletionJob,
  getDocumentHistory,
  previewRestoreDeletionJob
} from '@/api/lightrag'
import type {
  DocStatusResponse,
  DocumentHistoryOperation,
  DocumentHistoryResponse,
  RestorePreviewResponse
} from '@/api/lightrag'
import Button from '@/components/ui/Button'
import Badge from '@/components/ui/Badge'
import { Alert, AlertDescription } from '@/components/ui/Alert'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/Dialog'
import { cn, errorMessage } from '@/lib/utils'

interface DocumentHistoryDialogProps {
  doc: DocStatusResponse | null
  onClose: () => void
  onRestored?: () => Promise<void> | void
}

const formatCountPairs = (counts: Record<string, number>, limit = 6) => {
  return Object.entries(counts || {})
    .filter(([, value]) => value > 0)
    .slice(0, limit)
}

const formatDate = (value?: string | null) => {
  if (!value) return ''
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString()
}

const translateRestoreWarning = (warning: string, t: ReturnType<typeof useTranslation>['t']) => {
  if (warning === 'This deletion job was already restored before; executing restore again is allowed.') {
    return t('documentPanel.recovery.warningAlreadyRestored')
  }
  if (warning === 'Some snapshot rows already exist and will be skipped unless overwrite is enabled.') {
    return t('documentPanel.recovery.warningConflicts')
  }
  if (warning === 'Database and graph data can be restored, but deleted physical files or S3 objects are not recreated.') {
    return t('documentPanel.recovery.warningFilesNotRestored')
  }
  return warning
}

const operationIcon = (operation: DocumentHistoryOperation) => {
  if (operation.source === 'deletion') {
    return operation.operation_type === 'restore_deletion'
      ? <ArchiveRestoreIcon className="h-4 w-4 text-emerald-600" />
      : <ShieldAlertIcon className="h-4 w-4 text-red-600" />
  }
  if (operation.source === 'task') return <Clock3Icon className="h-4 w-4 text-blue-600" />
  return <DatabaseIcon className="h-4 w-4 text-muted-foreground" />
}

const statusBadgeVariant = (status: string) => {
  if (status === 'failed') return 'destructive'
  if (status === 'restored') return 'outline'
  if (status === 'completed' || status === 'processed') return 'secondary'
  return 'outline'
}

export default function DocumentHistoryDialog({ doc, onClose, onRestored }: DocumentHistoryDialogProps) {
  const { t } = useTranslation()
  const [history, setHistory] = useState<DocumentHistoryResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [previewingJobId, setPreviewingJobId] = useState<string | null>(null)
  const [restoringJobId, setRestoringJobId] = useState<string | null>(null)
  const [restorePreview, setRestorePreview] = useState<RestorePreviewResponse | null>(null)
  const [activeRestoreJobId, setActiveRestoreJobId] = useState<string | null>(null)
  const [overwrite, setOverwrite] = useState(false)

  const docLabel = useMemo(() => {
    if (!doc) return ''
    return doc.doc_nm || doc.file_path || doc.id
  }, [doc])

  const loadHistory = useCallback(async () => {
    if (!doc) return
    try {
      setLoading(true)
      const result = await getDocumentHistory(doc.id)
      setHistory(result)
    } catch (err) {
      toast.error(t('documentPanel.history.loadFailed', { error: errorMessage(err) }))
    } finally {
      setLoading(false)
    }
  }, [doc, t])

  useEffect(() => {
    if (!doc) return
    setHistory(null)
    setRestorePreview(null)
    setActiveRestoreJobId(null)
    setOverwrite(false)
    loadHistory()
  }, [doc, loadHistory])

  const handlePreviewRestore = useCallback(async (jobId: string) => {
    try {
      setPreviewingJobId(jobId)
      const result = await previewRestoreDeletionJob(jobId, {
        overwrite,
        invalidate_cache: true,
      })
      setActiveRestoreJobId(jobId)
      setRestorePreview(result)
    } catch (err) {
      toast.error(t('documentPanel.recovery.previewFailed', { error: errorMessage(err) }))
    } finally {
      setPreviewingJobId(null)
    }
  }, [overwrite, t])

  const handleRestore = useCallback(async (jobId: string) => {
    if (!restorePreview?.executable || activeRestoreJobId !== jobId) return
    try {
      setRestoringJobId(jobId)
      await executeRestoreDeletionJob(jobId, {
        overwrite,
        invalidate_cache: true,
      })
      toast.success(t('documentPanel.recovery.restoreSuccess'))
      setRestorePreview(null)
      await loadHistory()
      await onRestored?.()
    } catch (err) {
      toast.error(t('documentPanel.recovery.restoreFailed', { error: errorMessage(err) }))
    } finally {
      setRestoringJobId(null)
    }
  }, [activeRestoreJobId, loadHistory, onRestored, overwrite, restorePreview?.executable, t])

  const previewCounts = restorePreview ? formatCountPairs(restorePreview.counts, 8) : []
  const previewConflicts = restorePreview ? formatCountPairs(restorePreview.conflicts, 8) : []

  return (
    <Dialog open={!!doc} onOpenChange={(open) => { if (!open) onClose() }}>
      <DialogContent className="flex max-h-[86vh] flex-col sm:max-w-4xl" onCloseAutoFocus={(e) => e.preventDefault()}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <HistoryIcon className="h-5 w-5" />
            {t('documentPanel.history.title')}
          </DialogTitle>
          <DialogDescription className="truncate">
            {docLabel}
          </DialogDescription>
        </DialogHeader>

        <div className="flex items-center justify-between gap-3 rounded-md border bg-muted/20 px-3 py-2">
          <div className="min-w-0">
            <div className="truncate font-mono text-xs text-muted-foreground">{doc?.id}</div>
            <div className="mt-1 text-xs text-muted-foreground">
              {t('documentPanel.history.description')}
            </div>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={loadHistory}
            disabled={loading}
            tooltip={t('common.refresh', 'Refresh')}
          >
            <RefreshCwIcon className={cn('h-4 w-4', loading && 'animate-spin')} />
          </Button>
        </div>

        <div className="min-h-[360px] flex-1 overflow-auto rounded-md border">
          {loading && !history ? (
            <div className="px-3 py-12 text-center text-sm text-muted-foreground">
              {t('common.loading', 'Loading...')}
            </div>
          ) : !history || history.operations.length === 0 ? (
            <div className="px-3 py-12 text-center text-sm text-muted-foreground">
              {t('documentPanel.history.empty')}
            </div>
          ) : (
            <div className="divide-y">
              {history.operations.map((operation) => {
                const countPairs = formatCountPairs(operation.counts)
                const isRestorePreviewActive = activeRestoreJobId === operation.restore_job_id && restorePreview
                return (
                  <div key={operation.operation_id} className="space-y-3 px-3 py-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex min-w-0 gap-3">
                        <div className="mt-0.5 shrink-0">{operationIcon(operation)}</div>
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <div className="font-medium">
                              {t(`documentPanel.history.operations.${operation.operation_type}`, operation.title)}
                            </div>
                            <Badge variant={statusBadgeVariant(operation.status)}>
                              {t(`documentPanel.history.status.${operation.status}`, operation.status)}
                            </Badge>
                            <Badge variant="outline">
                              {t(`documentPanel.history.sources.${operation.source}`, operation.source)}
                            </Badge>
                          </div>
                          <div className="mt-1 truncate text-sm text-muted-foreground">
                            {operation.summary || operation.operation_id}
                          </div>
                          <div className="mt-1 flex flex-wrap gap-2 text-xs text-muted-foreground">
                            {operation.created_at && <span>{formatDate(operation.created_at)}</span>}
                            {operation.restore_job_id && <span className="font-mono">{operation.restore_job_id}</span>}
                          </div>
                        </div>
                      </div>
                      {operation.can_restore && operation.restore_job_id && (
                        <div className="flex shrink-0 items-center gap-2">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => handlePreviewRestore(operation.restore_job_id!)}
                            disabled={previewingJobId === operation.restore_job_id}
                          >
                            {previewingJobId === operation.restore_job_id
                              ? t('common.loading', 'Loading...')
                              : t('documentPanel.recovery.preview')}
                          </Button>
                          <Button
                            size="sm"
                            onClick={() => handleRestore(operation.restore_job_id!)}
                            disabled={
                              activeRestoreJobId !== operation.restore_job_id ||
                              !restorePreview?.executable ||
                              restoringJobId === operation.restore_job_id
                            }
                          >
                            <RotateCcwIcon className="h-4 w-4" />
                            {restoringJobId === operation.restore_job_id
                              ? t('documentPanel.recovery.restoring')
                              : t('documentPanel.recovery.restore')}
                          </Button>
                        </div>
                      )}
                    </div>

                    {countPairs.length > 0 && (
                      <div className="ml-7 flex flex-wrap gap-1">
                        {countPairs.map(([key, value]) => (
                          <span key={key} className="rounded bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">
                            {key}: {value}
                          </span>
                        ))}
                      </div>
                    )}

                    {operation.can_restore && operation.restore_job_id && (
                      <label className="ml-7 flex cursor-pointer items-start gap-2 text-xs text-muted-foreground">
                        <input
                          type="checkbox"
                          className="mt-0.5 h-3.5 w-3.5"
                          checked={overwrite}
                          onChange={(event) => {
                            setOverwrite(event.target.checked)
                            setRestorePreview(null)
                          }}
                        />
                        <span>{t('documentPanel.recovery.overwriteDescription')}</span>
                      </label>
                    )}

                    {isRestorePreviewActive && (
                      <div className="ml-7 space-y-2 rounded-md border bg-muted/20 px-3 py-2">
                        <div className="text-xs font-medium">{t('documentPanel.history.restorePreview')}</div>
                        {previewCounts.length > 0 && (
                          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                            {previewCounts.map(([key, value]) => (
                              <div key={key} className="rounded-md bg-background px-2 py-1.5">
                                <div className="truncate text-[11px] text-muted-foreground">{key}</div>
                                <div className="text-sm font-semibold">{value}</div>
                              </div>
                            ))}
                          </div>
                        )}
                        {previewConflicts.length > 0 && (
                          <Alert variant="destructive">
                            <ShieldAlertIcon className="h-4 w-4" />
                            <AlertDescription>
                              <div className="font-medium">{t('documentPanel.recovery.conflicts')}</div>
                              <div className="mt-1 flex flex-wrap gap-1">
                                {previewConflicts.map(([key, value]) => (
                                  <span key={key} className="rounded bg-destructive/10 px-1.5 py-0.5 text-[11px]">
                                    {key}: {value}
                                  </span>
                                ))}
                              </div>
                            </AlertDescription>
                          </Alert>
                        )}
                        {restorePreview.warnings.length > 0 && (
                          <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-200">
                            {restorePreview.warnings.map((warning) => (
                              <div key={warning}>{translateRestoreWarning(warning, t)}</div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {t('common.close', 'Close')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

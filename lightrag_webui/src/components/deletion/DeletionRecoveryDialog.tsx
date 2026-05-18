import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ArchiveRestoreIcon, RefreshCwIcon, RotateCcwIcon, ShieldAlertIcon } from 'lucide-react'
import { toast } from 'sonner'
import Button from '@/components/ui/Button'
import Badge from '@/components/ui/Badge'
import { Alert, AlertDescription } from '@/components/ui/Alert'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger
} from '@/components/ui/Dialog'
import {
  executeRestoreDeletionJob,
  listDeletionJobs,
  previewRestoreDeletionJob
} from '@/api/lightrag'
import type { DeletionJobSummary, RestorePreviewResponse } from '@/api/lightrag'
import { cn, errorMessage } from '@/lib/utils'

interface DeletionRecoveryDialogProps {
  onRestored?: () => Promise<void> | void
}

const formatCountPairs = (counts: Record<string, number>, limit = 4) => {
  return Object.entries(counts || {})
    .filter(([, value]) => value > 0)
    .slice(0, limit)
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

export default function DeletionRecoveryDialog({ onRestored }: DeletionRecoveryDialogProps) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [jobs, setJobs] = useState<DeletionJobSummary[]>([])
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null)
  const [restorePreview, setRestorePreview] = useState<RestorePreviewResponse | null>(null)
  const [overwrite, setOverwrite] = useState(false)
  const [loading, setLoading] = useState(false)
  const [previewing, setPreviewing] = useState(false)
  const [restoring, setRestoring] = useState(false)

  const selectedJob = useMemo(
    () => jobs.find((job) => job.job_id === selectedJobId) ?? null,
    [jobs, selectedJobId]
  )

  const loadJobs = useCallback(async () => {
    try {
      setLoading(true)
      const response = await listDeletionJobs(50)
      setJobs(response.jobs)
      setSelectedJobId((current) => {
        if (current && response.jobs.some((job) => job.job_id === current)) return current
        return response.jobs[0]?.job_id ?? null
      })
    } catch (err) {
      toast.error(t('documentPanel.recovery.loadFailed', { error: errorMessage(err) }))
    } finally {
      setLoading(false)
    }
  }, [t])

  useEffect(() => {
    if (!open) return
    loadJobs()
  }, [loadJobs, open])

  useEffect(() => {
    setRestorePreview(null)
  }, [selectedJobId, overwrite])

  const handlePreview = useCallback(async () => {
    if (!selectedJobId) return
    try {
      setPreviewing(true)
      const result = await previewRestoreDeletionJob(selectedJobId, {
        overwrite,
        invalidate_cache: true,
      })
      setRestorePreview(result)
    } catch (err) {
      toast.error(t('documentPanel.recovery.previewFailed', { error: errorMessage(err) }))
    } finally {
      setPreviewing(false)
    }
  }, [overwrite, selectedJobId, t])

  const handleRestore = useCallback(async () => {
    if (!selectedJobId || !restorePreview?.executable) return
    try {
      setRestoring(true)
      await executeRestoreDeletionJob(selectedJobId, {
        overwrite,
        invalidate_cache: true,
      })
      toast.success(t('documentPanel.recovery.restoreSuccess'))
      await loadJobs()
      await onRestored?.()
    } catch (err) {
      toast.error(t('documentPanel.recovery.restoreFailed', { error: errorMessage(err) }))
    } finally {
      setRestoring(false)
    }
  }, [loadJobs, onRestored, overwrite, restorePreview?.executable, selectedJobId, t])

  const previewCounts = restorePreview ? formatCountPairs(restorePreview.counts, 8) : []
  const previewConflicts = restorePreview ? formatCountPairs(restorePreview.conflicts, 8) : []

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          side="bottom"
          tooltip={t('documentPanel.recovery.tooltip')}
        >
          <ArchiveRestoreIcon className="h-4 w-4" />
          {t('documentPanel.recovery.button')}
        </Button>
      </DialogTrigger>
      <DialogContent className="flex max-h-[85vh] flex-col sm:max-w-4xl" onCloseAutoFocus={(e) => e.preventDefault()}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ArchiveRestoreIcon className="h-5 w-5" />
            {t('documentPanel.recovery.title')}
          </DialogTitle>
          <DialogDescription>
            {t('documentPanel.recovery.description')}
          </DialogDescription>
        </DialogHeader>

        <div className="grid min-h-0 flex-1 gap-4 md:grid-cols-[minmax(0,1fr)_minmax(280px,0.8fr)]">
          <div className="min-h-[320px] overflow-hidden rounded-md border">
            <div className="flex items-center justify-between border-b bg-muted/30 px-3 py-2">
              <div className="text-sm font-medium">{t('documentPanel.recovery.recentJobs')}</div>
              <Button
                variant="ghost"
                size="sm"
                onClick={loadJobs}
                disabled={loading}
                tooltip={t('common.refresh', 'Refresh')}
              >
                <RefreshCwIcon className={cn('h-4 w-4', loading && 'animate-spin')} />
              </Button>
            </div>
            <div className="max-h-[52vh] overflow-auto">
              {jobs.length === 0 ? (
                <div className="px-3 py-10 text-center text-sm text-muted-foreground">
                  {loading ? t('common.loading', 'Loading...') : t('documentPanel.recovery.empty')}
                </div>
              ) : (
                jobs.map((job) => {
                  const countPairs = formatCountPairs(job.counts)
                  return (
                    <button
                      key={job.job_id}
                      type="button"
                      className={cn(
                        'flex w-full flex-col gap-2 border-b px-3 py-3 text-left last:border-b-0 hover:bg-muted/50',
                        selectedJobId === job.job_id && 'bg-emerald-50 dark:bg-emerald-950/20'
                      )}
                      onClick={() => setSelectedJobId(job.job_id)}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="min-w-0 truncate font-mono text-xs">{job.job_id}</div>
                        <Badge variant={job.restored_at ? 'outline' : 'secondary'}>
                          {job.restored_at
                            ? t('documentPanel.recovery.restored')
                            : t('documentPanel.recovery.restorable')}
                        </Badge>
                      </div>
                      <div className="flex flex-wrap gap-1.5 text-xs text-muted-foreground">
                        <span>{job.target_type}</span>
                        <span>{job.policy}</span>
                        {job.created_at && <span>{new Date(job.created_at).toLocaleString()}</span>}
                      </div>
                      {countPairs.length > 0 && (
                        <div className="flex flex-wrap gap-1">
                          {countPairs.map(([key, value]) => (
                            <span key={key} className="rounded bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">
                              {key}: {value}
                            </span>
                          ))}
                        </div>
                      )}
                    </button>
                  )
                })
              )}
            </div>
          </div>

          <div className="min-h-[320px] space-y-3">
            <div className="rounded-md border px-3 py-3">
              <div className="text-sm font-medium">{t('documentPanel.recovery.restoreOptions')}</div>
              <label className="mt-3 flex cursor-pointer items-start gap-2 text-sm">
                <input
                  type="checkbox"
                  className="mt-1 h-4 w-4"
                  checked={overwrite}
                  onChange={(event) => setOverwrite(event.target.checked)}
                />
                <span>
                  <span className="font-medium">{t('documentPanel.recovery.overwrite')}</span>
                  <span className="mt-0.5 block text-xs text-muted-foreground">
                    {t('documentPanel.recovery.overwriteDescription')}
                  </span>
                </span>
              </label>
            </div>

            <div className="rounded-md border px-3 py-3">
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <div className="text-sm font-medium">{t('documentPanel.recovery.selectedJob')}</div>
                  <div className="mt-1 truncate font-mono text-xs text-muted-foreground">
                    {selectedJob?.job_id ?? t('documentPanel.recovery.noSelection')}
                  </div>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handlePreview}
                  disabled={!selectedJobId || previewing}
                >
                  {previewing ? t('common.loading', 'Loading...') : t('documentPanel.recovery.preview')}
                </Button>
              </div>

              {selectedJob?.restored_at && (
                <Alert className="mt-3">
                  <ShieldAlertIcon className="h-4 w-4" />
                  <AlertDescription>
                    {t('documentPanel.recovery.alreadyRestored')}
                  </AlertDescription>
                </Alert>
              )}

              {restorePreview && (
                <div className="mt-3 space-y-3">
                  <div className="grid grid-cols-2 gap-2">
                    {previewCounts.map(([key, value]) => (
                      <div key={key} className="rounded-md bg-muted/40 px-2 py-1.5">
                        <div className="truncate text-[11px] text-muted-foreground">{key}</div>
                        <div className="text-sm font-semibold">{value}</div>
                      </div>
                    ))}
                  </div>

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
          </div>
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => setOpen(false)}>
            {t('common.close', 'Close')}
          </Button>
          <Button
            onClick={handleRestore}
            disabled={!restorePreview?.executable || restoring}
          >
            <RotateCcwIcon className="h-4 w-4" />
            {restoring ? t('documentPanel.recovery.restoring') : t('documentPanel.recovery.restore')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

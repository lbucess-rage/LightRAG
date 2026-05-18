import { useState, useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { ActivityIcon, AlignLeft, AlignCenter, AlignRight, EyeIcon, XCircleIcon } from 'lucide-react'

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription
} from '@/components/ui/Dialog'
import Button from '@/components/ui/Button'
import Badge from '@/components/ui/Badge'
import Progress from '@/components/ui/Progress'
import {
  cancelPipeline,
  cancelTask,
  getPipelineStatus,
  listTasks,
  PipelineStatusResponse,
  TaskStatusResponse
} from '@/api/lightrag'
import TaskResultDialog from '@/components/documents/TaskResultDialog'
import { errorMessage } from '@/lib/utils'
import { cn } from '@/lib/utils'

type DialogPosition = 'left' | 'center' | 'right'

interface PipelineStatusDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

const isActiveTask = (task: TaskStatusResponse) =>
  task.status === 'pending' || task.status === 'running'

const taskLabel = (task: TaskStatusResponse) =>
  task.metadata?.file_name ||
  task.metadata?.file_path_label ||
  task.metadata?.url ||
  task.metadata?.track_id ||
  task.task_id.slice(0, 8)

const taskTypeLabel = (taskType: string) => {
  if (taskType === 'multimodal_process') return 'MM'
  if (taskType === 'document_ingest') return 'DOC'
  if (taskType === 'document_scan') return 'SCAN'
  if (taskType === 'url_ingest') return 'URL'
  if (taskType === 'board_ingest') return 'BOARD'
  return taskType
}

export default function PipelineStatusDialog({
  open,
  onOpenChange
}: PipelineStatusDialogProps) {
  const { t } = useTranslation()
  const [status, setStatus] = useState<PipelineStatusResponse | null>(null)
  const [position, setPosition] = useState<DialogPosition>('center')
  const [isUserScrolled, setIsUserScrolled] = useState(false)
  const [showCancelConfirm, setShowCancelConfirm] = useState(false)
  const [asyncTasks, setAsyncTasks] = useState<TaskStatusResponse[]>([])
  const [selectedTask, setSelectedTask] = useState<TaskStatusResponse | null>(null)
  const [cancellingTaskId, setCancellingTaskId] = useState<string | null>(null)
  const historyRef = useRef<HTMLDivElement>(null)

  // Reset position when dialog opens
  useEffect(() => {
    if (open) {
      setPosition('center')
      setIsUserScrolled(false)
    } else {
      // Reset confirmation dialog state when main dialog closes
      setShowCancelConfirm(false)
    }
  }, [open])

  // Handle scroll position
  useEffect(() => {
    const container = historyRef.current
    if (!container || isUserScrolled) return

    container.scrollTop = container.scrollHeight
  }, [status?.history_messages, isUserScrolled])

  const handleScroll = () => {
    const container = historyRef.current
    if (!container) return

    const isAtBottom = Math.abs(
      (container.scrollHeight - container.scrollTop) - container.clientHeight
    ) < 1

    if (isAtBottom) {
      setIsUserScrolled(false)
    } else {
      setIsUserScrolled(true)
    }
  }

  // Refresh status every 2 seconds
  useEffect(() => {
    if (!open) return

    const fetchStatus = async () => {
      try {
        const [data, tasks] = await Promise.all([
          getPipelineStatus(),
          listTasks(),
        ])
        setStatus(data)
        setAsyncTasks(
          tasks
            .sort((a, b) => b.created_at - a.created_at)
            .filter((task, index) => isActiveTask(task) || index < 5)
        )
      } catch (err) {
        toast.error(t('documentPanel.pipelineStatus.errors.fetchFailed', { error: errorMessage(err) }))
      }
    }

    fetchStatus()
    const interval = setInterval(fetchStatus, 2000)
    return () => clearInterval(interval)
  }, [open, t])

  // Handle cancel pipeline confirmation
  const handleConfirmCancel = async () => {
    setShowCancelConfirm(false)
    try {
      const result = await cancelPipeline()
      if (result.status === 'cancellation_requested') {
        toast.success(t('documentPanel.pipelineStatus.cancelSuccess'))
      } else if (result.status === 'not_busy') {
        toast.info(t('documentPanel.pipelineStatus.cancelNotBusy'))
      }
    } catch (err) {
      toast.error(t('documentPanel.pipelineStatus.cancelFailed', { error: errorMessage(err) }))
    }
  }

  const handleCancelTask = async (taskId: string) => {
    try {
      setCancellingTaskId(taskId)
      await cancelTask(taskId)
      toast.success(t('documentPanel.taskProgress.cancellationRequested'))
      const tasks = await listTasks()
      setAsyncTasks(
        tasks
          .sort((a, b) => b.created_at - a.created_at)
          .filter((task, index) => isActiveTask(task) || index < 5)
      )
    } catch (err) {
      toast.error(t('documentPanel.taskProgress.cancelFailed', { error: errorMessage(err) }))
    } finally {
      setCancellingTaskId(null)
    }
  }

  // Determine if cancel button should be enabled
  const canCancel = status?.busy === true && !status?.cancellation_requested

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className={cn(
          'sm:max-w-[800px] transition-all duration-200 fixed',
          position === 'left' && '!left-[25%] !translate-x-[-50%] !mx-4',
          position === 'center' && '!left-1/2 !-translate-x-1/2',
          position === 'right' && '!left-[75%] !translate-x-[-50%] !mx-4'
        )}
      >
        <DialogDescription className="sr-only">
          {status?.job_name
            ? `${t('documentPanel.pipelineStatus.jobName')}: ${status.job_name}, ${t('documentPanel.pipelineStatus.progress')}: ${status.cur_batch}/${status.batchs}`
            : t('documentPanel.pipelineStatus.noActiveJob')
          }
        </DialogDescription>
        <DialogHeader className="flex flex-row items-center">
          <DialogTitle className="flex-1">
            {t('documentPanel.pipelineStatus.title')}
          </DialogTitle>

          {/* Position control buttons */}
          <div className="flex items-center gap-2 mr-8">
            <Button
              variant="ghost"
              size="icon"
              className={cn(
                'h-6 w-6',
                position === 'left' && 'bg-zinc-200 text-zinc-800 hover:bg-zinc-300 dark:bg-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-600'
              )}
              onClick={() => setPosition('left')}
            >
              <AlignLeft className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className={cn(
                'h-6 w-6',
                position === 'center' && 'bg-zinc-200 text-zinc-800 hover:bg-zinc-300 dark:bg-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-600'
              )}
              onClick={() => setPosition('center')}
            >
              <AlignCenter className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className={cn(
                'h-6 w-6',
                position === 'right' && 'bg-zinc-200 text-zinc-800 hover:bg-zinc-300 dark:bg-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-600'
              )}
              onClick={() => setPosition('right')}
            >
              <AlignRight className="h-4 w-4" />
            </Button>
          </div>
        </DialogHeader>

        {/* Status Content */}
        <div className="space-y-4 pt-4">
          {/* Pipeline Status - with cancel button */}
          <div className="flex flex-wrap items-center justify-between gap-4">
            {/* Left side: Status indicators */}
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-2">
                <div className="text-sm font-medium">{t('documentPanel.pipelineStatus.busy')}:</div>
                <div className={`h-2 w-2 rounded-full ${status?.busy ? 'bg-green-500' : 'bg-gray-300'}`} />
              </div>
              <div className="flex items-center gap-2">
                <div className="text-sm font-medium">{t('documentPanel.pipelineStatus.requestPending')}:</div>
                <div className={`h-2 w-2 rounded-full ${status?.request_pending ? 'bg-green-500' : 'bg-gray-300'}`} />
              </div>
              {/* Only show cancellation status when it's requested */}
              {status?.cancellation_requested && (
                <div className="flex items-center gap-2">
                  <div className="text-sm font-medium">{t('documentPanel.pipelineStatus.cancellationRequested')}:</div>
                  <div className="h-2 w-2 rounded-full bg-red-500" />
                </div>
              )}
            </div>

            {/* Right side: Cancel button - only show when pipeline is busy */}
            {status?.busy && (
              <Button
                variant="destructive"
                size="sm"
                disabled={!canCancel}
                onClick={() => setShowCancelConfirm(true)}
                title={
                  status?.cancellation_requested
                    ? t('documentPanel.pipelineStatus.cancelInProgress')
                    : t('documentPanel.pipelineStatus.cancelTooltip')
                }
              >
                {t('documentPanel.pipelineStatus.cancelButton')}
              </Button>
            )}
          </div>

          {/* Job Information */}
          <div className="rounded-md border p-3 space-y-2">
            <div>{t('documentPanel.pipelineStatus.jobName')}: {status?.job_name || '-'}</div>
            <div className="flex justify-between">
              <span>{t('documentPanel.pipelineStatus.startTime')}: {status?.job_start
                ? new Date(status.job_start).toLocaleString(undefined, {
                  year: 'numeric',
                  month: 'numeric',
                  day: 'numeric',
                  hour: 'numeric',
                  minute: 'numeric',
                  second: 'numeric'
                })
                : '-'}</span>
              <span>{t('documentPanel.pipelineStatus.progress')}: {status ? `${status.cur_batch}/${status.batchs} ${t('documentPanel.pipelineStatus.unit')}` : '-'}</span>
            </div>
          </div>

          {/* Async Task Status */}
          <div className="rounded-md border p-3 space-y-3">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 text-sm font-medium">
                <ActivityIcon className={cn(
                  'h-4 w-4',
                  asyncTasks.some(isActiveTask) ? 'animate-pulse text-blue-500' : 'text-muted-foreground'
                )} />
                {t('documentPanel.pipelineStatus.asyncTasks')}
              </div>
              {asyncTasks.some(isActiveTask) && (
                <Badge variant="default">
                  {asyncTasks.filter(isActiveTask).length}
                </Badge>
              )}
            </div>

            {asyncTasks.length === 0 ? (
              <div className="rounded-md bg-muted/30 px-3 py-4 text-center text-sm text-muted-foreground">
                {t('documentPanel.pipelineStatus.noAsyncTasks')}
              </div>
            ) : (
              <div className="space-y-2">
                {asyncTasks.map((task) => {
                  const active = isActiveTask(task)
                  const label = taskLabel(task)
                  return (
                    <div key={task.task_id} className="rounded-md border bg-background px-3 py-2">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <div className="flex min-w-0 items-center gap-2">
                            <Badge variant="outline" className="shrink-0 text-[10px]">
                              {taskTypeLabel(task.task_type)}
                            </Badge>
                            <span className="truncate text-sm font-medium" title={label}>
                              {label}
                            </span>
                            <Badge
                              variant={task.status === 'failed' ? 'destructive' : active ? 'default' : 'secondary'}
                              className="shrink-0"
                            >
                              {t(`documentPanel.taskProgress.status.${task.status}`)}
                            </Badge>
                          </div>
                          <div className="mt-1 text-xs text-muted-foreground">
                            {task.message || task.task_id}
                          </div>
                          <div className="mt-2 flex items-center gap-2">
                            <Progress value={task.progress} className="h-2 flex-1" />
                            <span className="w-10 text-right text-xs text-muted-foreground">
                              {Math.round(task.progress)}%
                            </span>
                          </div>
                        </div>
                        <div className="flex shrink-0 items-center gap-1">
                          {(task.status === 'completed' || task.status === 'failed') && (
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7"
                              onClick={() => setSelectedTask(task)}
                              tooltip={t('documentPanel.activeTasks.viewResult')}
                            >
                              <EyeIcon className="h-4 w-4" />
                            </Button>
                          )}
                          {active && (
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7 text-destructive hover:text-destructive"
                              onClick={() => handleCancelTask(task.task_id)}
                              disabled={cancellingTaskId === task.task_id}
                              tooltip={t('common.cancel')}
                            >
                              <XCircleIcon className="h-4 w-4" />
                            </Button>
                          )}
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>

          {/* History Messages */}
          <div className="space-y-2">
            <div className="text-sm font-medium">{t('documentPanel.pipelineStatus.pipelineMessages')}:</div>
            <div
              ref={historyRef}
              onScroll={handleScroll}
              className="font-mono text-xs rounded-md bg-zinc-800 text-zinc-100 p-3 overflow-y-auto overflow-x-hidden min-h-[7.5em] max-h-[40vh]"
            >
              {status?.history_messages?.length ? (
                status.history_messages.map((msg, idx) => (
                  <div key={idx} className="whitespace-pre-wrap break-all">{msg}</div>
                ))
              ) : '-'}
            </div>
          </div>
        </div>
      </DialogContent>

      {/* Cancel Confirmation Dialog */}
      <Dialog open={showCancelConfirm} onOpenChange={setShowCancelConfirm}>
        <DialogContent className="sm:max-w-[425px]">
          <DialogHeader>
            <DialogTitle>{t('documentPanel.pipelineStatus.cancelConfirmTitle')}</DialogTitle>
            <DialogDescription>
              {t('documentPanel.pipelineStatus.cancelConfirmDescription')}
            </DialogDescription>
          </DialogHeader>
          <div className="flex justify-end gap-3 mt-4">
            <Button
              variant="outline"
              onClick={() => setShowCancelConfirm(false)}
            >
              {t('common.cancel')}
            </Button>
            <Button
              variant="destructive"
              onClick={handleConfirmCancel}
            >
              {t('documentPanel.pipelineStatus.cancelConfirmButton')}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
      <TaskResultDialog task={selectedTask} onClose={() => setSelectedTask(null)} />
    </Dialog>
  )
}

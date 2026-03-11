import { useState, useEffect, useRef, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import Progress from '@/components/ui/Progress'
import Badge from '@/components/ui/Badge'
import Button from '@/components/ui/Button'
import { ScrollArea } from '@/components/ui/ScrollArea'
import { streamTaskProgress, cancelTask, TaskProgressEvent, TaskStatus } from '@/api/lightrag'
import { XCircle, CheckCircle2, AlertCircle, Loader2, Clock } from 'lucide-react'
import { cn } from '@/lib/utils'

interface TaskProgressPanelProps {
  taskId: string
  onComplete?: (result?: Record<string, any>) => void
  onError?: (error: string) => void
  onCancel?: () => void
  showCancel?: boolean
  compact?: boolean
}

const statusConfig: Record<TaskStatus, {
  icon: typeof CheckCircle2
  color: string
  badgeVariant: 'default' | 'secondary' | 'destructive' | 'outline'
}> = {
  pending: { icon: Clock, color: 'text-yellow-500', badgeVariant: 'outline' },
  running: { icon: Loader2, color: 'text-blue-500', badgeVariant: 'default' },
  completed: { icon: CheckCircle2, color: 'text-green-500', badgeVariant: 'secondary' },
  failed: { icon: AlertCircle, color: 'text-red-500', badgeVariant: 'destructive' },
  cancelled: { icon: XCircle, color: 'text-gray-500', badgeVariant: 'outline' },
}

export default function TaskProgressPanel({
  taskId,
  onComplete,
  onError,
  onCancel,
  showCancel = true,
  compact = false,
}: TaskProgressPanelProps) {
  const { t } = useTranslation()
  const [status, setStatus] = useState<TaskStatus>('pending')
  const [progress, setProgress] = useState(0)
  const [messages, setMessages] = useState<Array<{ time: string; text: string }>>([])
  const [error, setError] = useState<string | null>(null)
  const [isCancelling, setIsCancelling] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)
  const controllerRef = useRef<AbortController | null>(null)
  const isUserScrolling = useRef(false)

  const addMessage = useCallback((text: string) => {
    const time = new Date().toLocaleTimeString()
    setMessages(prev => [...prev, { time, text }])
  }, [])

  useEffect(() => {
    if (!taskId) return

    const controller = streamTaskProgress(
      taskId,
      (event: TaskProgressEvent) => {
        setStatus(event.status)
        setProgress(event.progress)
        if (event.message) {
          addMessage(event.message)
        }

        if (event.status === 'completed') {
          onComplete?.(event.detail)
        } else if (event.status === 'failed') {
          const errMsg = event.message || t('documentPanel.taskProgress.unknownError')
          setError(errMsg)
          onError?.(errMsg)
        } else if (event.status === 'cancelled') {
          onCancel?.()
        }
      },
      (errMsg: string) => {
        setError(errMsg)
        setStatus('failed')
        onError?.(errMsg)
      }
    )

    controllerRef.current = controller

    return () => {
      controller.abort()
    }
  }, [taskId, addMessage, onComplete, onError, onCancel, t])

  // Auto-scroll to bottom
  useEffect(() => {
    if (!isUserScrolling.current && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [messages])

  const handleScroll = useCallback(() => {
    if (!scrollRef.current) return
    const { scrollTop, scrollHeight, clientHeight } = scrollRef.current
    isUserScrolling.current = scrollHeight - scrollTop - clientHeight > 30
  }, [])

  const handleCancel = useCallback(async () => {
    setIsCancelling(true)
    try {
      await cancelTask(taskId)
      addMessage(t('documentPanel.taskProgress.cancellationRequested'))
    } catch {
      addMessage(t('documentPanel.taskProgress.cancelFailed'))
    } finally {
      setIsCancelling(false)
    }
  }, [taskId, addMessage, t])

  const isTerminal = status === 'completed' || status === 'failed' || status === 'cancelled'
  const config = statusConfig[status] || statusConfig.pending
  const StatusIcon = config.icon

  return (
    <div className={cn('space-y-3', compact && 'space-y-2')}>
      {/* Status header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <StatusIcon className={cn('h-4 w-4', config.color, status === 'running' && 'animate-spin')} />
          <Badge variant={config.badgeVariant}>
            {t(`documentPanel.taskProgress.status.${status}`)}
          </Badge>
        </div>
        {showCancel && !isTerminal && (
          <Button
            variant="outline"
            size="sm"
            onClick={handleCancel}
            disabled={isCancelling}
          >
            <XCircle className="h-3 w-3 mr-1" />
            {isCancelling ? t('documentPanel.taskProgress.cancelling') : t('common.cancel')}
          </Button>
        )}
      </div>

      {/* Progress bar */}
      <div className="space-y-1">
        <Progress value={progress} className="h-2" />
        <p className="text-xs text-muted-foreground text-right">{Math.round(progress)}%</p>
      </div>

      {/* Error display */}
      {error && (
        <div className="p-2 rounded bg-destructive/10 text-destructive text-sm">
          {error}
        </div>
      )}

      {/* Message log */}
      {messages.length > 0 && (
        <ScrollArea className={cn('border rounded-md', compact ? 'h-24' : 'h-36')}>
          <div
            ref={scrollRef}
            className={cn('p-2 space-y-1 overflow-y-auto', compact ? 'h-24' : 'h-36')}
            onScroll={handleScroll}
          >
            {messages.map((msg, i) => (
              <div key={i} className="flex gap-2 text-xs">
                <span className="text-muted-foreground shrink-0 font-mono">{msg.time}</span>
                <span className="text-foreground">{msg.text}</span>
              </div>
            ))}
          </div>
        </ScrollArea>
      )}
    </div>
  )
}

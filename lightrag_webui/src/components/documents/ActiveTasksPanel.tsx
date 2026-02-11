import { useState, useEffect, useCallback, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { listTasks, TaskStatusResponse } from '@/api/lightrag'
import TaskProgressPanel from './TaskProgressPanel'
import Badge from '@/components/ui/Badge'
import Button from '@/components/ui/Button'
import { ChevronDown, ChevronUp, Activity, X } from 'lucide-react'
import { cn } from '@/lib/utils'

interface ActiveTasksPanelProps {
  onTaskComplete?: () => void
}

export default function ActiveTasksPanel({ onTaskComplete }: ActiveTasksPanelProps) {
  const { t } = useTranslation()
  const [tasks, setTasks] = useState<TaskStatusResponse[]>([])
  const [expanded, setExpanded] = useState(true)
  const [dismissedIds, setDismissedIds] = useState<Set<string>>(new Set())
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const fetchTasks = useCallback(async () => {
    try {
      const allTasks = await listTasks()
      // Show non-dismissed tasks, sorted by creation time desc
      const visible = allTasks
        .filter(t => !dismissedIds.has(t.task_id))
        .sort((a, b) => b.created_at - a.created_at)
      setTasks(visible)
    } catch {
      // Silently ignore — panel is optional
    }
  }, [dismissedIds])

  useEffect(() => {
    fetchTasks()
    // Poll every 5 seconds
    pollRef.current = setInterval(fetchTasks, 5000)
    return () => {
      if (pollRef.current) clearInterval(pollRef.current)
    }
  }, [fetchTasks])

  const handleDismiss = useCallback((taskId: string) => {
    setDismissedIds(prev => new Set(prev).add(taskId))
  }, [])

  const handleTaskComplete = useCallback(() => {
    // Refresh task list and notify parent
    fetchTasks()
    onTaskComplete?.()
  }, [fetchTasks, onTaskComplete])

  // Count active (non-terminal) tasks
  const activeTasks = tasks.filter(t => t.status === 'pending' || t.status === 'running')
  const terminalTasks = tasks.filter(t => t.status === 'completed' || t.status === 'failed' || t.status === 'cancelled')

  // Don't render if no tasks at all
  if (tasks.length === 0) return null

  return (
    <div className="border rounded-md bg-card mb-2">
      {/* Header */}
      <div
        className="flex items-center justify-between px-3 py-2 cursor-pointer hover:bg-muted/50 transition-colors"
        onClick={() => setExpanded(!expanded)}
      >
        <div className="flex items-center gap-2">
          <Activity className={cn('h-4 w-4', activeTasks.length > 0 ? 'text-blue-500 animate-pulse' : 'text-muted-foreground')} />
          <span className="text-sm font-medium">{t('documentPanel.activeTasks.title')}</span>
          {activeTasks.length > 0 && (
            <Badge variant="default" className="text-xs">
              {activeTasks.length}
            </Badge>
          )}
          {terminalTasks.length > 0 && (
            <Badge variant="outline" className="text-xs">
              {terminalTasks.length} {t('documentPanel.activeTasks.done')}
            </Badge>
          )}
        </div>
        {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
      </div>

      {/* Task list */}
      {expanded && (
        <div className="px-3 pb-3 space-y-2 max-h-80 overflow-y-auto">
          {tasks.map((task) => {
            const isTerminal = task.status === 'completed' || task.status === 'failed' || task.status === 'cancelled'
            const taskUrl = task.metadata?.url || task.task_id.slice(0, 8)
            const taskType = task.task_type === 'url_ingest' ? 'URL' : task.task_type === 'multimodal_process' ? 'MM' : task.task_type
            const depth = task.metadata?.crawl_depth

            return (
              <div key={task.task_id} className="border rounded-md p-2 bg-background">
                {/* Task header */}
                <div className="flex items-center justify-between mb-1">
                  <div className="flex items-center gap-1.5 min-w-0">
                    <Badge variant="outline" className="text-[10px] shrink-0">{taskType}</Badge>
                    {depth !== undefined && depth > 0 && (
                      <Badge variant="secondary" className="text-[10px] shrink-0">
                        D{depth}
                      </Badge>
                    )}
                    <span className="text-xs text-muted-foreground truncate" title={taskUrl}>
                      {taskUrl}
                    </span>
                  </div>
                  {isTerminal && (
                    <button
                      className="p-0.5 rounded hover:bg-muted shrink-0"
                      onClick={(e: React.MouseEvent) => {
                        e.stopPropagation()
                        handleDismiss(task.task_id)
                      }}
                      title={t('documentPanel.activeTasks.dismiss')}
                    >
                      <X className="h-3 w-3 text-muted-foreground" />
                    </button>
                  )}
                </div>
                {/* Progress */}
                {isTerminal ? (
                  <div className="text-xs text-muted-foreground">
                    {task.status === 'completed' && (
                      <span className="text-green-600">{t('documentPanel.taskProgress.status.completed')}</span>
                    )}
                    {task.status === 'failed' && (
                      <span className="text-red-600">{t('documentPanel.taskProgress.status.failed')}: {task.error || task.message}</span>
                    )}
                    {task.status === 'cancelled' && (
                      <span className="text-gray-500">{t('documentPanel.taskProgress.status.cancelled')}</span>
                    )}
                  </div>
                ) : (
                  <TaskProgressPanel
                    taskId={task.task_id}
                    onComplete={handleTaskComplete}
                    compact={true}
                    showCancel={true}
                  />
                )}
              </div>
            )
          })}

          {/* Clear all completed */}
          {terminalTasks.length > 1 && (
            <Button
              variant="ghost"
              size="sm"
              className="w-full text-xs"
              onClick={() => {
                const ids = terminalTasks.map(t => t.task_id)
                setDismissedIds(prev => {
                  const next = new Set(prev)
                  ids.forEach(id => next.add(id))
                  return next
                })
              }}
            >
              {t('documentPanel.activeTasks.clearCompleted')}
            </Button>
          )}
        </div>
      )}
    </div>
  )
}

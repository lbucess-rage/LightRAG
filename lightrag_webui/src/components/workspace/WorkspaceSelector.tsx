import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/DropdownMenu'
import Button from '@/components/ui/Button'
import { useWorkspaceStore } from '@/stores/workspace'
import { useSettingsStore } from '@/stores/settings'
import { cn } from '@/lib/utils'
import { AnswerStatsResponse, getAnswerStats, getWorkspaceMode, WorkspaceInfo } from '@/api/lightrag'
import { Building2Icon, CheckIcon, Loader2Icon, ChevronDownIcon, SettingsIcon } from 'lucide-react'

export default function WorkspaceSelector() {
  const { t } = useTranslation()
  const [answerStatsByWorkspace, setAnswerStatsByWorkspace] = useState<Record<string, AnswerStatsResponse>>({})

  const currentWorkspaceId = useWorkspaceStore.use.currentWorkspaceId()
  const workspaces = useWorkspaceStore.use.workspaces()
  const isLoading = useWorkspaceStore.use.isLoading()
  const setCurrentWorkspaceId = useWorkspaceStore.use.setCurrentWorkspaceId()
  const fetchWorkspaces = useWorkspaceStore.use.fetchWorkspaces()
  const setCurrentTab = useSettingsStore.use.setCurrentTab()
  const fetchedOnMountRef = useRef(false)

  // Fetch workspaces on mount
  useEffect(() => {
    if (fetchedOnMountRef.current) return
    fetchedOnMountRef.current = true
    useWorkspaceStore.getState().fetchWorkspaces()
  }, [])

  // Find current workspace info
  const currentWorkspace = workspaces.find(ws => ws.workspace_id === currentWorkspaceId)
  const displayName = currentWorkspace?.name || currentWorkspaceId || 'base'

  const refreshAnswerStats = useCallback(() => {
    const answerWorkspaces = workspaces.filter((workspace) => {
      const mode = getWorkspaceMode(workspace)
      return mode === 'answer_catalog' || mode === 'hybrid'
    })
    if (answerWorkspaces.length === 0) return () => {}

    let cancelled = false
    Promise.all(
      answerWorkspaces.map(async (workspace) => {
        try {
          const stats = await getAnswerStats(workspace.workspace_id)
          return [workspace.workspace_id, stats] as const
        } catch {
          return [workspace.workspace_id, null] as const
        }
      })
    ).then((entries) => {
      if (cancelled) return
      setAnswerStatsByWorkspace((previous) => {
        const next = { ...previous }
        for (const [workspaceId, stats] of entries) {
          if (stats) next[workspaceId] = stats
        }
        return next
      })
    })

    return () => {
      cancelled = true
    }
  }, [workspaces])

  // Refresh workspace list and FAQ counters when dropdown opens.
  const handleOpenChange = (open: boolean) => {
    if (open) {
      fetchWorkspaces()
      refreshAnswerStats()
    }
  }

  useEffect(() => refreshAnswerStats(), [refreshAnswerStats])

  const getWorkspaceSummary = (workspace: WorkspaceInfo) => {
    const mode = getWorkspaceMode(workspace)
    const answerStats = answerStatsByWorkspace[workspace.workspace_id]
    const answerTotal = Number(answerStats?.answers?.total || 0)
    const publishedAnswers = Number(answerStats?.answers?.published || 0)
    const queryEvents = Number(answerStats?.events?.resolves || 0) + Number(answerStats?.events?.searches || 0)

    if (mode === 'answer_catalog') {
      return [
        `${answerTotal.toLocaleString()} ${t('workspace.answerItems', 'Answers')}`,
        `${publishedAnswers.toLocaleString()} ${t('workspace.publishedAnswers', 'Published')}`,
        `${queryEvents.toLocaleString()} ${t('workspace.resolveEvents', 'Lookups')}`,
      ].join(' · ')
    }

    if (mode === 'hybrid') {
      return [
        `${workspace.document_count.toLocaleString()} ${t('workspace.documents', 'Documents')}`,
        `${answerTotal.toLocaleString()} ${t('workspace.answerItems', 'Answers')}`,
        `${queryEvents.toLocaleString()} ${t('workspace.resolveEvents', 'Lookups')}`,
      ].join(' · ')
    }

    return t('workspace.docsCount', '{{count}} docs', { count: workspace.document_count })
  }

  const getWorkspaceModeLabel = (workspace: WorkspaceInfo) => {
    const mode = getWorkspaceMode(workspace)
    if (mode === 'answer_catalog') return t('workspace.modeAnswerCatalog', 'FAQ / Approved Answers')
    if (mode === 'hybrid') return t('workspace.modeHybrid', 'Hybrid')
    return t('workspace.modeKms', 'KMS')
  }

  const handleWorkspaceSelect = (workspaceId: string) => {
    if (workspaceId !== currentWorkspaceId) {
      setCurrentWorkspaceId(workspaceId)
      // Trigger workspace change event for data refresh
      window.dispatchEvent(new CustomEvent('workspace-changed', { detail: { workspaceId } }))
    }
  }

  const handleManageClick = () => {
    setCurrentTab('workspaces')
  }

  return (
    <DropdownMenu onOpenChange={handleOpenChange}>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="h-8 min-w-0 max-w-[320px] gap-1 px-2 text-sm font-medium"
          disabled={isLoading}
          title={displayName}
        >
          <Building2Icon className="size-4 shrink-0" />
          <span className="min-w-0 max-w-[260px] truncate">{displayName}</span>
          {isLoading ? (
            <Loader2Icon className="size-3 shrink-0 animate-spin" />
          ) : (
            <ChevronDownIcon className="size-3 shrink-0" />
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-[min(92vw,560px)]">
        <div className="px-2 py-1.5 text-xs font-semibold text-muted-foreground">
          {t('workspace.selectWorkspace', 'Select Workspace')}
        </div>
        <DropdownMenuSeparator />
        <div className="max-h-[300px] overflow-y-auto">
          {workspaces.length === 0 ? (
            <div className="px-2 py-4 text-center text-sm text-muted-foreground">
              {t('workspace.noWorkspaces', 'No workspaces found')}
            </div>
          ) : (
            workspaces.map((workspace) => (
              <DropdownMenuItem
                key={workspace.workspace_id}
                onClick={() => handleWorkspaceSelect(workspace.workspace_id)}
                className={cn(
                  'flex cursor-pointer items-start justify-between gap-3 py-2',
                  workspace.workspace_id === currentWorkspaceId && 'bg-accent'
                )}
                disabled={workspace.is_busy}
              >
                <div className="flex min-w-0 flex-1 flex-col">
                  <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                    <span className="break-words font-medium leading-snug">{workspace.name}</span>
                    <span className="shrink-0 text-[10px] px-1 py-0.5 rounded border bg-muted/40 text-muted-foreground">
                      {getWorkspaceModeLabel(workspace)}
                    </span>
                    {workspace.is_default && (
                      <span className="text-[10px] px-1 py-0.5 bg-primary/10 text-primary rounded">
                        {t('workspace.default', 'Default')}
                      </span>
                    )}
                  </div>
                  <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
                    <span className="break-words">{getWorkspaceSummary(workspace)}</span>
                    {workspace.is_busy && (
                      <span className="flex shrink-0 items-center gap-0.5 text-amber-500">
                        <Loader2Icon className="size-3 animate-spin" />
                        {t('workspace.busy', 'Busy')}
                      </span>
                    )}
                  </div>
                </div>
                {workspace.workspace_id === currentWorkspaceId && (
                  <CheckIcon className="size-4 text-primary shrink-0 ml-2" />
                )}
              </DropdownMenuItem>
            ))
          )}
        </div>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={handleManageClick} className="cursor-pointer">
          <SettingsIcon className="size-4 mr-2" />
          {t('workspace.manage', 'Manage Workspaces')}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

import { useEffect, useRef, useState } from 'react'
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

  // Refresh workspace list when dropdown opens
  const handleOpenChange = (open: boolean) => {
    if (open) {
      fetchWorkspaces()
    }
  }

  // Find current workspace info
  const currentWorkspace = workspaces.find(ws => ws.workspace_id === currentWorkspaceId)
  const displayName = currentWorkspace?.name || currentWorkspaceId || 'base'

  useEffect(() => {
    const answerWorkspaces = workspaces.filter((workspace) => {
      const mode = getWorkspaceMode(workspace)
      return mode === 'answer_catalog' || mode === 'hybrid'
    })
    if (answerWorkspaces.length === 0) return

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

  const getWorkspaceSummary = (workspace: WorkspaceInfo) => {
    const mode = getWorkspaceMode(workspace)
    const answerStats = answerStatsByWorkspace[workspace.workspace_id]
    const answerTotal = Number(answerStats?.answers?.total || 0)
    const publishedAnswers = Number(answerStats?.answers?.published || 0)
    const resolves = Number(answerStats?.events?.resolves || 0)

    if (mode === 'answer_catalog') {
      return [
        `${answerTotal.toLocaleString()} ${t('workspace.answerItems', 'Answers')}`,
        `${publishedAnswers.toLocaleString()} ${t('workspace.publishedAnswers', 'Published')}`,
        `${resolves.toLocaleString()} ${t('workspace.resolveEvents', 'Lookups')}`,
      ].join(' · ')
    }

    if (mode === 'hybrid') {
      return [
        `${workspace.document_count.toLocaleString()} ${t('workspace.documents', 'Documents')}`,
        `${answerTotal.toLocaleString()} ${t('workspace.answerItems', 'Answers')}`,
        `${resolves.toLocaleString()} ${t('workspace.resolveEvents', 'Lookups')}`,
      ].join(' · ')
    }

    return t('workspace.docsCount', '{{count}} docs', { count: workspace.document_count })
  }

  const getWorkspaceModeLabel = (workspace: WorkspaceInfo) => {
    const mode = getWorkspaceMode(workspace)
    if (mode === 'answer_catalog') return t('workspace.modeAnswerCatalog', 'FAQ / Fixed Answer')
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
          className="h-8 px-2 gap-1 text-sm font-medium"
          disabled={isLoading}
        >
          <Building2Icon className="size-4" />
          <span className="max-w-[100px] truncate">{displayName}</span>
          {isLoading ? (
            <Loader2Icon className="size-3 animate-spin" />
          ) : (
            <ChevronDownIcon className="size-3" />
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-[300px]">
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
                  'cursor-pointer flex items-center justify-between',
                  workspace.workspace_id === currentWorkspaceId && 'bg-accent'
                )}
                disabled={workspace.is_busy}
              >
                <div className="flex flex-col flex-1 min-w-0">
                  <div className="flex items-center gap-1">
                    <span className="truncate font-medium">{workspace.name}</span>
                    <span className="shrink-0 text-[10px] px-1 py-0.5 rounded border bg-muted/40 text-muted-foreground">
                      {getWorkspaceModeLabel(workspace)}
                    </span>
                    {workspace.is_default && (
                      <span className="text-[10px] px-1 py-0.5 bg-primary/10 text-primary rounded">
                        {t('workspace.default', 'Default')}
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-muted-foreground flex items-center gap-2">
                    <span className="truncate">{getWorkspaceSummary(workspace)}</span>
                    {workspace.is_busy && (
                      <span className="flex items-center gap-0.5 text-amber-500">
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

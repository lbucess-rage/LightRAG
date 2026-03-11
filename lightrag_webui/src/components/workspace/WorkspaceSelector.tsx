import { useEffect } from 'react'
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
import { Building2Icon, CheckIcon, Loader2Icon, ChevronDownIcon, SettingsIcon } from 'lucide-react'

export default function WorkspaceSelector() {
  const { t } = useTranslation()

  const currentWorkspaceId = useWorkspaceStore.use.currentWorkspaceId()
  const workspaces = useWorkspaceStore.use.workspaces()
  const isLoading = useWorkspaceStore.use.isLoading()
  const setCurrentWorkspaceId = useWorkspaceStore.use.setCurrentWorkspaceId()
  const fetchWorkspaces = useWorkspaceStore.use.fetchWorkspaces()
  const setCurrentTab = useSettingsStore.use.setCurrentTab()

  // Fetch workspaces on mount
  useEffect(() => {
    fetchWorkspaces()
  }, [fetchWorkspaces])

  // Refresh workspace list when dropdown opens
  const handleOpenChange = (open: boolean) => {
    if (open) {
      fetchWorkspaces()
    }
  }

  // Find current workspace info
  const currentWorkspace = workspaces.find(ws => ws.workspace_id === currentWorkspaceId)
  const displayName = currentWorkspace?.name || currentWorkspaceId || 'base'

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
      <DropdownMenuContent align="end" className="w-[220px]">
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
                    {workspace.is_default && (
                      <span className="text-[10px] px-1 py-0.5 bg-primary/10 text-primary rounded">
                        {t('workspace.default', 'Default')}
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-muted-foreground flex items-center gap-2">
                    <span>{t('workspace.docsCount', '{{count}} docs', { count: workspace.document_count })}</span>
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

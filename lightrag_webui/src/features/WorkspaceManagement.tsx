import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useWorkspaceStore } from '@/stores/workspace'
import { WorkspaceDialog, DeleteWorkspaceDialog, CopyWorkspaceDialog } from '@/components/workspace'
import Button from '@/components/ui/Button'
import Badge from '@/components/ui/Badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/Card'
import { cn } from '@/lib/utils'
import { AnswerStatsResponse, getAnswerStats, getWorkspaceMode, WorkspaceInfo } from '@/api/lightrag'
import {
  PlusIcon,
  RefreshCwIcon,
  Building2Icon,
  FileTextIcon,
  UsersIcon,
  LinkIcon,
  StarIcon,
  Loader2Icon,
  SettingsIcon,
  Trash2Icon,
  CopyIcon,
  CheckCircleIcon,
} from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/DropdownMenu'
import { toast } from 'sonner'

interface StatCardProps {
  title: string
  value: number
  icon: React.ReactNode
  description?: string
}

function StatCard({ title, value, icon, description }: StatCardProps) {
  return (
    <div className="flex items-center gap-3 p-3 rounded-lg bg-muted/50">
      <div className="p-2 rounded-md bg-background">{icon}</div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-muted-foreground truncate">{title}</p>
        <p className="text-2xl font-bold">{value.toLocaleString()}</p>
        {description && <p className="text-xs text-muted-foreground">{description}</p>}
      </div>
    </div>
  )
}

export default function WorkspaceManagement() {
  const { t } = useTranslation()
  const [refreshingId, setRefreshingId] = useState<string | null>(null)
  const [answerStatsByWorkspace, setAnswerStatsByWorkspace] = useState<Record<string, AnswerStatsResponse>>({})
  const fetchedOnMountRef = useRef(false)

  const workspaces = useWorkspaceStore.use.workspaces()
  const totalWorkspaces = useWorkspaceStore.use.totalWorkspaces()
  const isLoading = useWorkspaceStore.use.isLoading()
  const currentWorkspaceId = useWorkspaceStore.use.currentWorkspaceId()

  const fetchWorkspaces = useWorkspaceStore.use.fetchWorkspaces()
  const refreshWorkspaceStats = useWorkspaceStore.use.refreshWorkspaceStats()
  const setCurrentWorkspaceId = useWorkspaceStore.use.setCurrentWorkspaceId()
  const setAsDefaultWorkspace = useWorkspaceStore.use.setAsDefaultWorkspace()

  const isCreateDialogOpen = useWorkspaceStore.use.isCreateDialogOpen()
  const isEditDialogOpen = useWorkspaceStore.use.isEditDialogOpen()
  const isCopyDialogOpen = useWorkspaceStore.use.isCopyDialogOpen()
  const isDeleteDialogOpen = useWorkspaceStore.use.isDeleteDialogOpen()

  const openCreateDialog = useWorkspaceStore.use.openCreateDialog()
  const closeCreateDialog = useWorkspaceStore.use.closeCreateDialog()
  const openEditDialog = useWorkspaceStore.use.openEditDialog()
  const closeEditDialog = useWorkspaceStore.use.closeEditDialog()
  const openCopyDialog = useWorkspaceStore.use.openCopyDialog()
  const closeCopyDialog = useWorkspaceStore.use.closeCopyDialog()
  const openDeleteDialog = useWorkspaceStore.use.openDeleteDialog()
  const closeDeleteDialog = useWorkspaceStore.use.closeDeleteDialog()

  useEffect(() => {
    if (fetchedOnMountRef.current) return
    fetchedOnMountRef.current = true
    useWorkspaceStore.getState().fetchWorkspaces()
  }, [])

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

  const handleRefreshStats = async (workspaceId: string) => {
    setRefreshingId(workspaceId)
    try {
      await refreshWorkspaceStats(workspaceId)
      toast.success(t('workspaceManagement.statsRefreshed'))
    } catch {
      toast.error(t('workspaceManagement.statsRefreshFailed'))
    } finally {
      setRefreshingId(null)
    }
  }

  const handleSetDefault = async (workspaceId: string) => {
    try {
      await setAsDefaultWorkspace(workspaceId)
      toast.success(t('workspace.setDefaultSuccess'))
    } catch {
      toast.error(t('workspaceManagement.setDefaultFailed'))
    }
  }

  const handleSwitchWorkspace = (workspaceId: string) => {
    setCurrentWorkspaceId(workspaceId)
    toast.success(t('workspace.switchSuccess', { name: workspaces.find(w => w.workspace_id === workspaceId)?.name }))
  }

  // Calculate totals
  const totalDocs = workspaces.reduce((sum, ws) => sum + ws.document_count, 0)
  const totalEntities = workspaces.reduce((sum, ws) => sum + ws.entity_count, 0)
  const totalRelations = workspaces.reduce((sum, ws) => sum + ws.relation_count, 0)

  const getWorkspaceStats = (workspace: WorkspaceInfo) => {
    const mode = getWorkspaceMode(workspace)
    const answerStats = answerStatsByWorkspace[workspace.workspace_id]
    const answerTotal = Number(answerStats?.answers?.total || 0)
    const publishedAnswers = Number(answerStats?.answers?.published || 0)
    const resolves = Number(answerStats?.events?.resolves || 0)

    if (mode === 'answer_catalog') {
      return [
        { label: t('workspace.answerItems', 'Answers'), value: answerTotal },
        { label: t('workspace.publishedAnswers', 'Published'), value: publishedAnswers },
        { label: t('workspace.resolveEvents', 'Lookups'), value: resolves },
      ]
    }

    if (mode === 'hybrid') {
      return [
        { label: t('workspace.documents'), value: workspace.document_count },
        { label: t('workspace.answerItems', 'Answers'), value: answerTotal },
        { label: t('workspace.resolveEvents', 'Lookups'), value: resolves },
      ]
    }

    return [
      { label: t('workspace.documents'), value: workspace.document_count },
      { label: t('workspace.entities'), value: workspace.entity_count },
      { label: t('workspace.relations'), value: workspace.relation_count },
    ]
  }

  return (
    <div className="container mx-auto py-6 px-4 max-w-7xl">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Building2Icon className="h-6 w-6" />
            {t('workspaceManagement.title')}
          </h1>
          <p className="text-muted-foreground mt-1">{t('workspaceManagement.description')}</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => fetchWorkspaces(true)} disabled={isLoading}>
            {isLoading ? (
              <Loader2Icon className="h-4 w-4 animate-spin" />
            ) : (
              <RefreshCwIcon className="h-4 w-4" />
            )}
            <span className="ml-2">{t('common.refresh')}</span>
          </Button>
          <Button size="sm" onClick={openCreateDialog}>
            <PlusIcon className="h-4 w-4" />
            <span className="ml-2">{t('workspace.create')}</span>
          </Button>
        </div>
      </div>

      {/* Summary Stats */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
        <Card>
          <CardContent className="p-4">
            <StatCard
              title={t('workspaceManagement.totalWorkspaces')}
              value={totalWorkspaces}
              icon={<Building2Icon className="h-5 w-5 text-blue-500" />}
            />
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <StatCard
              title={t('workspaceManagement.totalDocuments')}
              value={totalDocs}
              icon={<FileTextIcon className="h-5 w-5 text-green-500" />}
            />
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <StatCard
              title={t('workspaceManagement.totalEntities')}
              value={totalEntities}
              icon={<UsersIcon className="h-5 w-5 text-purple-500" />}
            />
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <StatCard
              title={t('workspaceManagement.totalRelations')}
              value={totalRelations}
              icon={<LinkIcon className="h-5 w-5 text-orange-500" />}
            />
          </CardContent>
        </Card>
      </div>

      {/* Workspace Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {workspaces.map((workspace) => (
          <Card
            key={workspace.workspace_id}
            className={cn(
              'transition-all hover:shadow-md',
              workspace.workspace_id === currentWorkspaceId && 'ring-2 ring-primary'
            )}
          >
            <CardHeader className="pb-2">
              <div className="flex items-start justify-between">
                <div className="flex-1 min-w-0">
                  <CardTitle className="text-lg flex items-center gap-2">
                    <span className="truncate">{workspace.name}</span>
                    {workspace.is_default && (
                      <StarIcon className="h-4 w-4 text-amber-500 fill-amber-500 flex-shrink-0" />
                    )}
                    {workspace.workspace_id === currentWorkspaceId && (
                      <CheckCircleIcon className="h-4 w-4 text-primary flex-shrink-0" />
                    )}
                  </CardTitle>
                  <CardDescription className="truncate">
                    {workspace.description || workspace.workspace_id}
                  </CardDescription>
                  <div className="mt-2">
                    <Badge variant="outline">
                      {getWorkspaceMode(workspace) === 'answer_catalog'
                        ? t('workspace.modeAnswerCatalog', 'FAQ / Fixed Answer')
                        : getWorkspaceMode(workspace) === 'hybrid'
                          ? t('workspace.modeHybrid', 'Hybrid')
                          : t('workspace.modeKms', 'KMS')}
                    </Badge>
                  </div>
                </div>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon" className="h-8 w-8">
                      <SettingsIcon className="h-4 w-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    {workspace.workspace_id !== currentWorkspaceId && (
                      <>
                        <DropdownMenuItem onClick={() => handleSwitchWorkspace(workspace.workspace_id)}>
                          <CheckCircleIcon className="h-4 w-4 mr-2" />
                          {t('workspaceManagement.switchTo')}
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                      </>
                    )}
                    <DropdownMenuItem onClick={() => openEditDialog(workspace)}>
                      <SettingsIcon className="h-4 w-4 mr-2" />
                      {t('workspace.edit')}
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => openCopyDialog(workspace)}>
                      <CopyIcon className="h-4 w-4 mr-2" />
                      {t('workspace.copy')}
                    </DropdownMenuItem>
                    {!workspace.is_default && (
                      <DropdownMenuItem onClick={() => handleSetDefault(workspace.workspace_id)}>
                        <StarIcon className="h-4 w-4 mr-2" />
                        {t('workspace.setAsDefault')}
                      </DropdownMenuItem>
                    )}
                    <DropdownMenuItem
                      onClick={() => handleRefreshStats(workspace.workspace_id)}
                      disabled={refreshingId === workspace.workspace_id}
                    >
                      {refreshingId === workspace.workspace_id ? (
                        <Loader2Icon className="h-4 w-4 mr-2 animate-spin" />
                      ) : (
                        <RefreshCwIcon className="h-4 w-4 mr-2" />
                      )}
                      {t('workspace.refreshStats')}
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      onClick={() => openDeleteDialog(workspace)}
                      className="text-destructive focus:text-destructive"
                      disabled={workspace.is_default || workspace.is_busy}
                    >
                      <Trash2Icon className="h-4 w-4 mr-2" />
                      {t('workspace.delete')}
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </CardHeader>
            <CardContent>
              {workspace.is_busy && (
                <div className="flex items-center gap-2 text-amber-600 dark:text-amber-400 text-sm mb-3 p-2 bg-amber-50 dark:bg-amber-950/30 rounded-md">
                  <Loader2Icon className="h-4 w-4 animate-spin" />
                  <span>{t('workspace.busy')}</span>
                </div>
              )}
              <div className="grid grid-cols-3 gap-2">
                {getWorkspaceStats(workspace).map((stat) => (
                  <div key={stat.label} className="text-center p-2 bg-muted/50 rounded-md">
                    <p className="text-xl font-bold text-foreground/80">
                      {stat.value.toLocaleString()}
                    </p>
                    <p className="text-xs text-muted-foreground">{stat.label}</p>
                  </div>
                ))}
              </div>
              {workspace.update_time && (
                <p className="text-xs text-muted-foreground mt-3">
                  {t('workspace.lastUpdated')}: {new Date(workspace.update_time * 1000).toLocaleString()}
                </p>
              )}
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Empty State */}
      {workspaces.length === 0 && !isLoading && (
        <div className="text-center py-12">
          <Building2Icon className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
          <h3 className="text-lg font-medium mb-2">{t('workspaceManagement.noWorkspaces')}</h3>
          <p className="text-muted-foreground mb-4">{t('workspaceManagement.noWorkspacesDesc')}</p>
          <Button onClick={openCreateDialog}>
            <PlusIcon className="h-4 w-4 mr-2" />
            {t('workspace.create')}
          </Button>
        </div>
      )}

      {/* Dialogs */}
      <WorkspaceDialog open={isCreateDialogOpen} onOpenChange={closeCreateDialog} mode="create" />
      <WorkspaceDialog open={isEditDialogOpen} onOpenChange={closeEditDialog} mode="edit" />
      <DeleteWorkspaceDialog open={isDeleteDialogOpen} onOpenChange={closeDeleteDialog} />
      <CopyWorkspaceDialog open={isCopyDialogOpen} onOpenChange={closeCopyDialog} />
    </div>
  )
}

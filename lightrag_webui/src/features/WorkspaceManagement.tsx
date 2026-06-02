import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import {
  Building2Icon,
  CheckCircleIcon,
  CopyIcon,
  FileTextIcon,
  LinkIcon,
  Loader2Icon,
  MoreHorizontalIcon,
  PlusIcon,
  RefreshCwIcon,
  SearchIcon,
  SettingsIcon,
  StarIcon,
  Trash2Icon,
  UsersIcon,
} from 'lucide-react'

import { WorkspaceDialog, DeleteWorkspaceDialog, CopyWorkspaceDialog } from '@/components/workspace'
import { AnswerStatsResponse, getAnswerStats, getWorkspaceMode, WorkspaceInfo } from '@/api/lightrag'
import Badge from '@/components/ui/Badge'
import Button from '@/components/ui/Button'
import { Card, CardContent } from '@/components/ui/Card'
import Input from '@/components/ui/Input'
import PaginationControls from '@/components/ui/PaginationControls'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/Select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/Table'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/DropdownMenu'
import { cn } from '@/lib/utils'
import { useWorkspaceStore } from '@/stores/workspace'

type WorkspaceModeFilter = 'all' | 'kms' | 'answer_catalog' | 'hybrid'
type WorkspaceSortKey = 'updated_desc' | 'name_asc' | 'documents_desc' | 'answers_desc' | 'lookups_desc'

interface StatCardProps {
  title: string
  value: number
  icon: React.ReactNode
  description?: string
}

const WORKSPACE_PAGE_SIZE_OPTIONS = [
  { value: 10, label: '10' },
  { value: 20, label: '20' },
  { value: 50, label: '50' },
  { value: 100, label: '100' },
]

function StatCard({ title, value, icon, description }: StatCardProps) {
  return (
    <div className="flex items-center gap-3 rounded-lg bg-muted/50 p-3">
      <div className="rounded-md bg-background p-2">{icon}</div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-muted-foreground">{title}</p>
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
  const [search, setSearch] = useState('')
  const [modeFilter, setModeFilter] = useState<WorkspaceModeFilter>('all')
  const [sortKey, setSortKey] = useState<WorkspaceSortKey>('updated_desc')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(20)
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

  const totalDocs = workspaces.reduce((sum, ws) => sum + ws.document_count, 0)
  const totalEntities = workspaces.reduce((sum, ws) => sum + ws.entity_count, 0)
  const totalRelations = workspaces.reduce((sum, ws) => sum + ws.relation_count, 0)

  const getAnswerMetrics = (workspace: WorkspaceInfo) => {
    const answerStats = answerStatsByWorkspace[workspace.workspace_id]
    const answerTotal = Number(answerStats?.answers?.total || 0)
    const publishedAnswers = Number(answerStats?.answers?.published || 0)
    const queryEvents = Number(answerStats?.events?.resolves || 0) + Number(answerStats?.events?.searches || 0)
    return { answerTotal, publishedAnswers, queryEvents }
  }

  const getWorkspaceStats = (workspace: WorkspaceInfo) => {
    const mode = getWorkspaceMode(workspace)
    const { answerTotal, publishedAnswers, queryEvents } = getAnswerMetrics(workspace)

    if (mode === 'answer_catalog') {
      return [
        { label: t('workspace.answerItems', 'Answers'), value: answerTotal },
        { label: t('workspace.publishedAnswers', 'Published'), value: publishedAnswers },
        { label: t('workspace.resolveEvents', 'Lookups'), value: queryEvents },
      ]
    }

    if (mode === 'hybrid') {
      return [
        { label: t('workspace.documents'), value: workspace.document_count },
        { label: t('workspace.answerItems', 'Answers'), value: answerTotal },
        { label: t('workspace.resolveEvents', 'Lookups'), value: queryEvents },
      ]
    }

    return [
      { label: t('workspace.documents'), value: workspace.document_count },
      { label: t('workspace.entities'), value: workspace.entity_count },
      { label: t('workspace.relations'), value: workspace.relation_count },
    ]
  }

  const filteredWorkspaces = useMemo(() => {
    const term = search.trim().toLowerCase()
    return workspaces
      .filter((workspace) => {
        const mode = getWorkspaceMode(workspace)
        if (modeFilter !== 'all' && mode !== modeFilter) return false
        if (!term) return true
        return [
          workspace.name,
          workspace.workspace_id,
          workspace.description,
        ].filter(Boolean).join(' ').toLowerCase().includes(term)
      })
      .sort((left, right) => {
        const leftMetrics = getAnswerMetrics(left)
        const rightMetrics = getAnswerMetrics(right)
        if (sortKey === 'name_asc') {
          return left.name.localeCompare(right.name)
        }
        if (sortKey === 'documents_desc') {
          return right.document_count - left.document_count
        }
        if (sortKey === 'answers_desc') {
          return rightMetrics.answerTotal - leftMetrics.answerTotal
        }
        if (sortKey === 'lookups_desc') {
          return rightMetrics.queryEvents - leftMetrics.queryEvents
        }
        return Number(right.update_time || 0) - Number(left.update_time || 0)
      })
  }, [answerStatsByWorkspace, modeFilter, search, sortKey, workspaces])

  const totalPages = Math.max(1, Math.ceil(filteredWorkspaces.length / pageSize))
  const pagedWorkspaces = filteredWorkspaces.slice((page - 1) * pageSize, page * pageSize)

  useEffect(() => {
    if (page > totalPages) setPage(totalPages)
  }, [page, totalPages])

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

  const handleSearchChange = (value: string) => {
    setSearch(value)
    setPage(1)
  }

  const handleModeFilterChange = (value: string) => {
    setModeFilter(value as WorkspaceModeFilter)
    setPage(1)
  }

  const handleSortChange = (value: string) => {
    setSortKey(value as WorkspaceSortKey)
    setPage(1)
  }

  const handlePageSizeChange = (value: number) => {
    setPageSize(value)
    setPage(1)
  }

  const modeLabel = (workspace: WorkspaceInfo) => {
    const mode = getWorkspaceMode(workspace)
    if (mode === 'answer_catalog') return t('workspace.modeAnswerCatalog', 'FAQ / Approved Answers')
    if (mode === 'hybrid') return t('workspace.modeHybrid', 'Hybrid')
    return t('workspace.modeKms', 'KMS')
  }

  return (
    <div className="mx-auto flex h-full max-w-[1600px] flex-col gap-5 px-4 py-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold">
            <Building2Icon className="h-6 w-6" />
            {t('workspaceManagement.title')}
          </h1>
          <p className="mt-1 text-muted-foreground">{t('workspaceManagement.description')}</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => fetchWorkspaces(true)} disabled={isLoading}>
            {isLoading ? <Loader2Icon className="h-4 w-4 animate-spin" /> : <RefreshCwIcon className="h-4 w-4" />}
            <span className="ml-2">{t('common.refresh')}</span>
          </Button>
          <Button size="sm" onClick={openCreateDialog}>
            <PlusIcon className="h-4 w-4" />
            <span className="ml-2">{t('workspace.create')}</span>
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
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

      <div className="rounded-md border bg-card">
        <div className="flex flex-wrap items-center gap-2 border-b p-3">
          <div className="relative min-w-[260px] flex-1">
            <SearchIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(event) => handleSearchChange(event.target.value)}
              className="pl-9"
              placeholder={t('workspaceManagement.searchPlaceholder', 'Search workspace name, ID, or description...')}
            />
          </div>
          <Select value={modeFilter} onValueChange={handleModeFilterChange}>
            <SelectTrigger className="w-[180px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t('common.all', 'All')}</SelectItem>
              <SelectItem value="kms">{t('workspace.modeKms', 'KMS')}</SelectItem>
              <SelectItem value="answer_catalog">{t('workspace.modeAnswerCatalog', 'FAQ / Approved Answers')}</SelectItem>
              <SelectItem value="hybrid">{t('workspace.modeHybrid', 'Hybrid')}</SelectItem>
            </SelectContent>
          </Select>
          <Select value={sortKey} onValueChange={handleSortChange}>
            <SelectTrigger className="w-[190px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="updated_desc">{t('workspaceManagement.sortUpdated', 'Recently updated')}</SelectItem>
              <SelectItem value="name_asc">{t('workspaceManagement.sortName', 'Name A-Z')}</SelectItem>
              <SelectItem value="documents_desc">{t('workspaceManagement.sortDocuments', 'Most documents')}</SelectItem>
              <SelectItem value="answers_desc">{t('workspaceManagement.sortAnswers', 'Most answers')}</SelectItem>
              <SelectItem value="lookups_desc">{t('workspaceManagement.sortLookups', 'Most lookups')}</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <Table>
          <TableHeader>
            <TableRow className="bg-muted/30">
              <TableHead>{t('workspaceManagement.workspaceColumn', 'Workspace')}</TableHead>
              <TableHead className="w-[180px]">{t('workspaceManagement.modeColumn', 'Mode')}</TableHead>
              <TableHead className="w-[320px]">{t('workspaceManagement.summaryColumn', 'Summary')}</TableHead>
              <TableHead className="w-[180px]">{t('workspace.lastUpdated')}</TableHead>
              <TableHead className="w-[90px] text-right">{t('workspaceManagement.actionsColumn', 'Actions')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {pagedWorkspaces.map((workspace) => (
              <TableRow
                key={workspace.workspace_id}
                className={cn(workspace.workspace_id === currentWorkspaceId && 'bg-primary/5')}
              >
                <TableCell>
                  <div className="min-w-0">
                    <div className="flex min-w-0 flex-wrap items-center gap-2">
                      <span className="break-words font-semibold">{workspace.name}</span>
                      {workspace.is_default && <StarIcon className="h-4 w-4 shrink-0 fill-amber-500 text-amber-500" />}
                      {workspace.workspace_id === currentWorkspaceId && <CheckCircleIcon className="h-4 w-4 shrink-0 text-primary" />}
                      {workspace.is_busy && (
                        <Badge variant="outline" className="gap-1 text-amber-700">
                          <Loader2Icon className="h-3 w-3 animate-spin" />
                          {t('workspace.busy')}
                        </Badge>
                      )}
                    </div>
                    <div className="mt-1 break-all font-mono text-xs text-muted-foreground">{workspace.workspace_id}</div>
                    {workspace.description && (
                      <div className="mt-1 line-clamp-2 text-sm text-muted-foreground">{workspace.description}</div>
                    )}
                  </div>
                </TableCell>
                <TableCell>
                  <Badge variant="outline">{modeLabel(workspace)}</Badge>
                </TableCell>
                <TableCell>
                  <div className="grid grid-cols-3 gap-2">
                    {getWorkspaceStats(workspace).map((stat) => (
                      <div key={stat.label} className="rounded-md bg-muted/50 px-2 py-1.5 text-center">
                        <div className="text-base font-semibold">{stat.value.toLocaleString()}</div>
                        <div className="text-[11px] text-muted-foreground">{stat.label}</div>
                      </div>
                    ))}
                  </div>
                </TableCell>
                <TableCell className="text-sm text-muted-foreground">
                  {workspace.update_time ? new Date(workspace.update_time * 1000).toLocaleString() : '-'}
                </TableCell>
                <TableCell className="text-right">
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon" className="h-8 w-8">
                        <MoreHorizontalIcon className="h-4 w-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      {workspace.workspace_id !== currentWorkspaceId && (
                        <>
                          <DropdownMenuItem onClick={() => handleSwitchWorkspace(workspace.workspace_id)}>
                            <CheckCircleIcon className="mr-2 h-4 w-4" />
                            {t('workspaceManagement.switchTo')}
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                        </>
                      )}
                      <DropdownMenuItem onClick={() => openEditDialog(workspace)}>
                        <SettingsIcon className="mr-2 h-4 w-4" />
                        {t('workspace.edit')}
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => openCopyDialog(workspace)}>
                        <CopyIcon className="mr-2 h-4 w-4" />
                        {t('workspace.copy')}
                      </DropdownMenuItem>
                      {!workspace.is_default && (
                        <DropdownMenuItem onClick={() => handleSetDefault(workspace.workspace_id)}>
                          <StarIcon className="mr-2 h-4 w-4" />
                          {t('workspace.setAsDefault')}
                        </DropdownMenuItem>
                      )}
                      <DropdownMenuItem
                        onClick={() => handleRefreshStats(workspace.workspace_id)}
                        disabled={refreshingId === workspace.workspace_id}
                      >
                        {refreshingId === workspace.workspace_id ? (
                          <Loader2Icon className="mr-2 h-4 w-4 animate-spin" />
                        ) : (
                          <RefreshCwIcon className="mr-2 h-4 w-4" />
                        )}
                        {t('workspace.refreshStats')}
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        onClick={() => openDeleteDialog(workspace)}
                        className="text-destructive focus:text-destructive"
                        disabled={workspace.is_default || workspace.is_busy}
                      >
                        <Trash2Icon className="mr-2 h-4 w-4" />
                        {t('workspace.delete')}
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>

        {filteredWorkspaces.length === 0 && !isLoading && (
          <div className="py-12 text-center">
            <Building2Icon className="mx-auto mb-4 h-12 w-12 text-muted-foreground" />
            <h3 className="mb-2 text-lg font-medium">{t('workspaceManagement.noWorkspaces')}</h3>
            <p className="mb-4 text-muted-foreground">{t('workspaceManagement.noWorkspacesDesc')}</p>
            <Button onClick={openCreateDialog}>
              <PlusIcon className="mr-2 h-4 w-4" />
              {t('workspace.create')}
            </Button>
          </div>
        )}

        <div className="border-t p-3">
          <PaginationControls
            currentPage={page}
            totalPages={totalPages}
            pageSize={pageSize}
            totalCount={filteredWorkspaces.length}
            onPageChange={setPage}
            onPageSizeChange={handlePageSizeChange}
            pageSizeOptions={WORKSPACE_PAGE_SIZE_OPTIONS}
            isLoading={isLoading}
          />
        </div>
      </div>

      <WorkspaceDialog open={isCreateDialogOpen} onOpenChange={closeCreateDialog} mode="create" />
      <WorkspaceDialog open={isEditDialogOpen} onOpenChange={closeEditDialog} mode="edit" />
      <DeleteWorkspaceDialog open={isDeleteDialogOpen} onOpenChange={closeDeleteDialog} />
      <CopyWorkspaceDialog open={isCopyDialogOpen} onOpenChange={closeCopyDialog} />
    </div>
  )
}

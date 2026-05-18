import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useEntityManagementStore } from '@/stores/entityManagement'
import { cn } from '@/lib/utils'
import Input from '@/components/ui/Input'
import Button from '@/components/ui/Button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/Select'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from '@/components/ui/Table'
import PaginationControls from '@/components/ui/PaginationControls'
import Checkbox from '@/components/ui/Checkbox'
import { SearchIcon, RefreshCwIcon, ArrowUpIcon, ArrowDownIcon, Trash2Icon, Loader2Icon, AlertTriangleIcon, Network } from 'lucide-react'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/Dialog'
import { toast } from 'sonner'
import { DeletionPolicy, DeletionPreviewResponse, executeDeletion, getRelatedEntities, previewDeletion, RelatedEntityItem } from '@/api/lightrag'
import DeletionImpactSummary from '@/components/deletion/DeletionImpactSummary'

// Debounce hook
function useDebounce<T>(value: T, delay: number): T {
  const [debouncedValue, setDebouncedValue] = useState<T>(value)

  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedValue(value)
    }, delay)

    return () => {
      clearTimeout(handler)
    }
  }, [value, delay])

  return debouncedValue
}

export default function EntityExplorer() {
  const { t } = useTranslation()
  const [searchInput, setSearchInput] = useState('')
  const [deleteLoading, setDeleteLoading] = useState<string | null>(null)
  const [deleteDialog, setDeleteDialog] = useState<{
    open: boolean
    entityId: string | null
    step: 'choose' | 'related' | 'preview'
    policy: Extract<DeletionPolicy, 'graph_only' | 'cascade_safe' | 'cascade_full'>
    relatedEntities: RelatedEntityItem[]
    selectedRelated: Set<string>
    loadingRelated: boolean
    preview: DeletionPreviewResponse | null
    loadingPreview: boolean
    executing: boolean
  }>({
    open: false,
    entityId: null,
    step: 'choose',
    policy: 'cascade_safe',
    relatedEntities: [],
    selectedRelated: new Set(),
    loadingRelated: false,
    preview: null,
    loadingPreview: false,
    executing: false,
  })

  // Store state
  const entities = useEntityManagementStore.use.entities()
  const pagination = useEntityManagementStore.use.entitiesPagination()
  const entityTypeCounts = useEntityManagementStore.use.entityTypeCounts()
  const selectedEntityType = useEntityManagementStore.use.selectedEntityType()
  const loading = useEntityManagementStore.use.entitiesLoading()
  const sortField = useEntityManagementStore.use.entitiesSortField()
  const sortDirection = useEntityManagementStore.use.entitiesSortDirection()
  const selectedEntityId = useEntityManagementStore.use.selectedEntityId()

  // Store actions
  const setEntitySearch = useEntityManagementStore.use.setEntitySearch()
  const setSelectedEntityType = useEntityManagementStore.use.setSelectedEntityType()
  const setEntitiesSortField = useEntityManagementStore.use.setEntitiesSortField()
  const setEntitiesSortDirection = useEntityManagementStore.use.setEntitiesSortDirection()
  const selectEntity = useEntityManagementStore.use.selectEntity()
  const fetchEntities = useEntityManagementStore.use.fetchEntities()
  const fetchEntityTypes = useEntityManagementStore.use.fetchEntityTypes()
  const fetchRelations = useEntityManagementStore.use.fetchRelations()

  // Debounced search
  const debouncedSearch = useDebounce(searchInput, 300)

  useEffect(() => {
    setEntitySearch(debouncedSearch)
    fetchEntities(1)
  }, [debouncedSearch, setEntitySearch, fetchEntities])

  const handleSearchChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setSearchInput(e.target.value)
  }, [])

  const handleTypeFilterChange = useCallback((value: string) => {
    setSelectedEntityType(value === 'all' ? null : value)
    fetchEntities(1)
  }, [setSelectedEntityType, fetchEntities])

  const handleSort = useCallback((field: string) => {
    if (sortField === field) {
      setEntitiesSortDirection(sortDirection === 'asc' ? 'desc' : 'asc')
    } else {
      setEntitiesSortField(field)
      setEntitiesSortDirection('asc')
    }
    fetchEntities(1)
  }, [sortField, sortDirection, setEntitiesSortField, setEntitiesSortDirection, fetchEntities])

  const handleRefresh = useCallback(() => {
    fetchEntities(pagination.page)
    fetchEntityTypes()
  }, [fetchEntities, fetchEntityTypes, pagination.page])

  const handlePageChange = useCallback((page: number) => {
    fetchEntities(page)
  }, [fetchEntities])

  const handlePageSizeChange = useCallback((pageSize: number) => {
    useEntityManagementStore.setState((state) => ({
      entitiesPagination: { ...state.entitiesPagination, page_size: pageSize }
    }))
    fetchEntities(1)
  }, [fetchEntities])

  const handleRowClick = useCallback((entityId: string) => {
    selectEntity(entityId)
  }, [selectEntity])

  const handleDelete = useCallback((e: React.MouseEvent, entityId: string) => {
    e.stopPropagation()
    setDeleteDialog({
      open: true,
      entityId,
      step: 'choose',
      policy: 'cascade_safe',
      relatedEntities: [],
      selectedRelated: new Set(),
      loadingRelated: false,
      preview: null,
      loadingPreview: false,
      executing: false,
    })
  }, [])

  const previewEntityDelete = useCallback(async (
    policy: Extract<DeletionPolicy, 'graph_only' | 'cascade_safe' | 'cascade_full'>,
    idsToDelete?: string[]
  ) => {
    const entityId = deleteDialog.entityId
    if (!entityId) return

    const ids = idsToDelete || [entityId, ...Array.from(deleteDialog.selectedRelated)]
    setDeleteDialog(prev => ({
      ...prev,
      policy,
      step: 'preview',
      loadingRelated: false,
      loadingPreview: true,
      preview: null,
    }))
    try {
      const result = await previewDeletion({
        target_type: 'entity',
        policy,
        ids,
        relations: [],
        invalidate_cache: true,
      })
      setDeleteDialog(prev => ({ ...prev, preview: result, loadingPreview: false }))
    } catch {
      toast.error(t('entityManagement.entityExplorer.deleteFailed'))
      setDeleteDialog(prev => ({ ...prev, loadingPreview: false }))
    }
  }, [deleteDialog.entityId, deleteDialog.selectedRelated, t])

  const handleChooseScope = useCallback(async (
    policy: Extract<DeletionPolicy, 'graph_only' | 'cascade_safe' | 'cascade_full'>
  ) => {
    const entityId = deleteDialog.entityId
    if (!entityId) return

    if (policy !== 'cascade_safe') {
      previewEntityDelete(policy, [entityId])
      return
    }

    // Safe delete: first check same-name/similar-name candidates for optional batch deletion.
    setDeleteDialog(prev => ({ ...prev, policy: 'cascade_safe', loadingRelated: true, step: 'related' }))
    try {
      const result = await getRelatedEntities(entityId)
      if (result.related.length === 0) {
        await previewEntityDelete('cascade_safe', [entityId])
        return
      }
      setDeleteDialog(prev => ({
        ...prev,
        relatedEntities: result.related,
        selectedRelated: new Set(), // none selected by default
        loadingRelated: false,
      }))
    } catch {
      // If related fetch fails, proceed with single delete
      setDeleteDialog(prev => ({ ...prev, relatedEntities: [], loadingRelated: false }))
      await previewEntityDelete('cascade_safe', [entityId])
    }
  }, [deleteDialog.entityId, previewEntityDelete])

  const toggleRelatedEntity = useCallback((eid: string) => {
    setDeleteDialog(prev => {
      const next = new Set(prev.selectedRelated)
      if (next.has(eid)) next.delete(eid)
      else next.add(eid)
      return { ...prev, selectedRelated: next }
    })
  }, [])

  const toggleAllRelated = useCallback((checked: boolean) => {
    setDeleteDialog(prev => ({
      ...prev,
      selectedRelated: checked ? new Set(prev.relatedEntities.map(e => e.entity_id)) : new Set(),
    }))
  }, [])

  const executeDelete = useCallback(async () => {
    const entityId = deleteDialog.entityId
    if (!entityId || !deleteDialog.preview) return

    const idsToDelete = [entityId, ...Array.from(deleteDialog.selectedRelated)]
    setDeleteDialog(prev => ({ ...prev, executing: true }))
    setDeleteLoading(entityId)
    try {
      const result = await executeDeletion({
        target_type: 'entity',
        policy: deleteDialog.policy,
        ids: idsToDelete,
        relations: [],
        invalidate_cache: true,
      })
      const deleted = result.results.filter((item) => item.status === 'success').length
      if (idsToDelete.length === 1) {
        toast.success(t('entityManagement.entityExplorer.deleteSuccess', { entityId }))
      } else {
        toast.success(t('entityManagement.entityExplorer.batchDeleteSuccess', { deleted, total: idsToDelete.length }))
      }
      await fetchEntities(pagination.page)
      await fetchEntityTypes()
      await fetchRelations()
      if (idsToDelete.includes(selectedEntityId || '')) {
        selectEntity(null)
      }
      setDeleteDialog(prev => ({ ...prev, open: false, executing: false }))
    } catch (error) {
      toast.error(t('entityManagement.entityExplorer.deleteFailed'))
    } finally {
      setDeleteLoading(null)
      setDeleteDialog(prev => ({ ...prev, executing: false }))
    }
  }, [deleteDialog, t, fetchEntities, fetchEntityTypes, fetchRelations, pagination.page, selectedEntityId, selectEntity])

  const SortIcon = ({ field }: { field: string }) => {
    if (sortField !== field) return null
    return sortDirection === 'asc'
      ? <ArrowUpIcon className="h-3 w-3 ml-1 inline" />
      : <ArrowDownIcon className="h-3 w-3 ml-1 inline" />
  }

  return (
    <div className="flex flex-col h-full">
      {/* Search and Filter Bar */}
      <div className="flex items-center gap-2 p-3 border-b border-border/40">
        <div className="relative flex-1">
          <SearchIcon className="absolute left-2 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder={t('entityManagement.entityExplorer.searchPlaceholder')}
            value={searchInput}
            onChange={handleSearchChange}
            className="pl-8 h-8"
          />
        </div>

        <Select
          value={selectedEntityType || 'all'}
          onValueChange={handleTypeFilterChange}
        >
          <SelectTrigger className="w-[150px] h-8">
            <SelectValue placeholder={t('entityManagement.entityExplorer.typeFilter')} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">
              {t('entityManagement.entityExplorer.allTypes')}
            </SelectItem>
            {entityTypeCounts.map((item) => (
              <SelectItem key={item.entity_type} value={item.entity_type}>
                {item.entity_type} ({item.count})
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Button
          variant="outline"
          size="sm"
          onClick={handleRefresh}
          disabled={loading}
          className="h-8 w-8 p-0"
          tooltip={t('entityManagement.entityExplorer.refresh')}
        >
          <RefreshCwIcon className={cn('h-4 w-4', loading && 'animate-spin')} />
        </Button>
      </div>

      {/* Table */}
      <div className="flex-1 overflow-auto">
        <Table>
          <TableHeader className="sticky top-0 bg-background z-10">
            <TableRow>
              <TableHead
                className="cursor-pointer hover:bg-muted/50 min-w-[120px]"
                onClick={() => handleSort('entity_id')}
              >
                {t('entityManagement.entityExplorer.columns.entityId')}
                <SortIcon field="entity_id" />
              </TableHead>
              <TableHead
                className="cursor-pointer hover:bg-muted/50 min-w-[100px]"
                onClick={() => handleSort('entity_type')}
              >
                {t('entityManagement.entityExplorer.columns.entityType')}
                <SortIcon field="entity_type" />
              </TableHead>
              <TableHead className="min-w-[200px]">
                {t('entityManagement.entityExplorer.columns.description')}
              </TableHead>
              <TableHead className="w-[60px] text-center">
                {t('entityManagement.entityExplorer.columns.degree')}
              </TableHead>
              <TableHead className="w-[60px]"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading && entities.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="text-center py-8">
                  <Loader2Icon className="h-6 w-6 animate-spin mx-auto" />
                </TableCell>
              </TableRow>
            ) : entities.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="text-center py-8 text-muted-foreground">
                  {t('entityManagement.entityExplorer.noEntities')}
                </TableCell>
              </TableRow>
            ) : (
              entities.map((entity) => (
                <TableRow
                  key={entity.entity_id}
                  className={cn(
                    'cursor-pointer hover:bg-muted/50',
                    selectedEntityId === entity.entity_id && 'bg-primary/10'
                  )}
                  onClick={() => handleRowClick(entity.entity_id)}
                >
                  <TableCell className="font-medium truncate max-w-[200px]" title={entity.entity_id}>
                    {entity.entity_id}
                  </TableCell>
                  <TableCell>
                    <span className="px-2 py-0.5 rounded-full text-xs bg-muted">
                      {entity.entity_type || '-'}
                    </span>
                  </TableCell>
                  <TableCell className="truncate max-w-[300px]" title={entity.description || ''}>
                    {entity.description || '-'}
                  </TableCell>
                  <TableCell className="text-center">
                    {entity.degree}
                  </TableCell>
                  <TableCell>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 w-7 p-0 text-destructive hover:text-destructive hover:bg-destructive/10"
                      onClick={(e) => handleDelete(e, entity.entity_id)}
                      disabled={deleteLoading === entity.entity_id}
                    >
                      {deleteLoading === entity.entity_id ? (
                        <Loader2Icon className="h-4 w-4 animate-spin" />
                      ) : (
                        <Trash2Icon className="h-4 w-4" />
                      )}
                    </Button>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {/* Pagination */}
      <div className="p-3 border-t border-border/40">
        <PaginationControls
          currentPage={pagination.page}
          totalPages={pagination.total_pages}
          pageSize={pagination.page_size}
          totalCount={pagination.total_count}
          onPageChange={handlePageChange}
          onPageSizeChange={handlePageSizeChange}
          isLoading={loading}
          compact
        />
      </div>

      <Dialog open={deleteDialog.open} onOpenChange={(open) => !open && setDeleteDialog(prev => ({ ...prev, open: false }))}>
        <DialogContent className="w-[calc(100vw-2rem)] sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangleIcon className="h-5 w-5 text-destructive" />
              {t('entityManagement.deleteDialog.title')}
            </DialogTitle>
            <DialogDescription className="pt-2">
              {t('entityManagement.deleteDialog.entityDescription', { entityId: deleteDialog.entityId })}
            </DialogDescription>
          </DialogHeader>

          {deleteDialog.step === 'choose' && (
            <div className="flex min-w-0 flex-col gap-3 py-2">
              <Button
                variant="outline"
                className="h-auto w-full min-w-0 max-w-full items-start justify-start gap-3 whitespace-normal px-4 py-3 text-left"
                onClick={() => handleChooseScope('cascade_safe')}
              >
                <Trash2Icon className="mt-0.5 h-5 w-5 shrink-0" />
                <div className="min-w-0 flex-1 whitespace-normal text-left">
                  <div className="font-semibold">{t('entityManagement.deleteDialog.safeButton')}</div>
                  <div className="whitespace-normal break-words text-xs font-normal leading-5 opacity-70">{t('entityManagement.deleteDialog.safeDescription')}</div>
                </div>
              </Button>
              <Button
                variant="destructive"
                className="h-auto w-full min-w-0 max-w-full items-start justify-start gap-3 whitespace-normal px-4 py-3 text-left"
                onClick={() => handleChooseScope('cascade_full')}
              >
                <Trash2Icon className="mt-0.5 h-5 w-5 shrink-0" />
                <div className="min-w-0 flex-1 whitespace-normal text-left">
                  <div className="font-semibold">{t('entityManagement.deleteDialog.fullButton')}</div>
                  <div className="whitespace-normal break-words text-xs font-normal leading-5 opacity-80">{t('entityManagement.deleteDialog.fullDescription')}</div>
                </div>
              </Button>
              <Button
                variant="outline"
                className="h-auto w-full min-w-0 max-w-full items-start justify-start gap-3 whitespace-normal px-4 py-3 text-left"
                onClick={() => handleChooseScope('graph_only')}
              >
                <Network className="mt-0.5 h-5 w-5 shrink-0" />
                <div className="min-w-0 flex-1 whitespace-normal text-left">
                  <div className="font-semibold">{t('entityManagement.deleteDialog.graphOnlyButton')}</div>
                  <div className="whitespace-normal break-words text-xs font-normal leading-5 opacity-70">{t('entityManagement.deleteDialog.graphOnlyDescription')}</div>
                </div>
              </Button>
            </div>
          )}

          {deleteDialog.step === 'related' && (
            <div className="flex flex-col gap-3 py-2">
              {deleteDialog.loadingRelated ? (
                <div className="flex items-center justify-center py-4">
                  <Loader2Icon className="h-5 w-5 animate-spin mr-2" />
                  {t('entityManagement.deleteDialog.loadingRelated')}
                </div>
              ) : deleteDialog.relatedEntities.length > 0 ? (
                <>
                  <div className="text-sm text-muted-foreground">
                    {t('entityManagement.deleteDialog.relatedFound', { count: deleteDialog.relatedEntities.length })}
                  </div>
                  <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-200">
                    {t('entityManagement.deleteDialog.similarCandidateHelp')}
                  </div>
                  <div className="border rounded-md max-h-[240px] overflow-auto">
                    <div className="flex items-center gap-2 px-3 py-2 border-b bg-muted/50">
                      <Checkbox
                        checked={deleteDialog.selectedRelated.size === deleteDialog.relatedEntities.length && deleteDialog.relatedEntities.length > 0}
                        onCheckedChange={(checked: boolean | 'indeterminate') => toggleAllRelated(checked === true)}
                      />
                      <span className="text-xs font-medium text-muted-foreground">
                        {t('entityManagement.deleteDialog.selectAll')} ({deleteDialog.selectedRelated.size}/{deleteDialog.relatedEntities.length})
                      </span>
                    </div>
                    {deleteDialog.relatedEntities.map((entity) => (
                      <div
                        key={entity.entity_id}
                        className="flex items-start gap-2 px-3 py-2 border-b last:border-b-0 hover:bg-muted/30 cursor-pointer"
                        onClick={() => toggleRelatedEntity(entity.entity_id)}
                      >
                        <Checkbox
                          checked={deleteDialog.selectedRelated.has(entity.entity_id)}
                          onCheckedChange={() => toggleRelatedEntity(entity.entity_id)}
                          className="mt-0.5"
                        />
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-medium truncate">{entity.entity_id}</div>
                          <div className="text-xs text-muted-foreground truncate">{entity.description || '-'}</div>
                        </div>
                        <span className="px-1.5 py-0.5 rounded text-xs bg-muted shrink-0">{entity.entity_type || '-'}</span>
                      </div>
                    ))}
                  </div>
                </>
              ) : (
                <div className="text-sm text-muted-foreground py-2">
                  {t('entityManagement.deleteDialog.noRelated')}
                </div>
              )}
            </div>
          )}

          {deleteDialog.step === 'preview' && (
            <div className="py-2">
              {deleteDialog.loadingPreview ? (
                <div className="flex items-center justify-center py-6">
                  <Loader2Icon className="h-5 w-5 animate-spin mr-2" />
                  {t('entityManagement.deleteDialog.loadingPreview', 'Calculating deletion impact...')}
                </div>
              ) : deleteDialog.preview ? (
                <DeletionImpactSummary preview={deleteDialog.preview} />
              ) : (
                <div className="text-sm text-muted-foreground">
                  {t('entityManagement.deleteDialog.noPreview', 'No preview available.')}
                </div>
              )}
            </div>
          )}

          <DialogFooter className="gap-2">
            {deleteDialog.step !== 'choose' && (
              <Button
                variant="ghost"
                disabled={deleteDialog.loadingPreview || deleteDialog.executing}
                onClick={() => setDeleteDialog(prev => ({
                  ...prev,
                  step: prev.step === 'preview' && prev.policy === 'cascade_safe' && prev.relatedEntities.length > 0 ? 'related' : 'choose'
                }))}
              >
                {t('common.back')}
              </Button>
            )}
            <div className="flex-1" />
            <Button
              variant="ghost"
              disabled={deleteDialog.executing}
              onClick={() => setDeleteDialog(prev => ({ ...prev, open: false }))}
            >
              {t('common.cancel')}
            </Button>
            {deleteDialog.step === 'related' && (
              <Button
                variant="destructive"
                onClick={() => previewEntityDelete('cascade_safe')}
                disabled={deleteDialog.loadingPreview}
              >
                {deleteDialog.loadingPreview
                  ? t('common.loading', 'Loading...')
                  : t('entityManagement.deleteDialog.previewImpact', 'Preview impact')}
              </Button>
            )}
            {deleteDialog.step === 'preview' && (
              <Button
                variant="destructive"
                onClick={executeDelete}
                disabled={deleteDialog.executing || !deleteDialog.preview?.executable}
              >
                {deleteDialog.executing
                  ? t('documentPanel.deleteDocuments.deleting', 'Deleting...')
                  : t('entityManagement.deleteDialog.confirmDelete', { count: 1 + deleteDialog.selectedRelated.size })}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

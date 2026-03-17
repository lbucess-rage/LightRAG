import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useEntityManagementStore } from '@/stores/entityManagement'
import { cn } from '@/lib/utils'
import Input from '@/components/ui/Input'
import Button from '@/components/ui/Button'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from '@/components/ui/Table'
import PaginationControls from '@/components/ui/PaginationControls'
import { SearchIcon, RefreshCwIcon, ArrowUpIcon, ArrowDownIcon, Trash2Icon, Loader2Icon, AlertTriangleIcon, Network } from 'lucide-react'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/Dialog'
import { toast } from 'sonner'

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

export default function RelationExplorer() {
  const { t } = useTranslation()
  const [searchInput, setSearchInput] = useState('')
  const [deleteLoading, setDeleteLoading] = useState<string | null>(null)
  const [deleteDialog, setDeleteDialog] = useState<{ open: boolean; sourceId: string | null; targetId: string | null }>({ open: false, sourceId: null, targetId: null })

  // Store state
  const relations = useEntityManagementStore.use.relations()
  const pagination = useEntityManagementStore.use.relationsPagination()
  const loading = useEntityManagementStore.use.relationsLoading()
  const sortField = useEntityManagementStore.use.relationsSortField()
  const sortDirection = useEntityManagementStore.use.relationsSortDirection()

  // Store actions
  const setRelationSearch = useEntityManagementStore.use.setRelationSearch()
  const setRelationsSortField = useEntityManagementStore.use.setRelationsSortField()
  const setRelationsSortDirection = useEntityManagementStore.use.setRelationsSortDirection()
  const selectEntity = useEntityManagementStore.use.selectEntity()
  const setGraphSelectedEdge = useEntityManagementStore.use.setGraphSelectedEdge()
  const fetchRelations = useEntityManagementStore.use.fetchRelations()
  const removeRelation = useEntityManagementStore.use.removeRelation()
  const graphSelectedEdge = useEntityManagementStore.use.graphSelectedEdge()

  // Debounced search
  const debouncedSearch = useDebounce(searchInput, 300)

  useEffect(() => {
    setRelationSearch(debouncedSearch)
    fetchRelations(1)
  }, [debouncedSearch, setRelationSearch, fetchRelations])

  const handleSearchChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setSearchInput(e.target.value)
  }, [])

  const handleSort = useCallback((field: string) => {
    if (sortField === field) {
      setRelationsSortDirection(sortDirection === 'asc' ? 'desc' : 'asc')
    } else {
      setRelationsSortField(field)
      setRelationsSortDirection('asc')
    }
    fetchRelations(1)
  }, [sortField, sortDirection, setRelationsSortField, setRelationsSortDirection, fetchRelations])

  const handleRefresh = useCallback(() => {
    fetchRelations(pagination.page)
  }, [fetchRelations, pagination.page])

  const handlePageChange = useCallback((page: number) => {
    fetchRelations(page)
  }, [fetchRelations])

  const handlePageSizeChange = useCallback((pageSize: number) => {
    useEntityManagementStore.setState((state) => ({
      relationsPagination: { ...state.relationsPagination, page_size: pageSize }
    }))
    fetchRelations(1)
  }, [fetchRelations])

  const handleSourceClick = useCallback((e: React.MouseEvent, entityId: string) => {
    e.stopPropagation()
    selectEntity(entityId)
  }, [selectEntity])

  const handleTargetClick = useCallback((e: React.MouseEvent, entityId: string) => {
    e.stopPropagation()
    selectEntity(entityId)
  }, [selectEntity])

  const handleRowClick = useCallback((relation: typeof relations[0]) => {
    console.log('RelationExplorer handleRowClick:', relation)
    const edgeData = {
      id: `${relation.source_id}-${relation.target_id}`,
      source: relation.source_id,
      target: relation.target_id,
      keywords: relation.keywords || '',
      weight: relation.weight,
      description: relation.description || '',
      source_id: relation.source_chunk_id || '',
      properties: {
        keywords: relation.keywords,
        weight: relation.weight,
        description: relation.description,
        source_id: relation.source_chunk_id,
        created_at: relation.created_at
      }
    }
    console.log('Setting graphSelectedEdge:', edgeData)
    setGraphSelectedEdge(edgeData)
  }, [setGraphSelectedEdge])

  const handleDelete = useCallback((e: React.MouseEvent, sourceId: string, targetId: string) => {
    e.stopPropagation()
    setDeleteDialog({ open: true, sourceId, targetId })
  }, [])

  const executeDelete = useCallback(async (cascade: boolean) => {
    const { sourceId, targetId } = deleteDialog
    if (!sourceId || !targetId) return
    setDeleteDialog({ open: false, sourceId: null, targetId: null })
    const key = `${sourceId}-${targetId}`
    setDeleteLoading(key)
    try {
      await removeRelation(sourceId, targetId, cascade)
      toast.success(t('entityManagement.relationExplorer.deleteSuccess'))
    } catch (error) {
      toast.error(t('entityManagement.relationExplorer.deleteFailed'))
    } finally {
      setDeleteLoading(null)
    }
  }, [deleteDialog, removeRelation, t])

  const SortIcon = ({ field }: { field: string }) => {
    if (sortField !== field) return null
    return sortDirection === 'asc'
      ? <ArrowUpIcon className="h-3 w-3 ml-1 inline" />
      : <ArrowDownIcon className="h-3 w-3 ml-1 inline" />
  }

  return (
    <div className="flex flex-col h-full">
      {/* Search Bar */}
      <div className="flex items-center gap-2 p-3 border-b border-border/40">
        <div className="relative flex-1">
          <SearchIcon className="absolute left-2 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder={t('entityManagement.relationExplorer.searchPlaceholder')}
            value={searchInput}
            onChange={handleSearchChange}
            className="pl-8 h-8"
          />
        </div>

        <Button
          variant="outline"
          size="sm"
          onClick={handleRefresh}
          disabled={loading}
          className="h-8 w-8 p-0"
          tooltip={t('entityManagement.relationExplorer.refresh')}
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
                onClick={() => handleSort('source_id')}
              >
                {t('entityManagement.relationExplorer.columns.source')}
                <SortIcon field="source_id" />
              </TableHead>
              <TableHead
                className="cursor-pointer hover:bg-muted/50 min-w-[120px]"
                onClick={() => handleSort('target_id')}
              >
                {t('entityManagement.relationExplorer.columns.target')}
                <SortIcon field="target_id" />
              </TableHead>
              <TableHead
                className="cursor-pointer hover:bg-muted/50 w-[80px]"
                onClick={() => handleSort('weight')}
              >
                {t('entityManagement.relationExplorer.columns.weight')}
                <SortIcon field="weight" />
              </TableHead>
              <TableHead className="min-w-[150px]">
                {t('entityManagement.relationExplorer.columns.keywords')}
              </TableHead>
              <TableHead className="w-[60px]"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading && relations.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="text-center py-8">
                  <Loader2Icon className="h-6 w-6 animate-spin mx-auto" />
                </TableCell>
              </TableRow>
            ) : relations.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="text-center py-8 text-muted-foreground">
                  {t('entityManagement.relationExplorer.noRelations')}
                </TableCell>
              </TableRow>
            ) : (
              relations.map((relation, index) => {
                const key = `${relation.source_id}-${relation.target_id}-${index}`
                const deleteKey = `${relation.source_id}-${relation.target_id}`
                const isSelected = graphSelectedEdge?.source === relation.source_id &&
                                   graphSelectedEdge?.target === relation.target_id
                return (
                  <TableRow
                    key={key}
                    className={cn(
                      'hover:bg-muted/50 cursor-pointer',
                      isSelected && 'bg-primary/10'
                    )}
                    onClick={() => handleRowClick(relation)}
                  >
                    <TableCell
                      className="font-medium truncate max-w-[150px] cursor-pointer text-primary hover:underline"
                      title={relation.source_id}
                      onClick={(e) => handleSourceClick(e, relation.source_id)}
                    >
                      {relation.source_id}
                    </TableCell>
                    <TableCell
                      className="font-medium truncate max-w-[150px] cursor-pointer text-primary hover:underline"
                      title={relation.target_id}
                      onClick={(e) => handleTargetClick(e, relation.target_id)}
                    >
                      {relation.target_id}
                    </TableCell>
                    <TableCell
                      className="text-center cursor-pointer"
                      onClick={() => handleRowClick(relation)}
                    >
                      {relation.weight?.toFixed(2) || '-'}
                    </TableCell>
                    <TableCell
                      className="truncate max-w-[200px] cursor-pointer"
                      title={relation.keywords || ''}
                      onClick={() => handleRowClick(relation)}
                    >
                      {relation.keywords || '-'}
                    </TableCell>
                    <TableCell>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 w-7 p-0 text-destructive hover:text-destructive hover:bg-destructive/10"
                        onClick={(e) => handleDelete(e, relation.source_id, relation.target_id)}
                        disabled={deleteLoading === deleteKey}
                      >
                        {deleteLoading === deleteKey ? (
                          <Loader2Icon className="h-4 w-4 animate-spin" />
                        ) : (
                          <Trash2Icon className="h-4 w-4" />
                        )}
                      </Button>
                    </TableCell>
                  </TableRow>
                )
              })
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

      <Dialog open={deleteDialog.open} onOpenChange={(open) => !open && setDeleteDialog({ open: false, sourceId: null, targetId: null })}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangleIcon className="h-5 w-5 text-destructive" />
              {t('entityManagement.deleteDialog.title')}
            </DialogTitle>
            <DialogDescription className="pt-2">
              {t('entityManagement.deleteDialog.relationDescription', { sourceId: deleteDialog.sourceId, targetId: deleteDialog.targetId })}
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-3 py-2">
            <Button
              variant="destructive"
              className="w-full justify-start gap-3 h-auto py-3 px-4"
              onClick={() => executeDelete(true)}
            >
              <Trash2Icon className="h-5 w-5 shrink-0" />
              <div className="text-left">
                <div className="font-semibold">{t('entityManagement.deleteDialog.cascadeButton')}</div>
                <div className="text-xs font-normal opacity-80">{t('entityManagement.deleteDialog.cascadeDescription')}</div>
              </div>
            </Button>
            <Button
              variant="outline"
              className="w-full justify-start gap-3 h-auto py-3 px-4"
              onClick={() => executeDelete(false)}
            >
              <Network className="h-5 w-5 shrink-0" />
              <div className="text-left">
                <div className="font-semibold">{t('entityManagement.deleteDialog.graphOnlyButton')}</div>
                <div className="text-xs font-normal opacity-70">{t('entityManagement.deleteDialog.graphOnlyDescription')}</div>
              </div>
            </Button>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setDeleteDialog({ open: false, sourceId: null, targetId: null })}>
              {t('common.cancel')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

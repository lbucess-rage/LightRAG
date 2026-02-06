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
import { SearchIcon, RefreshCwIcon, ArrowUpIcon, ArrowDownIcon, Trash2Icon, Loader2Icon } from 'lucide-react'
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

export default function EntityExplorer() {
  const { t } = useTranslation()
  const [searchInput, setSearchInput] = useState('')
  const [deleteLoading, setDeleteLoading] = useState<string | null>(null)

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
  const removeEntity = useEntityManagementStore.use.removeEntity()

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

  const handleDelete = useCallback(async (e: React.MouseEvent, entityId: string) => {
    e.stopPropagation()
    if (!window.confirm(t('entityManagement.entityExplorer.confirmDelete', { entityId }))) {
      return
    }

    setDeleteLoading(entityId)
    try {
      await removeEntity(entityId)
      toast.success(t('entityManagement.entityExplorer.deleteSuccess', { entityId }))
    } catch (error) {
      toast.error(t('entityManagement.entityExplorer.deleteFailed'))
    } finally {
      setDeleteLoading(null)
    }
  }, [removeEntity, t])

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
    </div>
  )
}

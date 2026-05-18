import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import {
  ArrowDownIcon,
  ArrowUpIcon,
  Edit3Icon,
  EyeIcon,
  FileTextIcon,
  GitBranchIcon,
  Loader2Icon,
  NetworkIcon,
  PuzzleIcon,
  RefreshCwIcon,
  SaveIcon,
  SearchIcon,
  Trash2Icon,
  XIcon
} from 'lucide-react'

import {
  ChunkDetail,
  ChunkListItem,
  ChunkSortField,
  DeletionPreviewResponse,
  executeDeletion,
  getChunkDetail,
  getChunksPaginated,
  previewDeletion,
  updateChunk
} from '@/api/lightrag'
import { errorMessage } from '@/lib/utils'
import { useWorkspaceStore } from '@/stores/workspace'
import Badge from '@/components/ui/Badge'
import Button from '@/components/ui/Button'
import Input from '@/components/ui/Input'
import Textarea from '@/components/ui/Textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/Select'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/Dialog'
import PaginationControls from '@/components/ui/PaginationControls'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from '@/components/ui/Table'
import DeletionImpactSummary from '@/components/deletion/DeletionImpactSummary'

type SortDirection = 'asc' | 'desc'

type ChunkManagerProps = {
  docId?: string | null
  onDocFilterChange?: (docId: string | null) => void
}

function useDebounce<T>(value: T, delay: number): T {
  const [debouncedValue, setDebouncedValue] = useState<T>(value)

  useEffect(() => {
    const handler = setTimeout(() => setDebouncedValue(value), delay)
    return () => clearTimeout(handler)
  }, [value, delay])

  return debouncedValue
}

const formatEpoch = (value?: number | null) => {
  if (!value) return '-'
  return new Date(value * 1000).toLocaleString()
}

const formatJson = (value: unknown) => {
  if (value === null || value === undefined || value === '') return ''
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

export default function ChunkManager({ docId, onDocFilterChange }: ChunkManagerProps) {
  const { t } = useTranslation()
  const currentWorkspaceId = useWorkspaceStore.use.currentWorkspaceId()
  const [chunks, setChunks] = useState<ChunkListItem[]>([])
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(20)
  const [totalPages, setTotalPages] = useState(0)
  const [totalCount, setTotalCount] = useState(0)
  const [search, setSearch] = useState('')
  const debouncedSearch = useDebounce(search, 300)
  const [docFilter, setDocFilter] = useState(docId || '')
  const [chunkType, setChunkType] = useState('all')
  const [sortField, setSortField] = useState<ChunkSortField>('chunk_order_index')
  const [sortDirection, setSortDirection] = useState<SortDirection>('asc')
  const [loading, setLoading] = useState(false)

  const [detail, setDetail] = useState<ChunkDetail | null>(null)
  const [detailOpen, setDetailOpen] = useState(false)
  const [detailLoading, setDetailLoading] = useState(false)
  const [editMode, setEditMode] = useState(false)
  const [editContent, setEditContent] = useState('')
  const [editStructured, setEditStructured] = useState('')
  const [saving, setSaving] = useState(false)

  const [deleteTarget, setDeleteTarget] = useState<ChunkListItem | ChunkDetail | null>(null)
  const [deletePreview, setDeletePreview] = useState<DeletionPreviewResponse | null>(null)
  const [deleteLoading, setDeleteLoading] = useState(false)
  const [deleteExecuting, setDeleteExecuting] = useState(false)

  useEffect(() => {
    setDocFilter(docId || '')
  }, [docId])

  const chunkTypeOptions = useMemo(() => [
    { value: 'all', label: t('documentPanel.chunkManager.types.all') },
    { value: 'text', label: t('documentPanel.chunkManager.types.text') },
    { value: 'image', label: t('documentPanel.chunkManager.types.image') },
    { value: 'table', label: t('documentPanel.chunkManager.types.table') },
    { value: 'equation', label: t('documentPanel.chunkManager.types.equation') },
  ], [t])

  const loadChunks = useCallback(async (targetPage: number) => {
    setLoading(true)
    try {
      const result = await getChunksPaginated({
        page: targetPage,
        page_size: pageSize,
        doc_id: docFilter.trim() || null,
        search: debouncedSearch.trim() || null,
        chunk_type: chunkType,
        sort_field: sortField,
        sort_direction: sortDirection,
      })
      setChunks(result.chunks)
      setPage(result.pagination.page)
      setPageSize(result.pagination.page_size)
      setTotalPages(result.pagination.total_pages)
      setTotalCount(result.pagination.total_count)
    } catch (error) {
      toast.error(t('documentPanel.chunkManager.loadFailed', { error: errorMessage(error) }))
    } finally {
      setLoading(false)
    }
  }, [pageSize, docFilter, debouncedSearch, chunkType, sortField, sortDirection, t])

  useEffect(() => {
    setPage(1)
    loadChunks(1)
  }, [currentWorkspaceId, debouncedSearch, docFilter, chunkType, sortField, sortDirection, pageSize, loadChunks])

  const handlePageChange = useCallback((nextPage: number) => {
    setPage(nextPage)
    loadChunks(nextPage)
  }, [loadChunks])

  const handlePageSizeChange = useCallback((nextPageSize: number) => {
    setPageSize(nextPageSize)
    setPage(1)
  }, [])

  const handleDocFilterChange = useCallback((value: string) => {
    setDocFilter(value)
    onDocFilterChange?.(value.trim() || null)
  }, [onDocFilterChange])

  const handleSort = useCallback((field: ChunkSortField) => {
    if (sortField === field) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc')
    } else {
      setSortField(field)
      setSortDirection('asc')
    }
  }, [sortField, sortDirection])

  const SortIcon = ({ field }: { field: ChunkSortField }) => {
    if (sortField !== field) return null
    return sortDirection === 'asc'
      ? <ArrowUpIcon className="ml-1 inline h-3 w-3" />
      : <ArrowDownIcon className="ml-1 inline h-3 w-3" />
  }

  const openDetail = useCallback(async (chunkId: string) => {
    setDetailOpen(true)
    setDetailLoading(true)
    setEditMode(false)
    try {
      const result = await getChunkDetail(chunkId)
      setDetail(result)
      setEditContent(result.content)
      setEditStructured(formatJson(result.structured_content))
    } catch (error) {
      toast.error(t('documentPanel.chunkManager.detailFailed', { error: errorMessage(error) }))
      setDetailOpen(false)
    } finally {
      setDetailLoading(false)
    }
  }, [t])

  const saveDetail = useCallback(async () => {
    if (!detail) return
    let structuredPayload: unknown
    const structuredText = editStructured.trim()
    if (structuredText) {
      try {
        structuredPayload = JSON.parse(structuredText)
      } catch {
        toast.error(t('documentPanel.chunkManager.invalidJson'))
        return
      }
    }

    setSaving(true)
    try {
      const updated = await updateChunk(detail.chunk_id, {
        content: editContent,
        structured_content: structuredText ? structuredPayload : undefined,
        clear_structured_content: !structuredText,
        invalidate_cache: true,
      })
      setDetail(updated)
      setEditContent(updated.content)
      setEditStructured(formatJson(updated.structured_content))
      setEditMode(false)
      toast.success(t('documentPanel.chunkManager.saveSuccess'))
      await loadChunks(page)
    } catch (error) {
      toast.error(t('documentPanel.chunkManager.saveFailed', { error: errorMessage(error) }))
    } finally {
      setSaving(false)
    }
  }, [detail, editContent, editStructured, loadChunks, page, t])

  const previewDelete = useCallback(async (target: ChunkListItem | ChunkDetail) => {
    setDeleteTarget(target)
    setDeletePreview(null)
    setDeleteLoading(true)
    try {
      const result = await getChunkDetail(target.chunk_id)
      const preview = await previewDeletion({
        target_type: 'chunk',
        policy: 'force_delete_chunks',
        ids: [result.chunk_id],
        relations: [],
        delete_llm_cache: true,
        invalidate_cache: true,
      })
      setDeletePreview(preview)
    } catch (error) {
      toast.error(t('documentPanel.chunkManager.deletePreviewFailed', { error: errorMessage(error) }))
      setDeleteTarget(null)
    } finally {
      setDeleteLoading(false)
    }
  }, [t])

  const executeChunkDelete = useCallback(async () => {
    if (!deleteTarget || !deletePreview?.executable) return
    setDeleteExecuting(true)
    try {
      await executeDeletion({
        target_type: 'chunk',
        policy: 'force_delete_chunks',
        ids: [deleteTarget.chunk_id],
        relations: [],
        delete_llm_cache: true,
        invalidate_cache: true,
      })
      toast.success(t('documentPanel.chunkManager.deleteSuccess'))
      if (detail?.chunk_id === deleteTarget.chunk_id) {
        setDetailOpen(false)
        setDetail(null)
      }
      setDeleteTarget(null)
      setDeletePreview(null)
      await loadChunks(page)
    } catch (error) {
      toast.error(t('documentPanel.chunkManager.deleteFailed', { error: errorMessage(error) }))
    } finally {
      setDeleteExecuting(false)
    }
  }, [deleteTarget, deletePreview, detail, loadChunks, page, t])

  return (
    <div className="flex flex-1 flex-col overflow-hidden rounded-md border">
      <div className="flex flex-wrap items-center gap-2 border-b p-3">
        <div className="relative min-w-[220px] flex-1">
          <SearchIcon className="absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder={t('documentPanel.chunkManager.searchPlaceholder')}
            className="h-8 pl-8"
          />
        </div>
        <Input
          value={docFilter}
          onChange={(event) => handleDocFilterChange(event.target.value)}
          placeholder={t('documentPanel.chunkManager.docFilterPlaceholder')}
          className="h-8 w-[260px] font-mono text-xs"
        />
        {docFilter && (
          <Button
            variant="ghost"
            size="sm"
            className="h-8 w-8 p-0"
            onClick={() => handleDocFilterChange('')}
            tooltip={t('documentPanel.chunkManager.clearDocFilter')}
          >
            <XIcon className="h-4 w-4" />
          </Button>
        )}
        <Select value={chunkType} onValueChange={setChunkType}>
          <SelectTrigger className="h-8 w-[130px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {chunkTypeOptions.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          variant="outline"
          size="sm"
          onClick={() => loadChunks(page)}
          disabled={loading}
          className="h-8 w-8 p-0"
          tooltip={t('common.refresh')}
        >
          <RefreshCwIcon className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
        </Button>
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        <Table>
          <TableHeader className="sticky top-0 z-10 bg-background">
            <TableRow>
              <TableHead className="min-w-[210px] cursor-pointer" onClick={() => handleSort('id')}>
                {t('documentPanel.chunkManager.columns.chunk')}<SortIcon field="id" />
              </TableHead>
              <TableHead className="min-w-[240px] cursor-pointer" onClick={() => handleSort('full_doc_id')}>
                {t('documentPanel.chunkManager.columns.document')}<SortIcon field="full_doc_id" />
              </TableHead>
              <TableHead className="w-[90px] cursor-pointer text-center" onClick={() => handleSort('chunk_order_index')}>
                {t('documentPanel.chunkManager.columns.order')}<SortIcon field="chunk_order_index" />
              </TableHead>
              <TableHead className="w-[90px]">{t('documentPanel.chunkManager.columns.type')}</TableHead>
              <TableHead>{t('documentPanel.chunkManager.columns.preview')}</TableHead>
              <TableHead className="w-[90px] text-center">{t('documentPanel.chunkManager.columns.links')}</TableHead>
              <TableHead className="w-[90px]"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading && chunks.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="py-10 text-center">
                  <Loader2Icon className="mx-auto h-6 w-6 animate-spin" />
                </TableCell>
              </TableRow>
            ) : chunks.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="py-10 text-center text-sm text-muted-foreground">
                  {t('documentPanel.chunkManager.empty')}
                </TableCell>
              </TableRow>
            ) : (
              chunks.map((chunk) => (
                <TableRow
                  key={chunk.chunk_id}
                  className="cursor-pointer hover:bg-muted/50"
                  onClick={() => openDetail(chunk.chunk_id)}
                >
                  <TableCell className="max-w-[260px] truncate font-mono text-xs" title={chunk.chunk_id}>
                    <div className="flex items-center gap-2">
                      <PuzzleIcon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                      <span className="truncate">{chunk.chunk_id}</span>
                    </div>
                  </TableCell>
                  <TableCell className="max-w-[300px] truncate text-xs" title={chunk.file_path || chunk.doc_id || ''}>
                    <div className="flex items-center gap-2">
                      <FileTextIcon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                      <span className="truncate">{chunk.file_path || chunk.doc_id || '-'}</span>
                    </div>
                    <div className="truncate font-mono text-[11px] text-muted-foreground">{chunk.doc_id || '-'}</div>
                  </TableCell>
                  <TableCell className="text-center">{chunk.chunk_order_index ?? '-'}</TableCell>
                  <TableCell>
                    <Badge variant={chunk.has_structured_content ? 'secondary' : 'outline'}>{chunk.chunk_type}</Badge>
                  </TableCell>
                  <TableCell className="max-w-[420px] truncate" title={chunk.content_preview}>
                    {chunk.content_preview || '-'}
                  </TableCell>
                  <TableCell className="text-center text-xs">
                    <span className="inline-flex items-center gap-1">
                      <NetworkIcon className="h-3 w-3" />{chunk.entity_count}
                    </span>
                    <span className="ml-2 inline-flex items-center gap-1">
                      <GitBranchIcon className="h-3 w-3" />{chunk.relation_count}
                    </span>
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center justify-end gap-1">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 w-7 p-0"
                        onClick={(event) => {
                          event.stopPropagation()
                          openDetail(chunk.chunk_id)
                        }}
                        tooltip={t('documentPanel.chunkManager.viewDetail')}
                      >
                        <EyeIcon className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 w-7 p-0 text-destructive hover:bg-destructive/10 hover:text-destructive"
                        onClick={(event) => {
                          event.stopPropagation()
                          previewDelete(chunk)
                        }}
                        tooltip={t('common.delete')}
                      >
                        <Trash2Icon className="h-4 w-4" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <div className="border-t p-3">
        <PaginationControls
          currentPage={page}
          totalPages={totalPages}
          pageSize={pageSize}
          totalCount={totalCount}
          onPageChange={handlePageChange}
          onPageSizeChange={handlePageSizeChange}
          isLoading={loading}
          compact
        />
      </div>

      <Dialog open={detailOpen} onOpenChange={(open) => {
        setDetailOpen(open)
        if (!open) setEditMode(false)
      }}>
        <DialogContent className="max-h-[88vh] overflow-hidden sm:max-w-5xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <PuzzleIcon className="h-5 w-5" />
              {detail?.chunk_id || t('documentPanel.chunkManager.detailTitle')}
            </DialogTitle>
            <DialogDescription>
              {detail ? `${detail.file_path || '-'} · ${t('documentPanel.chunkManager.columns.order')} ${detail.chunk_order_index ?? '-'}` : ''}
            </DialogDescription>
          </DialogHeader>

          {detailLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2Icon className="mr-2 h-5 w-5 animate-spin" />
              {t('common.loading')}
            </div>
          ) : detail && (
            <div className="grid min-h-0 gap-4 overflow-auto lg:grid-cols-[1.4fr_0.9fr]">
              <div className="space-y-3">
                <div className="flex flex-wrap gap-2 text-xs">
                  <Badge variant="secondary">{detail.chunk_type}</Badge>
                  <Badge variant="outline">{t('documentPanel.chunkManager.meta.tokens')}: {detail.tokens ?? '-'}</Badge>
                  <Badge variant="outline">{t('documentPanel.chunkManager.meta.length')}: {detail.content_length}</Badge>
                  <Badge variant="outline">{formatEpoch(detail.updated_at)}</Badge>
                </div>
                <div>
                  <div className="mb-1 text-sm font-medium">{t('documentPanel.chunkManager.content')}</div>
                  {editMode ? (
                    <Textarea
                      value={editContent}
                      onChange={(event) => setEditContent(event.target.value)}
                      className="min-h-[260px] font-mono text-xs"
                    />
                  ) : (
                    <pre className="max-h-[320px] overflow-auto rounded-md border bg-muted/30 p-3 whitespace-pre-wrap text-xs">
                      {detail.content}
                    </pre>
                  )}
                </div>
                <div>
                  <div className="mb-1 text-sm font-medium">{t('documentPanel.chunkManager.structuredContent')}</div>
                  {editMode ? (
                    <Textarea
                      value={editStructured}
                      onChange={(event) => setEditStructured(event.target.value)}
                      placeholder="{}"
                      className="min-h-[160px] font-mono text-xs"
                    />
                  ) : (
                    <pre className="max-h-[220px] overflow-auto rounded-md border bg-muted/30 p-3 whitespace-pre-wrap text-xs">
                      {formatJson(detail.structured_content) || '-'}
                    </pre>
                  )}
                </div>
              </div>

              <div className="space-y-3">
                <div className="rounded-md border p-3">
                  <div className="mb-2 text-sm font-medium">{t('documentPanel.chunkManager.document')}</div>
                  <div className="space-y-1 text-xs">
                    <div className="break-all font-mono">{detail.doc_id || '-'}</div>
                    <div className="break-all text-muted-foreground">{detail.document?.file_path || detail.file_path || '-'}</div>
                    <div>{t('documentPanel.chunkManager.meta.status')}: {detail.document?.status || '-'}</div>
                  </div>
                </div>
                <div className="rounded-md border p-3">
                  <div className="mb-2 flex items-center justify-between">
                    <div className="text-sm font-medium">{t('documentPanel.chunkManager.entities')}</div>
                    <Badge variant="outline">{detail.entities.length}</Badge>
                  </div>
                  <div className="max-h-40 overflow-auto space-y-2">
                    {detail.entities.length > 0 ? detail.entities.map((entity) => (
                      <div key={entity.entity_id} className="rounded border px-2 py-1.5 text-xs">
                        <div className="font-medium">{entity.entity_id}</div>
                        <div className="text-muted-foreground">{entity.entity_type || '-'} · {t('documentPanel.chunkManager.columns.links')} {entity.degree}</div>
                      </div>
                    )) : (
                      <div className="text-xs text-muted-foreground">{t('documentPanel.chunkManager.noEntities')}</div>
                    )}
                  </div>
                </div>
                <div className="rounded-md border p-3">
                  <div className="mb-2 flex items-center justify-between">
                    <div className="text-sm font-medium">{t('documentPanel.chunkManager.relations')}</div>
                    <Badge variant="outline">{detail.relations.length}</Badge>
                  </div>
                  <div className="max-h-40 overflow-auto space-y-2">
                    {detail.relations.length > 0 ? detail.relations.map((relation) => (
                      <div key={`${relation.source_id}-${relation.target_id}`} className="rounded border px-2 py-1.5 text-xs">
                        <div className="font-medium">{relation.source_id} → {relation.target_id}</div>
                        <div className="text-muted-foreground">{relation.keywords || relation.description || '-'}</div>
                      </div>
                    )) : (
                      <div className="text-xs text-muted-foreground">{t('documentPanel.chunkManager.noRelations')}</div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}

          <DialogFooter className="gap-2">
            {detail && (
              <Button
                variant="destructive"
                onClick={() => previewDelete(detail)}
                disabled={saving}
              >
                <Trash2Icon className="h-4 w-4" />
                {t('common.delete')}
              </Button>
            )}
            <div className="flex-1" />
            {detail && editMode ? (
              <>
                <Button variant="ghost" onClick={() => setEditMode(false)} disabled={saving}>
                  {t('common.cancel')}
                </Button>
                <Button onClick={saveDetail} disabled={saving}>
                  {saving ? <Loader2Icon className="h-4 w-4 animate-spin" /> : <SaveIcon className="h-4 w-4" />}
                  {t('common.save')}
                </Button>
              </>
            ) : detail && (
              <Button variant="outline" onClick={() => setEditMode(true)}>
                <Edit3Icon className="h-4 w-4" />
                {t('common.edit')}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!deleteTarget} onOpenChange={(open) => {
        if (!open && !deleteExecuting) {
          setDeleteTarget(null)
          setDeletePreview(null)
        }
      }}>
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Trash2Icon className="h-5 w-5 text-destructive" />
              {t('documentPanel.chunkManager.deleteTitle')}
            </DialogTitle>
            <DialogDescription className="break-all">
              {deleteTarget?.chunk_id}
            </DialogDescription>
          </DialogHeader>
          {deleteLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2Icon className="mr-2 h-5 w-5 animate-spin" />
              {t('entityManagement.deleteDialog.loadingPreview')}
            </div>
          ) : deletePreview ? (
            <DeletionImpactSummary preview={deletePreview} />
          ) : null}
          <DialogFooter>
            <Button
              variant="ghost"
              disabled={deleteExecuting}
              onClick={() => {
                setDeleteTarget(null)
                setDeletePreview(null)
              }}
            >
              {t('common.cancel')}
            </Button>
            <Button
              variant="destructive"
              disabled={deleteExecuting || !deletePreview?.executable}
              onClick={executeChunkDelete}
            >
              {deleteExecuting ? <Loader2Icon className="h-4 w-4 animate-spin" /> : <Trash2Icon className="h-4 w-4" />}
              {t('documentPanel.chunkManager.confirmDelete')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

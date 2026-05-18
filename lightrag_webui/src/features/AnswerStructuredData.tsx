import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { DatabaseIcon, PlayIcon, RefreshCwIcon, TableIcon } from 'lucide-react'

import {
  AnswerStructuredDataset,
  AnswerStructuredFilter,
  AnswerStructuredQueryResponse,
  listAnswerStructuredDatasets,
  queryAnswerStructuredDataset,
} from '@/api/lightrag'
import AnswerHelpButton from '@/components/answers/AnswerHelpButton'
import Badge from '@/components/ui/Badge'
import Button from '@/components/ui/Button'
import Checkbox from '@/components/ui/Checkbox'
import Input from '@/components/ui/Input'
import { Label } from '@/components/ui/Label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/Select'
import { localizedErrorMessage } from '@/lib/utils'

type StructuredOperator = AnswerStructuredFilter['operator']

const operators: StructuredOperator[] = ['contains', 'equals', 'starts_with', 'ends_with']

export default function AnswerStructuredData() {
  const { t } = useTranslation()
  const [datasets, setDatasets] = useState<AnswerStructuredDataset[]>([])
  const [search, setSearch] = useState('')
  const [kind, setKind] = useState('all')
  const [structuredOnly, setStructuredOnly] = useState(true)
  const [selectedDatasetId, setSelectedDatasetId] = useState('')
  const [field, setField] = useState('')
  const [operator, setOperator] = useState<StructuredOperator>('contains')
  const [filterValue, setFilterValue] = useState('')
  const [limit, setLimit] = useState('20')
  const [queryResult, setQueryResult] = useState<AnswerStructuredQueryResponse | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [isQuerying, setIsQuerying] = useState(false)

  const fetchDatasets = useCallback(async () => {
    setIsLoading(true)
    try {
      const result = await listAnswerStructuredDatasets({ structured_only: structuredOnly, status: 'all' })
      setDatasets(result)
      setSelectedDatasetId((current) => current || result[0]?.answer_id || '')
    } catch (err) {
      toast.error(localizedErrorMessage(err, t))
    } finally {
      setIsLoading(false)
    }
  }, [structuredOnly])

  useEffect(() => {
    fetchDatasets()
  }, [fetchDatasets])

  const datasetsById = useMemo(
    () => Object.fromEntries(datasets.map((dataset) => [dataset.answer_id, dataset])),
    [datasets]
  )
  const selectedDataset = selectedDatasetId ? datasetsById[selectedDatasetId] : undefined

  useEffect(() => {
    if (!selectedDataset) return
    setField((current) => current && selectedDataset.columns.includes(current) ? current : selectedDataset.columns[0] || '')
    setQueryResult(null)
  }, [selectedDataset])

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase()
    return datasets
      .filter((item) => kind === 'all' || item.kind === kind)
      .filter((item) => !term || item.title.toLowerCase().includes(term) || item.columns.join(' ').toLowerCase().includes(term))
  }, [datasets, kind, search])

  const kinds = useMemo(() => Array.from(new Set(datasets.map((item) => item.kind))).filter(Boolean), [datasets])
  const allColumns = useMemo(() => Array.from(new Set(filtered.flatMap((item) => item.columns))).slice(0, 80), [filtered])

  const handleQuery = async (previewOnly: boolean) => {
    if (!selectedDatasetId) {
      toast.error(t('answerCatalog.structured.selectDatasetRequired', 'Select a structured dataset first.'))
      return
    }
    const filters: AnswerStructuredFilter[] = field && filterValue.trim()
      ? [{ field, operator, value: filterValue.trim() }]
      : []
    setIsQuerying(true)
    try {
      const result = await queryAnswerStructuredDataset({
        answer_id: selectedDatasetId,
        filters,
        limit: Number(limit) || 20,
        preview_only: previewOnly,
      })
      setQueryResult(result)
    } catch (err) {
      toast.error(localizedErrorMessage(err, t))
    } finally {
      setIsQuerying(false)
    }
  }

  return (
    <div className="flex h-full flex-col gap-4 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <div className="rounded-md border bg-muted/40 p-2">
            <DatabaseIcon className="h-5 w-5" />
          </div>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-2xl font-bold">{t('answerCatalog.structured.title', 'Structured Data')}</h1>
              <Badge variant="outline">Phase 5 MVP</Badge>
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              {t('answerCatalog.structured.description', 'Profile DB/NoSQL/table sources and expose safe semantic views for deterministic lookup.')}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <AnswerHelpButton />
          <Button variant="outline" size="sm" onClick={fetchDatasets} disabled={isLoading}>
            <RefreshCwIcon className={isLoading ? 'h-4 w-4 animate-spin' : 'h-4 w-4'} />
            {t('common.refresh', 'Refresh')}
          </Button>
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-4">
        <Metric label={t('answerCatalog.structured.profiledAnswers', 'Profiled Answers')} value={filtered.length} />
        <Metric label={t('answerCatalog.structured.totalColumns', 'Detected Fields')} value={allColumns.length} />
        <Metric label={t('answerCatalog.structured.tableRows', 'Known Rows')} value={filtered.reduce((sum, item) => sum + item.row_count, 0)} />
        <Metric label={t('answerCatalog.library.total', 'Total')} value={datasets.length} />
      </div>

      <div className="flex flex-wrap items-center gap-2 rounded-md border p-3">
        <Input
          className="min-w-64 flex-1"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder={t('answerCatalog.structured.search', 'Search answer or field...')}
        />
        <Select value={kind} onValueChange={setKind}>
          <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t('common.all', 'All')}</SelectItem>
            {kinds.map((item) => <SelectItem key={item} value={item}>{item}</SelectItem>)}
          </SelectContent>
        </Select>
        <label className="flex items-center gap-2 text-sm text-muted-foreground">
          <Checkbox checked={structuredOnly} onCheckedChange={(checked) => setStructuredOnly(Boolean(checked))} />
          {t('answerCatalog.structured.structuredOnly', 'Structured only')}
        </label>
      </div>

      <div className="grid gap-4 xl:grid-cols-[420px_1fr]">
        <div className="rounded-md border p-4">
          <div className="mb-3 flex items-center gap-2 font-semibold">
            <PlayIcon className="h-4 w-4" />
            {t('answerCatalog.structured.safeQuery', 'Safe Query Preview / Execute')}
          </div>
          <div className="grid gap-3">
            <div className="grid gap-2">
              <Label>{t('answerCatalog.structured.dataset', 'Dataset')}</Label>
              <Select value={selectedDatasetId} onValueChange={setSelectedDatasetId}>
                <SelectTrigger><SelectValue placeholder={t('answerCatalog.structured.selectDataset', 'Select dataset')} /></SelectTrigger>
                <SelectContent>
                  {filtered.map((dataset) => (
                    <SelectItem key={dataset.answer_id} value={dataset.answer_id}>
                      {dataset.title}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2 md:grid-cols-[1fr_150px]">
              <div className="grid gap-2">
                <Label>{t('answerCatalog.structured.field', 'Field')}</Label>
                <Select value={field} onValueChange={setField} disabled={!selectedDataset}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {(selectedDataset?.columns || []).map((column) => (
                      <SelectItem key={column} value={column}>{column}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-2">
                <Label>{t('answerCatalog.structured.operator', 'Operator')}</Label>
                <Select value={operator} onValueChange={(value) => setOperator(value as StructuredOperator)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {operators.map((item) => (
                      <SelectItem key={item} value={item}>
                        {t(`answerCatalog.structured.operators.${item}`, item)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid gap-2 md:grid-cols-[1fr_90px]">
              <div className="grid gap-2">
                <Label>{t('answerCatalog.structured.value', 'Value')}</Label>
                <Input value={filterValue} onChange={(event) => setFilterValue(event.target.value)} />
              </div>
              <div className="grid gap-2">
                <Label>{t('answerCatalog.structured.limit', 'Limit')}</Label>
                <Input type="number" value={limit} onChange={(event) => setLimit(event.target.value)} />
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" onClick={() => handleQuery(true)} disabled={isQuerying || !selectedDatasetId}>
                {t('answerCatalog.structured.previewSql', 'Preview SQL')}
              </Button>
              <Button onClick={() => handleQuery(false)} disabled={isQuerying || !selectedDatasetId}>
                {isQuerying ? <RefreshCwIcon className="h-4 w-4 animate-spin" /> : <PlayIcon className="h-4 w-4" />}
                {t('answerCatalog.structured.execute', 'Execute')}
              </Button>
            </div>
          </div>
        </div>

        <div className="min-w-0 rounded-md border p-4">
          <div className="mb-3 font-semibold">{t('answerCatalog.structured.queryResult', 'Query Result')}</div>
          {queryResult ? (
            <div className="grid gap-3">
              <pre className="overflow-auto rounded-md bg-muted/50 p-3 text-xs">{queryResult.pseudo_sql}</pre>
              <div className="flex flex-wrap gap-2 text-sm text-muted-foreground">
                <Badge variant="outline">{queryResult.row_count.toLocaleString()} rows</Badge>
                <Badge variant="outline">{queryResult.preview_only ? 'preview' : 'execute'}</Badge>
              </div>
              {queryResult.rows.length > 0 ? (
                <div className="max-h-64 overflow-auto rounded-md border">
                  <table className="w-full min-w-[640px] text-sm">
                    <thead className="bg-muted/40 text-xs text-muted-foreground">
                      <tr>
                        {queryResult.columns.slice(0, 8).map((column) => <th key={column} className="p-2 text-left">{column}</th>)}
                      </tr>
                    </thead>
                    <tbody>
                      {queryResult.rows.map((row, index) => (
                        <tr key={index} className="border-t">
                          {queryResult.columns.slice(0, 8).map((column) => (
                            <td key={column} className="max-w-56 truncate p-2">{String(row[column] ?? '')}</td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="text-sm text-muted-foreground">
                  {queryResult.preview_only
                    ? t('answerCatalog.structured.previewOnlyHint', 'Preview mode only generated the safe SQL shape.')
                    : t('answerCatalog.structured.noRows', 'No rows matched the condition.')}
                </div>
              )}
            </div>
          ) : (
            <div className="text-sm text-muted-foreground">
              {t('answerCatalog.structured.queryHint', 'Choose a dataset, add an optional condition, then preview or execute a safe query.')}
            </div>
          )}
        </div>
      </div>

      {allColumns.length > 0 && (
        <div className="rounded-md border p-4">
          <div className="mb-2 flex items-center gap-2 text-sm font-medium">
            <TableIcon className="h-4 w-4" />
            {t('answerCatalog.structured.fieldCloud', 'Detected Field Cloud')}
          </div>
          <div className="flex flex-wrap gap-1">
            {allColumns.map((column) => <Badge key={column} variant="outline">{column}</Badge>)}
          </div>
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-auto rounded-md border">
        {filtered.length === 0 ? (
          <div className="p-8 text-center text-sm text-muted-foreground">
            {t('answerCatalog.structured.empty', 'No structured profiles were found. Create drafts from structured sources first.')}
          </div>
        ) : (
          <div className="divide-y">
            {filtered.map((item) => (
              <button
                key={item.answer_id}
                className="grid w-full gap-3 p-4 text-left hover:bg-muted/40 lg:grid-cols-[1fr_160px_120px]"
                onClick={() => setSelectedDatasetId(item.answer_id)}
              >
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <div className="truncate font-semibold">{item.title}</div>
                    <Badge variant="outline">{item.kind}</Badge>
                    <Badge variant={item.status === 'published' ? 'secondary' : 'default'}>
                      {t(`answerCatalog.status.${item.status}`, item.status)}
                    </Badge>
                  </div>
                  <div className="mt-1 font-mono text-xs text-muted-foreground">{item.answer_id}</div>
                  {item.source_uri && <div className="mt-1 text-xs text-muted-foreground">{item.source_uri}</div>}
                  {item.columns.length > 0 && (
                    <div className="mt-3 flex flex-wrap gap-1">
                      {item.columns.slice(0, 18).map((column) => <Badge key={column} variant="outline">{column}</Badge>)}
                    </div>
                  )}
                </div>
                <div>
                  <div className="text-xs text-muted-foreground">{t('answerCatalog.sources.sourceType', 'Source Type')}</div>
                  <div className="mt-1 text-sm">{item.source_type}</div>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground">{t('answerCatalog.sources.rows', 'Rows')}</div>
                  <div className="mt-1 text-sm">{item.row_count.toLocaleString()}</div>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-md border p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 text-2xl font-semibold">{value.toLocaleString()}</div>
    </div>
  )
}

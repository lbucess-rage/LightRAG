import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { DatabaseIcon, PlayIcon, RefreshCwIcon, SaveIcon, TableIcon, WandSparklesIcon } from 'lucide-react'

import {
  AnswerStructuredDataset,
  AnswerStructuredFilter,
  AnswerStructuredLookupLog,
  AnswerStructuredProfileResponse,
  AnswerStructuredQueryResponse,
  AnswerStructuredSourceType,
  listAnswerStructuredLookupLogs,
  listAnswerStructuredDatasets,
  materializeAnswerStructuredSource,
  profileAnswerStructuredSource,
  queryAnswerStructuredDataset,
} from '@/api/lightrag'
import AnswerHelpButton from '@/components/answers/AnswerHelpButton'
import Badge from '@/components/ui/Badge'
import Button from '@/components/ui/Button'
import Checkbox from '@/components/ui/Checkbox'
import Input from '@/components/ui/Input'
import { Label } from '@/components/ui/Label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/Select'
import Textarea from '@/components/ui/Textarea'
import { localizedErrorMessage } from '@/lib/utils'
import { useWorkspaceStore } from '@/stores/workspace'

type StructuredOperator = AnswerStructuredFilter['operator']

const operators: StructuredOperator[] = ['contains', 'equals', 'starts_with', 'ends_with']
const mappingRoles = ['id', 'title', 'question', 'answer', 'category', 'status', 'valid_from', 'valid_until']

const parseTags = (value: string) =>
  Array.from(new Set(value.split(',').map((item) => item.trim()).filter(Boolean)))

const compactMapping = (mapping: Record<string, string | null | undefined>): Record<string, string> =>
  Object.fromEntries(Object.entries(mapping).filter(([, column]) => Boolean(column))) as Record<string, string>

export default function AnswerStructuredData() {
  const { t } = useTranslation()
  const currentWorkspaceId = useWorkspaceStore.use.currentWorkspaceId()
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
  const [sourceType, setSourceType] = useState<AnswerStructuredSourceType>('csv')
  const [sourceTitle, setSourceTitle] = useState('')
  const [sourceUri, setSourceUri] = useState('')
  const [sourceTags, setSourceTags] = useState('')
  const [rawContent, setRawContent] = useState('')
  const [profile, setProfile] = useState<AnswerStructuredProfileResponse | null>(null)
  const [mapping, setMapping] = useState<Record<string, string>>({})
  const [guidanceColumns, setGuidanceColumns] = useState<string[]>([])
  const [materializationMode, setMaterializationMode] = useState<'table_as_dataset' | 'row_per_answer'>('table_as_dataset')
  const [lookupLogs, setLookupLogs] = useState<AnswerStructuredLookupLog[]>([])
  const [isProfiling, setIsProfiling] = useState(false)
  const [isMaterializing, setIsMaterializing] = useState(false)

  const fetchDatasets = useCallback(async () => {
    const workspaceId = currentWorkspaceId
    setIsLoading(true)
    try {
      const result = await listAnswerStructuredDatasets({ structured_only: structuredOnly, status: 'all' })
      if (workspaceId !== useWorkspaceStore.getState().currentWorkspaceId) return
      setDatasets(result)
      setSelectedDatasetId((current) =>
        current && result.some((dataset) => dataset.answer_id === current)
          ? current
          : result[0]?.answer_id || ''
      )
    } catch (err) {
      toast.error(localizedErrorMessage(err, t))
    } finally {
      setIsLoading(false)
    }
  }, [currentWorkspaceId, structuredOnly, t])

  useEffect(() => {
    setDatasets([])
    setSelectedDatasetId('')
    setField('')
    setFilterValue('')
    setQueryResult(null)
  }, [currentWorkspaceId])

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

  const fetchLookupLogs = useCallback(async (datasetId?: string) => {
    try {
      const result = await listAnswerStructuredLookupLogs({ dataset_id: datasetId, limit: 20 })
      setLookupLogs(result)
    } catch (err) {
      toast.error(localizedErrorMessage(err, t))
    }
  }, [t])

  const resetProfileState = () => {
    setProfile(null)
    setMapping({})
    setGuidanceColumns([])
  }

  const handleProfileSource = async () => {
    if (!rawContent.trim()) {
      toast.error(t('answerCatalog.structured.sourceRequired', 'Paste CSV or JSON source content first.'))
      return null
    }
    setIsProfiling(true)
    try {
      const result = await profileAnswerStructuredSource({
        source_type: sourceType,
        raw_content: rawContent,
        source_uri: sourceUri || undefined,
        sample_limit: 20,
      })
      setProfile(result)
      setMapping(compactMapping(result.mapping_suggestions))
      setGuidanceColumns(result.fields
        .filter((field) => ['title', 'category', 'id'].includes(field.semantic_role))
        .map((field) => field.name)
        .slice(0, 5))
      toast.success(t('answerCatalog.structured.profileComplete', 'Structured source analysis is ready.'))
      return result
    } catch (err) {
      toast.error(localizedErrorMessage(err, t))
      return null
    } finally {
      setIsProfiling(false)
    }
  }

  const handleMaterializeSource = async () => {
    if (!sourceTitle.trim()) {
      toast.error(t('answerCatalog.structured.titleRequired', 'Enter a dataset title first.'))
      return
    }
    if (!rawContent.trim()) {
      toast.error(t('answerCatalog.structured.sourceRequired', 'Paste CSV or JSON source content first.'))
      return
    }
    setIsMaterializing(true)
    try {
      const activeProfile = profile || await profileAnswerStructuredSource({
        source_type: sourceType,
        raw_content: rawContent,
        source_uri: sourceUri || undefined,
        sample_limit: 20,
      })
      if (!profile) {
        setProfile(activeProfile)
        setMapping(compactMapping(activeProfile.mapping_suggestions))
      }
      const activeMapping = Object.keys(mapping).length > 0
        ? compactMapping(mapping)
        : compactMapping(activeProfile.mapping_suggestions)
      const response = await materializeAnswerStructuredSource({
        source_type: sourceType,
        raw_content: rawContent,
        title: sourceTitle.trim(),
        source_uri: sourceUri || undefined,
        tags: parseTags(sourceTags),
        mapping: activeMapping,
        guidance_columns: guidanceColumns,
        materialization_mode: materializationMode,
        metadata: { created_from_ui: 'structured_data' },
      })
      const createdCount = response.answers?.length || 1
      toast.success(t('answerCatalog.structured.materializeComplete', '{{count}} structured draft(s) were created.', { count: createdCount }))
      setSelectedDatasetId(response.dataset.answer_id)
      setProfile(response.profile)
      await fetchDatasets()
      setSelectedDatasetId(response.dataset.answer_id)
      await fetchLookupLogs(response.dataset.answer_id)
    } catch (err) {
      toast.error(localizedErrorMessage(err, t))
    } finally {
      setIsMaterializing(false)
    }
  }

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
      await fetchLookupLogs(selectedDatasetId)
    } catch (err) {
      toast.error(localizedErrorMessage(err, t))
    } finally {
      setIsQuerying(false)
    }
  }

  useEffect(() => {
    if (selectedDatasetId) {
      fetchLookupLogs(selectedDatasetId)
    } else {
      setLookupLogs([])
    }
  }, [selectedDatasetId, fetchLookupLogs])

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
              {t('answerCatalog.structured.description', 'Analyze DB, NoSQL, and table sources so they can be searched safely with fixed conditions.')}
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
        <Metric label={t('answerCatalog.structured.profiledAnswers', 'Analyzed Answers')} value={filtered.length} />
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

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.1fr)_minmax(360px,0.9fr)]">
        <div className="rounded-md border p-4">
          <div className="mb-3 flex items-center gap-2 font-semibold">
            <WandSparklesIcon className="h-4 w-4" />
            {t('answerCatalog.structured.sourceProfiling', 'Structured Source Profiling')}
          </div>
          <div className="grid gap-3">
            <div className="grid gap-3 md:grid-cols-[150px_210px_1fr]">
              <div className="grid gap-2">
                <Label>{t('answerCatalog.structured.sourceType', 'Source Type')}</Label>
                <Select value={sourceType} onValueChange={(value) => {
                  setSourceType(value as AnswerStructuredSourceType)
                  resetProfileState()
                }}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="csv">CSV / TSV</SelectItem>
                    <SelectItem value="json">JSON</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-2">
                <Label>{t('answerCatalog.structured.materializationMode', 'Creation Mode')}</Label>
                <Select
                  value={materializationMode}
                  onValueChange={(value) => setMaterializationMode(value as 'table_as_dataset' | 'row_per_answer')}
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="table_as_dataset">{t('answerCatalog.structured.tableAsDataset', 'Table as Dataset')}</SelectItem>
                    <SelectItem value="row_per_answer">{t('answerCatalog.structured.rowPerAnswer', 'One Row = One Answer')}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-2">
                <Label>{t('answerCatalog.structured.datasetTitle', 'Dataset Title')}</Label>
                <Input
                  value={sourceTitle}
                  onChange={(event) => setSourceTitle(event.target.value)}
                  placeholder={t('answerCatalog.structured.datasetTitlePlaceholder', 'Example: Customer Center FAQ Table')}
                />
              </div>
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              <div className="grid gap-2">
                <Label>{t('answerCatalog.structured.sourceUri', 'Source Location')}</Label>
                <Input
                  value={sourceUri}
                  onChange={(event) => setSourceUri(event.target.value)}
                  placeholder={t('answerCatalog.structured.sourceUriPlaceholder', 'Optional source name, table, URL, or path')}
                />
              </div>
              <div className="grid gap-2">
                <Label>{t('answerCatalog.structured.tags', 'Tags')}</Label>
                <Input
                  value={sourceTags}
                  onChange={(event) => setSourceTags(event.target.value)}
                  placeholder={t('answerCatalog.structured.tagsPlaceholder', 'Comma separated tags')}
                />
              </div>
            </div>
            <div className="grid gap-2">
              <Label>{t('answerCatalog.structured.rawContent', 'Source Content')}</Label>
              <Textarea
                className="min-h-48 font-mono text-xs"
                value={rawContent}
                onChange={(event) => {
                  setRawContent(event.target.value)
                  resetProfileState()
                }}
                placeholder={sourceType === 'json'
                  ? '[{"question":"...", "answer":"...", "category":"..."}]'
                  : 'question,answer,category\nHow do I reset my password?,Use the password reset page.,Account'}
              />
            </div>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" onClick={handleProfileSource} disabled={isProfiling || isMaterializing}>
                <WandSparklesIcon className={isProfiling ? 'h-4 w-4 animate-pulse' : 'h-4 w-4'} />
                {t('answerCatalog.structured.profileSource', 'Analyze Source')}
              </Button>
              <Button onClick={handleMaterializeSource} disabled={isProfiling || isMaterializing}>
                {isMaterializing ? <RefreshCwIcon className="h-4 w-4 animate-spin" /> : <SaveIcon className="h-4 w-4" />}
                {t('answerCatalog.structured.createDataset', 'Create Dataset Draft')}
              </Button>
            </div>
            <div className="text-xs text-muted-foreground">
              {materializationMode === 'row_per_answer'
                ? t('answerCatalog.structured.rowPerAnswerHint', 'Creates one draft answer for each source row using mapped question/answer/category fields.')
                : t('answerCatalog.structured.tableAsDatasetHint', 'Creates one structured dataset draft that can be queried with the safe lookup panel.')}
            </div>
          </div>
        </div>

        <div className="rounded-md border p-4">
          <div className="mb-3 flex items-center justify-between gap-2">
            <div className="font-semibold">{t('answerCatalog.structured.profilePreview', 'Analysis Preview')}</div>
            {profile && (
              <div className="flex flex-wrap gap-1">
                <Badge variant="outline">{profile.kind}</Badge>
                <Badge variant="outline">{profile.row_count.toLocaleString()} {t('answerCatalog.sources.rows', 'Rows')}</Badge>
              </div>
            )}
          </div>
          {profile ? (
            <div className="grid gap-4">
              {profile.warnings.length > 0 && (
                <div className="rounded-md border border-amber-200 bg-amber-50 p-2 text-xs text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-200">
                  {profile.warnings.join(' / ')}
                </div>
              )}
              <div className="grid gap-2">
                <div className="text-xs font-medium text-muted-foreground">
                  {t('answerCatalog.structured.fieldMapping', 'Field Role Mapping')}
                </div>
                <div className="grid gap-2 md:grid-cols-2">
                  {mappingRoles.map((role) => (
                    <div key={role} className="grid gap-1">
                      <Label className="text-xs">{t(`answerCatalog.structured.roles.${role}`, role)}</Label>
                      <Select
                        value={mapping[role] || 'none'}
                        onValueChange={(value) => setMapping((current) => {
                          const next = { ...current }
                          if (value === 'none') delete next[role]
                          else next[role] = value
                          return next
                        })}
                      >
                        <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">{t('common.none', 'None')}</SelectItem>
                          {profile.columns.map((column) => (
                            <SelectItem key={`${role}-${column}`} value={column}>{column}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  ))}
                </div>
              </div>
              <div className="max-h-72 overflow-auto rounded-md border">
                <table className="w-full min-w-[680px] text-sm">
                  <thead className="bg-muted/40 text-xs text-muted-foreground">
                    <tr>
                      <th className="p-2 text-left">{t('answerCatalog.structured.field', 'Field')}</th>
                      <th className="p-2 text-left">{t('answerCatalog.structured.type', 'Type')}</th>
                      <th className="p-2 text-left">{t('answerCatalog.structured.role', 'Role')}</th>
                      <th className="p-2 text-right">{t('answerCatalog.structured.nullRate', 'Null')}</th>
                      <th className="p-2 text-right">{t('answerCatalog.structured.distinct', 'Distinct')}</th>
                      <th className="p-2 text-left">{t('answerCatalog.structured.guidance', 'Matching Hint')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {profile.fields.map((fieldProfile) => (
                      <tr key={fieldProfile.name} className="border-t">
                        <td className="p-2 font-medium">{fieldProfile.name}</td>
                        <td className="p-2">{fieldProfile.inferred_type}</td>
                        <td className="p-2">{t(`answerCatalog.structured.roles.${fieldProfile.semantic_role}`, fieldProfile.semantic_role)}</td>
                        <td className="p-2 text-right">{Math.round(fieldProfile.null_rate * 100)}%</td>
                        <td className="p-2 text-right">{fieldProfile.distinct_count.toLocaleString()}</td>
                        <td className="p-2">
                          <Checkbox
                            checked={guidanceColumns.includes(fieldProfile.name)}
                            onCheckedChange={(checked) => {
                              setGuidanceColumns((current) => checked
                                ? Array.from(new Set([...current, fieldProfile.name]))
                                : current.filter((column) => column !== fieldProfile.name))
                            }}
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {profile.sample_rows.length > 0 && (
                <pre className="max-h-40 overflow-auto rounded-md bg-muted/50 p-3 text-xs">
                  {JSON.stringify(profile.sample_rows.slice(0, 3), null, 2)}
                </pre>
              )}
            </div>
          ) : (
            <div className="rounded-md bg-muted/30 p-6 text-sm text-muted-foreground">
              {t('answerCatalog.structured.profileHint', 'Paste a structured source and run analysis to inspect fields, inferred types, role mapping, and matching hint candidates before creating a dataset.')}
            </div>
          )}
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-[420px_1fr]">
        <div className="rounded-md border p-4">
          <div className="mb-3 flex items-center gap-2 font-semibold">
            <PlayIcon className="h-4 w-4" />
            {t('answerCatalog.structured.safeQuery', 'Safe Lookup Preview / Run')}
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
              {t('answerCatalog.structured.queryHint', 'Choose a dataset, add an optional condition, then preview or run a safe lookup.')}
            </div>
          )}
          <div className="mt-5 border-t pt-4">
            <div className="mb-2 flex items-center justify-between gap-2">
              <div className="text-sm font-semibold">{t('answerCatalog.structured.lookupLogs', 'Recent Lookup Logs')}</div>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => fetchLookupLogs(selectedDatasetId || undefined)}
                disabled={!selectedDatasetId}
              >
                <RefreshCwIcon className="h-4 w-4" />
                {t('common.refresh', 'Refresh')}
              </Button>
            </div>
            {lookupLogs.length > 0 ? (
              <div className="max-h-52 overflow-auto rounded-md border">
                <table className="w-full min-w-[560px] text-xs">
                  <thead className="bg-muted/40 text-muted-foreground">
                    <tr>
                      <th className="p-2 text-left">{t('answerCatalog.structured.mode', 'Mode')}</th>
                      <th className="p-2 text-right">{t('answerCatalog.structured.rows', 'Rows')}</th>
                      <th className="p-2 text-right">{t('answerCatalog.structured.latency', 'Latency')}</th>
                      <th className="p-2 text-left">SQL</th>
                    </tr>
                  </thead>
                  <tbody>
                    {lookupLogs.map((log) => (
                      <tr key={log.log_id} className="border-t">
                        <td className="p-2">{log.preview_only ? t('answerCatalog.structured.preview', 'Preview') : t('answerCatalog.structured.execute', 'Execute')}</td>
                        <td className="p-2 text-right">{log.result_count.toLocaleString()}</td>
                        <td className="p-2 text-right">{Math.round(log.latency_ms)}ms</td>
                        <td className="max-w-72 truncate p-2 font-mono">{log.pseudo_sql}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="text-xs text-muted-foreground">
                {t('answerCatalog.structured.noLookupLogs', 'No structured lookup logs for this dataset yet.')}
              </div>
            )}
          </div>
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

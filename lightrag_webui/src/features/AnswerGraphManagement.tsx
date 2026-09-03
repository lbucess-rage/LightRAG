import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import {
  DatabaseZapIcon,
  EyeIcon,
  ListIcon,
  Loader2Icon,
  NetworkIcon,
  RefreshCwIcon,
  SaveIcon,
  ShieldCheckIcon,
  SparklesIcon,
  TriangleAlertIcon,
} from 'lucide-react'

import {
  AnswerGraphConfig,
  AnswerGraphProjection,
  AnswerGraphStatus,
  AnswerItem,
  TaskStatusResponse,
  getAnswerGraphConfig,
  getAnswerGraphStatus,
  listTasks,
  listAnswers,
  previewAnswerGraph,
  rebuildAnswerGraph,
  updateAnswerGraphConfig,
} from '@/api/lightrag'
import AnswerGraphVisualization from '@/components/answers/AnswerGraphVisualization'
import TaskProgressPanel from '@/components/documents/TaskProgressPanel'
import Badge from '@/components/ui/Badge'
import Button from '@/components/ui/Button'
import Input from '@/components/ui/Input'
import { Label } from '@/components/ui/Label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/Select'
import { Switch } from '@/components/ui/Switch'
import Textarea from '@/components/ui/Textarea'
import { localizedErrorMessage } from '@/lib/utils'
import { useWorkspaceStore } from '@/stores/workspace'

const splitTypes = (value: string) =>
  value
    .split(/[\n,]+/)
    .map((item) => item.trim())
    .filter(Boolean)

const GRAPH_TASK_TYPE = 'faq_graph_rebuild'
const RECENT_GRAPH_TASK_SECONDS = 60 * 60
const ACTIVE_TASK_STATUSES = new Set(['pending', 'running'])

const selectVisibleGraphTask = (tasks: TaskStatusResponse[]) => {
  const graphTasks = tasks
    .filter((task) => task.task_type === GRAPH_TASK_TYPE)
    .sort((left, right) => right.updated_at - left.updated_at)
  const activeTask = graphTasks.find((task) => ACTIVE_TASK_STATUSES.has(task.status))
  if (activeTask) return activeTask
  const latestTask = graphTasks[0]
  if (latestTask && Date.now() / 1000 - latestTask.updated_at <= RECENT_GRAPH_TASK_SECONDS) {
    return latestTask
  }
  return null
}

export default function AnswerGraphManagement() {
  const { t } = useTranslation()
  const currentWorkspaceId = useWorkspaceStore.use.currentWorkspaceId()
  const [config, setConfig] = useState<AnswerGraphConfig | null>(null)
  const [status, setStatus] = useState<AnswerGraphStatus | null>(null)
  const [answers, setAnswers] = useState<AnswerItem[]>([])
  const [selectedAnswerId, setSelectedAnswerId] = useState('')
  const [entityTypes, setEntityTypes] = useState('')
  const [relationTypes, setRelationTypes] = useState('')
  const [prompt, setPrompt] = useState('')
  const [useLlm, setUseLlm] = useState(true)
  const [preview, setPreview] = useState<AnswerGraphProjection | null>(null)
  const [previewMode, setPreviewMode] = useState<'graph' | 'list'>('graph')
  const [graphTask, setGraphTask] = useState<TaskStatusResponse | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [isPreviewing, setIsPreviewing] = useState(false)
  const [isRebuilding, setIsRebuilding] = useState(false)

  const loadGraphTask = useCallback(async () => {
    try {
      const tasks = await listTasks()
      if (currentWorkspaceId !== useWorkspaceStore.getState().currentWorkspaceId) return
      const nextTask = selectVisibleGraphTask(tasks)
      setGraphTask((currentTask) => {
        if (
          currentTask?.task_id === nextTask?.task_id
          && currentTask?.status === nextTask?.status
          && currentTask?.progress === nextTask?.progress
          && currentTask?.updated_at === nextTask?.updated_at
        ) {
          return currentTask
        }
        return nextTask
      })
    } catch (error) {
      toast.error(localizedErrorMessage(error, t))
    }
  }, [currentWorkspaceId, t])

  const load = useCallback(async () => {
    setIsLoading(true)
    try {
      const [nextConfig, nextStatus, answerPage] = await Promise.all([
        getAnswerGraphConfig(),
        getAnswerGraphStatus(),
        listAnswers({ status: 'all', page: 1, page_size: 100 }),
      ])
      if (currentWorkspaceId !== useWorkspaceStore.getState().currentWorkspaceId) return
      setConfig(nextConfig)
      setStatus(nextStatus)
      setAnswers(answerPage.answers)
      setEntityTypes(nextConfig.entity_types.join(', '))
      setRelationTypes(nextConfig.relation_types.join(', '))
      setPrompt(nextConfig.extraction_prompt)
      setSelectedAnswerId((current) => current || answerPage.answers[0]?.answer_id || '')
    } catch (error) {
      toast.error(localizedErrorMessage(error, t))
    } finally {
      setIsLoading(false)
    }
  }, [currentWorkspaceId, t])

  useEffect(() => {
    setPreview(null)
    setGraphTask(null)
    void load()
    void loadGraphTask()
  }, [load, loadGraphTask])

  const isGraphTaskActive = Boolean(
    graphTask && ACTIVE_TASK_STATUSES.has(graphTask.status)
  )

  const handleGraphTaskSettled = useCallback(() => {
    void loadGraphTask()
    void load()
  }, [load, loadGraphTask])

  const handleGraphTaskStreamError = useCallback(() => {
    void loadGraphTask()
  }, [loadGraphTask])

  useEffect(() => {
    if (!isGraphTaskActive) return
    const intervalId = window.setInterval(() => {
      void loadGraphTask()
    }, 2500)
    return () => window.clearInterval(intervalId)
  }, [isGraphTaskActive, loadGraphTask])

  const selectedAnswer = useMemo(
    () => answers.find((answer) => answer.answer_id === selectedAnswerId),
    [answers, selectedAnswerId]
  )
  const rebuildTargetCount = (status?.stale || 0) + (status?.missing || 0) + (status?.failed || 0)

  const saveConfig = async () => {
    if (!config) return
    setIsSaving(true)
    try {
      const saved = await updateAnswerGraphConfig({
        enabled: config.enabled,
        auto_sync: config.auto_sync,
        graph_weight: config.graph_weight,
        min_similarity: config.min_similarity,
        max_hops: config.max_hops,
        precision_mode: config.precision_mode,
        precision_min_score: config.precision_min_score,
        min_score_margin: config.min_score_margin,
        min_category_margin: config.min_category_margin,
        min_evidence_sources: config.min_evidence_sources,
        llm_min_confidence: config.llm_min_confidence,
        ai_extraction_strategy: config.ai_extraction_strategy,
        ai_retry_max_tokens: config.ai_retry_max_tokens,
        ai_min_relations: config.ai_min_relations,
        ai_min_relation_types: config.ai_min_relation_types,
        entity_types: splitTypes(entityTypes),
        relation_types: splitTypes(relationTypes),
        extraction_prompt: prompt,
      })
      setConfig(saved)
      setEntityTypes(saved.entity_types.join(', '))
      setRelationTypes(saved.relation_types.join(', '))
      toast.success(t('answerCatalog.graph.saved', 'FAQ graph settings were saved.'))
      await load()
    } catch (error) {
      toast.error(localizedErrorMessage(error, t))
    } finally {
      setIsSaving(false)
    }
  }

  const runPreview = async () => {
    if (!selectedAnswerId) {
      toast.error(t('answerCatalog.graph.answerRequired', 'Select an FAQ to preview.'))
      return
    }
    setIsPreviewing(true)
    try {
      setPreview(await previewAnswerGraph(selectedAnswerId, useLlm))
    } catch (error) {
      toast.error(localizedErrorMessage(error, t))
    } finally {
      setIsPreviewing(false)
    }
  }

  const runRebuild = async () => {
    if (!config?.enabled) {
      toast.error(t('answerCatalog.graph.enableFirst', 'Enable and save the FAQ graph first.'))
      return
    }
    setIsRebuilding(true)
    try {
      const response = await rebuildAnswerGraph({
        include_drafts: true,
        only_stale: true,
        use_llm: useLlm,
        limit: 1000,
      })
      setGraphTask({
        task_id: response.task_id,
        task_type: GRAPH_TASK_TYPE,
        workspace: currentWorkspaceId || '',
        status: 'pending',
        progress: 0,
        message: response.message,
        created_at: Date.now() / 1000,
        updated_at: Date.now() / 1000,
        metadata: { answer_count: response.answer_count },
      })
      toast.success(
        response.reused
          ? t('answerCatalog.graph.rebuildResumed', 'Reconnected to the FAQ graph build already in progress.')
          : t('answerCatalog.graph.rebuildStarted', '{{count}} FAQ graph jobs started.', {
            count: response.answer_count,
          })
      )
      void loadGraphTask()
    } catch (error) {
      toast.error(localizedErrorMessage(error, t))
    } finally {
      setIsRebuilding(false)
    }
  }

  if (isLoading && !config) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2Icon className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    )
  }

  return (
    <div className="grid h-full min-h-0 gap-4 overflow-auto xl:grid-cols-[minmax(360px,0.8fr)_minmax(560px,1.2fr)]">
      <section className="space-y-4 rounded-md border p-4">
        <div className="flex items-start justify-between gap-3 border-b pb-3">
          <div>
            <div className="flex items-center gap-2 font-semibold">
              <NetworkIcon className="h-4 w-4" />
              {t('answerCatalog.graph.settings', 'FAQ graph settings')}
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              {t(
                'answerCatalog.graph.settingsDescription',
                'Keep the current keyword and vector search, then optionally add graph paths as supporting evidence.'
              )}
            </p>
          </div>
          <Badge variant="outline" className="shrink-0 whitespace-nowrap">
            {t('answerCatalog.graph.schemaVersion', 'Schema v{{version}}', {
              version: config?.schema_version || 1,
            })}
          </Badge>
        </div>

        {config && (
          <>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="flex items-center justify-between rounded-md border px-3 py-2">
                <span>
                  <span className="block text-sm font-medium">
                    {t('answerCatalog.graph.enabled', 'Use FAQ graph')}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {t('answerCatalog.graph.enabledHint', 'Makes graph_hybrid available.')}
                  </span>
                </span>
                <Switch
                  checked={config.enabled}
                  onCheckedChange={(enabled) => setConfig({ ...config, enabled })}
                />
              </label>
              <label className="flex items-center justify-between rounded-md border px-3 py-2">
                <span>
                  <span className="block text-sm font-medium">
                    {t('answerCatalog.graph.autoSync', 'Keep graph updated')}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {t('answerCatalog.graph.autoSyncHint', 'Refreshes a changed FAQ automatically.')}
                  </span>
                </span>
                <Switch
                  checked={config.auto_sync}
                  onCheckedChange={(auto_sync) => setConfig({ ...config, auto_sync })}
                />
              </label>
            </div>

            <div className="rounded-md border">
              <div className="space-y-3 px-3 py-3">
                <div>
                  <Label>{t('answerCatalog.graph.aiStrategy', 'AI graph build strategy')}</Label>
                  <Select
                    value={config.ai_extraction_strategy}
                    onValueChange={(value) => setConfig({
                      ...config,
                      ai_extraction_strategy: value as AnswerGraphConfig['ai_extraction_strategy'],
                    })}
                  >
                    <SelectTrigger className="mt-1">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="fast">
                        {t('answerCatalog.graph.aiStrategyFast', 'Fast structured extraction')}
                      </SelectItem>
                      <SelectItem value="adaptive">
                        {t('answerCatalog.graph.aiStrategyAdaptive', 'Adaptive analysis (experimental)')}
                      </SelectItem>
                      <SelectItem value="deep">
                        {t('answerCatalog.graph.aiStrategyDeep', 'Deep analysis for every FAQ')}
                      </SelectItem>
                    </SelectContent>
                  </Select>
                  <p className="mt-1 text-xs leading-5 text-muted-foreground">
                    {t(`answerCatalog.graph.aiStrategyHint.${config.ai_extraction_strategy}`)}
                  </p>
                </div>
                {config.ai_extraction_strategy !== 'fast' && (
                  <div className="grid gap-3 border-t pt-3 sm:grid-cols-3">
                    <div>
                      <Label>{t('answerCatalog.graph.aiRetryMaxTokens', 'Deep analysis token budget')}</Label>
                      <Input
                        className="mt-1"
                        type="number"
                        min="1024"
                        max="32768"
                        step="1024"
                        value={config.ai_retry_max_tokens}
                        onChange={(event) => setConfig({
                          ...config,
                          ai_retry_max_tokens: Number(event.target.value),
                        })}
                      />
                    </div>
                    <div>
                      <Label>{t('answerCatalog.graph.aiMinRelations', 'Minimum answer relations')}</Label>
                      <Input
                        className="mt-1"
                        type="number"
                        min="1"
                        max="12"
                        value={config.ai_min_relations}
                        onChange={(event) => setConfig({
                          ...config,
                          ai_min_relations: Number(event.target.value),
                        })}
                      />
                    </div>
                    <div>
                      <Label>{t('answerCatalog.graph.aiMinRelationTypes', 'Minimum relation types')}</Label>
                      <Input
                        className="mt-1"
                        type="number"
                        min="1"
                        max="8"
                        value={config.ai_min_relation_types}
                        onChange={(event) => setConfig({
                          ...config,
                          ai_min_relation_types: Number(event.target.value),
                        })}
                      />
                    </div>
                  </div>
                )}
              </div>
            </div>

            <div className="rounded-md border">
              <label className="flex items-center justify-between gap-4 px-3 py-3">
                <span className="flex min-w-0 items-start gap-3">
                  <ShieldCheckIcon className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
                  <span>
                    <span className="block text-sm font-medium">
                      {t('answerCatalog.graph.precisionMode', 'Answer only when certain')}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {t(
                        'answerCatalog.graph.precisionModeHint',
                        'Selects the highest-ranked candidate after minimum score and evidence checks.'
                      )}
                    </span>
                  </span>
                </span>
                <Switch
                  checked={config.precision_mode}
                  onCheckedChange={(precision_mode) => setConfig({ ...config, precision_mode })}
                />
              </label>
              {config.precision_mode && (
                <div className="grid gap-3 border-t bg-muted/10 p-3 sm:grid-cols-2 xl:grid-cols-3">
                  <div>
                    <Label>{t('answerCatalog.graph.precisionMinScore', 'Minimum answer score')}</Label>
                    <Input
                      className="mt-1"
                      type="number"
                      min="0"
                      max="1"
                      step="0.01"
                      value={config.precision_min_score}
                      onChange={(event) =>
                        setConfig({ ...config, precision_min_score: Number(event.target.value) })
                      }
                    />
                  </div>
                  <div>
                    <Label>{t('answerCatalog.graph.minScoreMargin', 'Candidate score gap')}</Label>
                    <Input
                      className="mt-1"
                      type="number"
                      min="0"
                      max="1"
                      step="0.01"
                      value={config.min_score_margin}
                      onChange={(event) =>
                        setConfig({ ...config, min_score_margin: Number(event.target.value) })
                      }
                    />
                  </div>
                  <div>
                    <Label>{t('answerCatalog.graph.minCategoryMargin', 'Category score gap')}</Label>
                    <Input
                      className="mt-1"
                      type="number"
                      min="0"
                      max="1"
                      step="0.01"
                      value={config.min_category_margin}
                      onChange={(event) =>
                        setConfig({ ...config, min_category_margin: Number(event.target.value) })
                      }
                    />
                  </div>
                  <div>
                    <Label>{t('answerCatalog.graph.minEvidenceSources', 'Required evidence types')}</Label>
                    <Select
                      value={String(config.min_evidence_sources)}
                      onValueChange={(value) =>
                        setConfig({ ...config, min_evidence_sources: Number(value) })
                      }
                    >
                      <SelectTrigger className="mt-1">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="1">1</SelectItem>
                        <SelectItem value="2">2</SelectItem>
                        <SelectItem value="3">3</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label>{t('answerCatalog.graph.llmMinConfidence', 'Minimum AI confidence')}</Label>
                    <Input
                      className="mt-1"
                      type="number"
                      min="0"
                      max="1"
                      step="0.01"
                      value={config.llm_min_confidence}
                      onChange={(event) =>
                        setConfig({ ...config, llm_min_confidence: Number(event.target.value) })
                      }
                    />
                  </div>
                </div>
              )}
            </div>

            <div className="grid gap-3 sm:grid-cols-3">
              <div>
                <Label>{t('answerCatalog.graph.weight', 'Graph score weight')}</Label>
                <Input
                  className="mt-1"
                  type="number"
                  min="0"
                  max="1"
                  step="0.05"
                  value={config.graph_weight}
                  onChange={(event) =>
                    setConfig({ ...config, graph_weight: Number(event.target.value) })
                  }
                />
              </div>
              <div>
                <Label>
                  {t('answerCatalog.graph.minSimilarity', 'Minimum graph similarity')}
                </Label>
                <Input
                  className="mt-1"
                  type="number"
                  min="0"
                  max="1"
                  step="0.05"
                  value={config.min_similarity}
                  onChange={(event) =>
                    setConfig({ ...config, min_similarity: Number(event.target.value) })
                  }
                />
              </div>
              <div>
                <Label>{t('answerCatalog.graph.maxHops', 'Maximum relation steps')}</Label>
                <Select
                  value={String(config.max_hops)}
                  onValueChange={(value) => setConfig({ ...config, max_hops: Number(value) })}
                >
                  <SelectTrigger className="mt-1">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="1">1</SelectItem>
                    <SelectItem value="2">2</SelectItem>
                    <SelectItem value="3">3</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div>
              <Label>{t('answerCatalog.graph.entityTypes', 'Entity types')}</Label>
              <Textarea
                className="mt-1 min-h-20"
                value={entityTypes}
                onChange={(event) => setEntityTypes(event.target.value)}
              />
            </div>
            <div>
              <Label>{t('answerCatalog.graph.relationTypes', 'Relation types')}</Label>
              <Textarea
                className="mt-1 min-h-20"
                value={relationTypes}
                onChange={(event) => setRelationTypes(event.target.value)}
              />
            </div>
            <div>
              <Label>{t('answerCatalog.graph.prompt', 'AI extraction reference prompt')}</Label>
              <Textarea
                className="mt-1 min-h-36 font-mono text-xs"
                value={prompt}
                onChange={(event) => setPrompt(event.target.value)}
              />
              <p className="mt-1 text-xs text-muted-foreground">
                {t(
                  'answerCatalog.graph.promptHint',
                  'Used only when AI supplementation is selected. The deterministic FAQ graph is always created first.'
                )}
              </p>
            </div>

            <div className="flex justify-end border-t pt-3">
              <Button onClick={saveConfig} disabled={isSaving}>
                {isSaving ? <Loader2Icon className="h-4 w-4 animate-spin" /> : <SaveIcon className="h-4 w-4" />}
                {t('common.save', 'Save')}
              </Button>
            </div>
          </>
        )}
      </section>

      <section className="flex min-h-[620px] flex-col rounded-md border">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b p-4">
          <div>
            <div className="font-semibold">
              {t('answerCatalog.graph.previewAndBuild', 'Preview and rebuild')}
            </div>
            <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
              <span>{t('answerCatalog.graph.ready', 'Ready')} {status?.ready || 0}</span>
              <span>{t('answerCatalog.graph.stale', 'Needs update')} {status?.stale || 0}</span>
              <span>{t('answerCatalog.graph.missing', 'Not built')} {status?.missing || 0}</span>
              <span>{t('answerCatalog.graph.failed', 'Failed')} {status?.failed || 0}</span>
            </div>
          </div>
          <Button variant="outline" onClick={() => void load()}>
            <RefreshCwIcon className="h-4 w-4" />
            {t('common.refresh', 'Refresh')}
          </Button>
        </div>

        <div className="grid gap-3 border-b p-4 lg:grid-cols-[minmax(240px,1fr)_auto_auto]">
          <div>
            <Label>{t('answerCatalog.graph.previewAnswer', 'FAQ to preview')}</Label>
            <Select value={selectedAnswerId} onValueChange={setSelectedAnswerId}>
              <SelectTrigger className="mt-1">
                <SelectValue placeholder={t('answerCatalog.graph.selectAnswer', 'Select an FAQ')} />
              </SelectTrigger>
              <SelectContent>
                {answers.map((answer) => (
                  <SelectItem key={answer.answer_id} value={answer.answer_id}>
                    {answer.title}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="mt-1 text-xs text-muted-foreground">
              {t('answerCatalog.graph.previewSelectionHint', 'This selection applies only to the preview below.')}
            </p>
          </div>
          <label className="flex items-end gap-2 pb-2 text-sm">
            <Switch checked={useLlm} onCheckedChange={setUseLlm} />
            {t('answerCatalog.graph.useLlm', 'Build graph with AI')}
          </label>
          <div className="flex items-end">
            <Button variant="outline" onClick={runPreview} disabled={isPreviewing}>
              {isPreviewing ? <Loader2Icon className="h-4 w-4 animate-spin" /> : <EyeIcon className="h-4 w-4" />}
              {t('answerCatalog.graph.preview', 'Preview')}
            </Button>
          </div>
          <div
            className={`flex items-start gap-2 rounded-md border px-3 py-2 text-xs leading-5 lg:col-span-3 ${
              useLlm
                ? 'border-emerald-200 bg-emerald-50/50 text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950/10 dark:text-emerald-100'
                : 'border-amber-300 bg-amber-50 text-amber-950 dark:border-amber-800 dark:bg-amber-950/20 dark:text-amber-100'
            }`}
          >
            {useLlm
              ? <SparklesIcon className="mt-0.5 h-4 w-4 shrink-0" />
              : <TriangleAlertIcon className="mt-0.5 h-4 w-4 shrink-0" />}
            <span>
              {useLlm
                ? t('answerCatalog.graph.aiModeHint', 'Build the base graph with rules, then use the workspace AI profile to add entities and relations.')
                : t('answerCatalog.graph.ruleModeWarning', 'Rule-based mode: only questions, finding hints, and tags are used. The workspace AI profile is not called.')}
            </span>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 border-b bg-muted/20 px-4 py-3">
          <div>
            <div className="flex items-center gap-2 font-medium">
              <DatabaseZapIcon className="h-4 w-4" />
              {t('answerCatalog.graph.workspaceBuildTitle', 'Build workspace FAQ graphs')}
              <Badge variant="outline">
                {t('answerCatalog.graph.rebuildTargetCount', '{{count}} target FAQ', {
                  count: rebuildTargetCount,
                })}
              </Badge>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              {t('answerCatalog.graph.workspaceBuildHint', 'Regardless of the preview selection, build every missing, changed, or failed FAQ in this workspace.')}
            </p>
          </div>
          <Button
            onClick={runRebuild}
            disabled={
              isRebuilding
              || isGraphTaskActive
              || !config?.enabled
              || rebuildTargetCount === 0
            }
          >
            {isRebuilding || isGraphTaskActive
              ? <Loader2Icon className="h-4 w-4 animate-spin" />
              : <DatabaseZapIcon className="h-4 w-4" />}
            {isGraphTaskActive
              ? t('answerCatalog.graph.rebuildRunning', 'Building FAQ graphs ({{progress}}%)', {
                progress: Math.round(graphTask?.progress || 0),
              })
              : t('answerCatalog.graph.rebuild', 'Build all missing and changed FAQ')}
          </Button>
        </div>

        {graphTask && (
          <div className="border-b p-4">
            <div className="rounded-md border bg-muted/20 p-3">
              <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
                <div>
                  <div className="font-medium">
                    {t('answerCatalog.graph.rebuildStatusTitle', 'FAQ graph build status')}
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {isGraphTaskActive
                      ? t(
                        'answerCatalog.graph.rebuildBackgroundHint',
                        'The build continues on the server after you leave this screen. Progress is restored when you return.'
                      )
                      : graphTask.status === 'completed'
                        ? t('answerCatalog.graph.rebuildCompleted', 'The latest FAQ graph build completed.')
                        : graphTask.status === 'cancelled'
                          ? t('answerCatalog.graph.rebuildCancelled', 'The FAQ graph build was cancelled.')
                          : t('answerCatalog.graph.rebuildFailed', 'The FAQ graph build failed. Review the message below.')}
                  </p>
                </div>
                <div className="text-right text-xs text-muted-foreground">
                  <div>
                    {t('answerCatalog.graph.rebuildAnswerCount', 'Target {{count}} FAQ', {
                      count: Number(graphTask.metadata?.answer_count || 0),
                    })}
                  </div>
                  <div className="font-mono">{graphTask.task_id}</div>
                </div>
              </div>
              <TaskProgressPanel
                taskId={graphTask.task_id}
                compact
                onComplete={handleGraphTaskSettled}
                onError={handleGraphTaskStreamError}
                onCancel={handleGraphTaskSettled}
              />
            </div>
          </div>
        )}

        <div className="min-h-0 flex-1 overflow-auto p-4">
          {!preview ? (
            <div className="flex h-full min-h-60 items-center justify-center text-center text-sm text-muted-foreground">
              <div>
                <NetworkIcon className="mx-auto mb-3 h-7 w-7" />
                <div className="font-medium text-foreground">
                  {selectedAnswer?.title || t('answerCatalog.graph.noPreview', 'Choose an FAQ and preview its graph.')}
                </div>
                <p className="mt-1">
                  {t(
                    'answerCatalog.graph.noPreviewHint',
                    'Preview does not save anything. Review the nodes and relations before rebuilding.'
                  )}
                </p>
              </div>
            </div>
          ) : (
            <div className="space-y-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="outline">{preview.answer_id}</Badge>
                  <Badge variant="outline">
                    {t('answerCatalog.graph.nodeCount', '{{count}} nodes', { count: preview.nodes.length })}
                  </Badge>
                  <Badge variant="outline">
                    {t('answerCatalog.graph.relationCount', '{{count}} relations', { count: preview.relations.length })}
                  </Badge>
                </div>
                <div className="flex rounded-md border bg-muted/30 p-1">
                  <Button
                    size="sm"
                    variant={previewMode === 'graph' ? 'default' : 'ghost'}
                    onClick={() => setPreviewMode('graph')}
                  >
                    <NetworkIcon className="h-4 w-4" />
                    {t('answerCatalog.graph.visualization', 'Graph view')}
                  </Button>
                  <Button
                    size="sm"
                    variant={previewMode === 'list' ? 'default' : 'ghost'}
                    onClick={() => setPreviewMode('list')}
                  >
                    <ListIcon className="h-4 w-4" />
                    {t('answerCatalog.graph.listView', 'List view')}
                  </Button>
                </div>
              </div>

              {previewMode === 'graph' ? (
                <AnswerGraphVisualization
                  key={`${preview.answer_id}-${preview.content_hash}-${preview.nodes.length}-${preview.relations.length}`}
                  projection={preview}
                />
              ) : (
                <div className="space-y-5">
                  <div>
                    <div className="mb-2 text-sm font-semibold">
                      {t('answerCatalog.graph.nodes', 'Nodes')}
                    </div>
                    <div className="grid gap-2 md:grid-cols-2">
                      {preview.nodes.map((node) => (
                        <div key={node.node_id} className="rounded-md border p-3">
                          <div className="flex items-center justify-between gap-2">
                            <span className="font-medium">{node.label}</span>
                            <Badge variant="outline">{node.entity_type}</Badge>
                          </div>
                          {node.description && (
                            <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{node.description}</p>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                  <div>
                    <div className="mb-2 text-sm font-semibold">
                      {t('answerCatalog.graph.relations', 'Relations')}
                    </div>
                    <div className="divide-y rounded-md border">
                      {preview.relations.map((relation, index) => (
                        <div key={`${relation.source_id}-${relation.target_id}-${index}`} className="grid gap-1 p-3 text-sm md:grid-cols-[1fr_auto_1fr] md:items-center">
                          <span>{relation.source_id.split('::').at(-1)}</span>
                          <Badge variant="outline">{relation.relation_type}</Badge>
                          <span className="md:text-right">{relation.target_id.split('::').at(-1)}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </section>
    </div>
  )
}

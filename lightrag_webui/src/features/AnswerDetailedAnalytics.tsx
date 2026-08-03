import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import {
  AlertTriangleIcon,
  BarChart3Icon,
  GaugeIcon,
  RefreshCwIcon,
  RotateCcwIcon,
  SearchIcon,
  SearchXIcon,
} from 'lucide-react'

import {
  AnswerAnalyticsGroupRow,
  AnswerEvent,
  AnswerEventStatsResponse,
  AnswerItem,
  getAnswerEventStats,
  getAnswerStats,
  listAnswerEventsPage,
} from '@/api/lightrag'
import AnswerHelpButton from '@/components/answers/AnswerHelpButton'
import Badge from '@/components/ui/Badge'
import Button from '@/components/ui/Button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/Dialog'
import Input from '@/components/ui/Input'
import PaginationControls from '@/components/ui/PaginationControls'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/Select'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/Tabs'
import { cn, localizedErrorMessage } from '@/lib/utils'
import { useWorkspaceStore } from '@/stores/workspace'

type AnalyticsEventType = 'all' | 'resolve' | 'search' | 'view' | 'feedback'
type MatchStatus = 'all' | 'matched' | 'no_match'
type PeriodPreset = 'today' | '7d' | '30d' | 'custom'
type AnalysisView = 'overview' | 'answers' | 'queries' | 'sources' | 'modes' | 'time' | 'failures'
type DrilldownKind = 'selected_answer' | 'query' | 'source' | 'mode' | 'date' | 'hour' | 'match_status'

type AnalyticsFilters = {
  period: PeriodPreset
  dateFrom: string
  dateTo: string
  eventType: AnalyticsEventType
  matchStatus: MatchStatus
  source: string
  mode: string
  minConfidence: string
  maxLatencyMs: string
  search: string
}

type DrilldownFilter = {
  kind: DrilldownKind
  key: string
  label: string
  count: number
}

const EVENT_PAGE_SIZE_OPTIONS = [
  { value: 10, label: '10' },
  { value: 25, label: '25' },
  { value: 50, label: '50' },
  { value: 100, label: '100' },
]

const DEFAULT_EVENT_STATS: AnswerEventStatsResponse = {
  workspace: '',
  total_events: 0,
  no_match: 0,
  avg_latency_ms: 0,
  timezone: 'Asia/Seoul',
  selected_answers: [],
  queries: [],
  sources: [],
  modes: [],
  dates: [],
  hours: [],
}

export default function AnswerDetailedAnalytics({ embedded = false }: { embedded?: boolean }) {
  const { t } = useTranslation()
  const currentWorkspaceId = useWorkspaceStore.use.currentWorkspaceId()
  const timezoneName = useMemo(() => Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Seoul', [])
  const [draftFilters, setDraftFilters] = useState<AnalyticsFilters>(() => createDefaultFilters())
  const [appliedFilters, setAppliedFilters] = useState<AnalyticsFilters>(() => createDefaultFilters())
  const [view, setView] = useState<AnalysisView>('overview')
  const [selectedReport, setSelectedReport] = useState<DrilldownFilter | null>(null)
  const [events, setEvents] = useState<AnswerEvent[]>([])
  const [answerById, setAnswerById] = useState<Record<string, AnswerItem>>({})
  const [summary, setSummary] = useState<{ answers?: Record<string, number>; events?: Record<string, number> }>({})
  const [eventStats, setEventStats] = useState<AnswerEventStatsResponse>(DEFAULT_EVENT_STATS)
  const [selectedEvent, setSelectedEvent] = useState<AnswerEvent | null>(null)
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(25)
  const [totalEvents, setTotalEvents] = useState(0)
  const [isLoading, setIsLoading] = useState(false)
  const [refreshToken, setRefreshToken] = useState(0)

  const baseParams = useMemo(() => buildFilterParams(appliedFilters, timezoneName), [appliedFilters, timezoneName])
  const hasPendingFilters = useMemo(
    () => !areFiltersEqual(draftFilters, appliedFilters),
    [draftFilters, appliedFilters]
  )

  const eventParams = useMemo(() => {
    const params: Record<string, string | number> = {
      ...baseParams,
      page,
      page_size: pageSize,
    }
    if (selectedReport) {
      if (selectedReport.kind === 'selected_answer') params.selected_answer_id = selectedReport.key
      if (selectedReport.kind === 'query') params.query = selectedReport.label
      if (selectedReport.kind === 'source') params.source = selectedReport.key
      if (selectedReport.kind === 'mode') params.mode = selectedReport.key
      if (selectedReport.kind === 'date') params.date = selectedReport.key
      if (selectedReport.kind === 'hour') params.hour = selectedReport.key
      if (selectedReport.kind === 'match_status') params.match_status = selectedReport.key
    }
    return params
  }, [baseParams, page, pageSize, selectedReport])

  const fetchData = useCallback(async () => {
    const workspaceId = currentWorkspaceId
    setIsLoading(true)
    try {
      const [answerSummary, groupedStats, eventPage] = await Promise.all([
        getAnswerStats(),
        getAnswerEventStats({ ...baseParams, limit: 30 }),
        listAnswerEventsPage(eventParams),
      ])
      if (workspaceId !== useWorkspaceStore.getState().currentWorkspaceId) return
      setSummary(answerSummary)
      setEventStats(groupedStats)
      setEvents(eventPage.events)
      setTotalEvents(eventPage.total)
      setAnswerById(Object.fromEntries((eventPage.answers || []).map((answer) => [answer.answer_id, answer])))
    } catch (err) {
      toast.error(localizedErrorMessage(err, t))
    } finally {
      setIsLoading(false)
    }
  }, [baseParams, currentWorkspaceId, eventParams, t])

  useEffect(() => {
    setEvents([])
    setAnswerById({})
    setSummary({})
    setEventStats(DEFAULT_EVENT_STATS)
    setSelectedEvent(null)
    setSelectedReport(null)
    setPage(1)
  }, [currentWorkspaceId])

  useEffect(() => {
    fetchData()
  }, [fetchData, refreshToken])

  const totalLookupEvents = Number(summary.events?.resolves || 0) + Number(summary.events?.searches || 0)
  const matchCount = Math.max(0, eventStats.total_events - eventStats.no_match)
  const matchRate = eventStats.total_events ? Math.round((matchCount / eventStats.total_events) * 1000) / 10 : 0
  const noMatchRate = eventStats.total_events ? Math.round((eventStats.no_match / eventStats.total_events) * 1000) / 10 : 0
  const llmCount = eventStats.modes.find((row) => row.key === 'llm_rerank')?.count || 0
  const llmRate = eventStats.total_events ? Math.round((llmCount / eventStats.total_events) * 1000) / 10 : 0
  const totalPages = Math.max(1, Math.ceil(totalEvents / pageSize))
  const activeListTitle = selectedReport
    ? `${drilldownKindLabel(selectedReport.kind, t)}: ${selectedReport.label}`
    : t('answerCatalog.detailedAnalytics.allFilteredEvents', '현재 조건의 전체 이벤트')

  const sourceOptions = mergeFilterOptions(eventStats.sources, draftFilters.source)
  const modeOptions = mergeFilterOptions(eventStats.modes, draftFilters.mode)

  const updateFilter = <K extends keyof AnalyticsFilters>(key: K, value: AnalyticsFilters[K]) => {
    setDraftFilters((previous) => {
      const next = { ...previous, [key]: value }
      if (key === 'period') return applyPresetToFilters(next, value as PeriodPreset)
      return next
    })
  }

  const applyFilters = () => {
    setAppliedFilters(draftFilters)
    setSelectedReport(null)
    setPage(1)
    setRefreshToken((value) => value + 1)
  }

  const resetFilters = () => {
    setDraftFilters(createDefaultFilters())
  }

  const selectReport = (kind: DrilldownKind, row: AnswerAnalyticsGroupRow) => {
    setSelectedReport({
      kind,
      key: row.key,
      label: displayGroupLabel(kind, row, t),
      count: row.count,
    })
    setPage(1)
  }

  const selectMatchStatus = (status: MatchStatus, label: string, count: number) => {
    setSelectedReport({ kind: 'match_status', key: status, label, count })
    setPage(1)
  }

  return (
    <div className={`flex h-full flex-col gap-4 overflow-hidden ${embedded ? 'p-0' : 'p-4'}`}>
      {!embedded && (
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <div className="rounded-md border bg-muted/40 p-2">
              <GaugeIcon className="h-5 w-5" />
            </div>
            <div>
              <h1 className="text-2xl font-bold">{t('answerCatalog.detailedAnalytics.title', '상세 결과 분석')}</h1>
              <p className="mt-1 text-sm text-muted-foreground">
                {t('answerCatalog.detailedAnalytics.description', '기간과 조건을 먼저 정한 뒤 답변, 질문, 소스, 조회 방식, 시간대별 결과를 분석합니다.')}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                {t('answerCatalog.analytics.timeBasis', '일자와 시간대는 이벤트 저장 시각(create_time)을 {{timezone}} 기준으로 변환해 집계합니다.', { timezone: eventStats.timezone || timezoneName })}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <AnswerHelpButton />
            <Button type="button" variant="outline" size="sm" onClick={() => setRefreshToken((value) => value + 1)} disabled={isLoading}>
              <RefreshCwIcon className={isLoading ? 'h-4 w-4 animate-spin' : 'h-4 w-4'} />
              {t('common.refresh', '새로고침')}
            </Button>
          </div>
        </div>
      )}

      <form
        className="rounded-md border bg-card p-3"
        onSubmit={(event) => {
          event.preventDefault()
          applyFilters()
        }}
        onKeyDown={(event) => {
          if (event.key !== 'Enter' || !(event.target instanceof HTMLInputElement)) return
          event.preventDefault()
          applyFilters()
        }}
      >
        <div className="grid gap-3">
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-[140px_150px_150px_140px_140px_140px_120px_145px] 2xl:grid-cols-[150px_165px_165px_150px_150px_150px_130px_150px]">
            <FilterSelect
              label={t('answerCatalog.detailedAnalytics.period', '기간')}
              value={draftFilters.period}
              onValueChange={(value) => updateFilter('period', value as PeriodPreset)}
              items={[
                ['today', t('answerCatalog.detailedAnalytics.periods.today', '오늘')],
                ['7d', t('answerCatalog.detailedAnalytics.periods.last7Days', '최근 7일')],
                ['30d', t('answerCatalog.detailedAnalytics.periods.last30Days', '최근 30일')],
                ['custom', t('answerCatalog.detailedAnalytics.periods.custom', '직접 선택')],
              ]}
            />
            <FilterInput
              label={t('answerCatalog.detailedAnalytics.fromDate', '시작일')}
              type="date"
              value={draftFilters.dateFrom}
              onChange={(value) => updateFilter('dateFrom', value)}
            />
            <FilterInput
              label={t('answerCatalog.detailedAnalytics.toDate', '종료일')}
              type="date"
              value={draftFilters.dateTo}
              onChange={(value) => updateFilter('dateTo', value)}
            />
            <FilterSelect
              label={t('answerCatalog.analytics.eventType', '기록 유형')}
              value={draftFilters.eventType}
              onValueChange={(value) => updateFilter('eventType', value as AnalyticsEventType)}
              items={[
                ['all', t('common.all', '전체')],
                ['resolve', t('answerCatalog.analytics.eventTypes.resolve', '답변 선택')],
                ['search', t('answerCatalog.analytics.eventTypes.search', '검색 API')],
                ['view', t('answerCatalog.analytics.eventTypes.view', '조회')],
                ['feedback', t('answerCatalog.analytics.eventTypes.feedback', '피드백')],
              ]}
            />
            <FilterSelect
              label={t('answerCatalog.detailedAnalytics.matchStatus', '매칭 결과')}
              value={draftFilters.matchStatus}
              onValueChange={(value) => updateFilter('matchStatus', value as MatchStatus)}
              items={[
                ['all', t('common.all', '전체')],
                ['matched', t('answerCatalog.detailedAnalytics.matched', '매칭 성공')],
                ['no_match', t('answerCatalog.analytics.noMatch', '매칭 없음')],
              ]}
            />
            <FilterSelect
              label={t('answerCatalog.analytics.sourceGroups', '소스')}
              value={draftFilters.source}
              onValueChange={(value) => updateFilter('source', value)}
              items={[['all', t('common.all', '전체')], ...sourceOptions.map((row) => [row.key, displayGroupLabel('source', row, t)] as const)]}
            />
            <FilterInput
              label={t('answerCatalog.detailedAnalytics.minConfidence', '최소 신뢰도')}
              value={draftFilters.minConfidence}
              onChange={(value) => updateFilter('minConfidence', value)}
              placeholder="0.5"
            />
            <FilterInput
              label={t('answerCatalog.detailedAnalytics.maxLatency', '최대 응답시간(ms)')}
              value={draftFilters.maxLatencyMs}
              onChange={(value) => updateFilter('maxLatencyMs', value)}
              placeholder="1000"
            />
          </div>

          <div className="grid gap-2 md:grid-cols-[140px_minmax(320px,1fr)_auto] 2xl:grid-cols-[150px_minmax(520px,1fr)_auto]">
            <FilterSelect
              label={t('answerCatalog.structured.mode', '모드')}
              value={draftFilters.mode}
              onValueChange={(value) => updateFilter('mode', value)}
              items={[['all', t('common.all', '전체')], ...modeOptions.map((row) => [row.key, modeLabel(row.key, t)] as const)]}
            />
            <FilterInput
              label={t('answerCatalog.detailedAnalytics.search', '검색어')}
              value={draftFilters.search}
              onChange={(value) => updateFilter('search', value)}
              placeholder={t('answerCatalog.analytics.search', '질문, 답변, 소스, 조회 방식 검색...')}
            />
            <div className="flex items-end justify-end gap-2">
              <Button type="button" variant="outline" size="sm" onClick={resetFilters}>
                <RotateCcwIcon className="h-4 w-4" />
                {t('answerCatalog.detailedAnalytics.resetFilters', '조건 초기화')}
              </Button>
              <Button type="submit" size="sm" disabled={isLoading}>
                <SearchIcon className="h-4 w-4" />
                {t('answerCatalog.detailedAnalytics.applyFilters', '조회')}
              </Button>
            </div>
          </div>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <div className="text-xs text-muted-foreground">
            {t('answerCatalog.detailedAnalytics.filterBasis', '{{from}}부터 {{to}}까지, 현재 조건 이벤트 {{count}}건 기준', {
              from: appliedFilters.dateFrom || '-',
              to: appliedFilters.dateTo || '-',
              count: eventStats.total_events.toLocaleString(),
            })}
            {hasPendingFilters && (
              <span className="ml-2 font-medium text-amber-700">
                {t('answerCatalog.detailedAnalytics.pendingFilters', '변경된 조건은 조회 전까지 적용되지 않습니다.')}
              </span>
            )}
          </div>
        </div>
      </form>

      <div className="grid gap-3 md:grid-cols-4">
        <RatioCard
          title={t('answerCatalog.detailedAnalytics.matchRate', '매칭률')}
          value={`${matchRate}%`}
          detail={t('answerCatalog.detailedAnalytics.matchRateDetail', '{{matched}} / {{total}}건', {
            matched: matchCount.toLocaleString(),
            total: eventStats.total_events.toLocaleString(),
          })}
          onClick={() => selectMatchStatus('matched', t('answerCatalog.detailedAnalytics.matched', '매칭 성공'), matchCount)}
        />
        <RatioCard
          title={t('answerCatalog.analytics.noMatch', '매칭 없음')}
          value={`${noMatchRate}%`}
          detail={t('answerCatalog.detailedAnalytics.noMatchDetail', '{{count}}건', { count: eventStats.no_match.toLocaleString() })}
          tone="warning"
          onClick={() => selectMatchStatus('no_match', t('answerCatalog.analytics.noMatch', '매칭 없음'), eventStats.no_match)}
        />
        <RatioCard
          title={t('answerCatalog.analytics.avgLatency', '평균 응답 시간')}
          value={`${eventStats.avg_latency_ms.toLocaleString()}ms`}
          detail={t('answerCatalog.detailedAnalytics.latencyDetail', '현재 조건 기준')}
        />
        <RatioCard
          title={t('answerCatalog.detailedAnalytics.llmRate', 'LLM 선택 비율')}
          value={`${llmRate}%`}
          detail={t('answerCatalog.detailedAnalytics.llmRateDetail', '{{count}} / {{total}}건', {
            count: llmCount.toLocaleString(),
            total: eventStats.total_events.toLocaleString(),
          })}
          onClick={() => selectReport('mode', { key: 'llm_rerank', label: modeLabel('llm_rerank', t), count: llmCount })}
        />
      </div>

      <Tabs value={view} onValueChange={(value) => { setView(value as AnalysisView); setSelectedReport(null); setPage(1) }} className="flex min-h-0 flex-1 flex-col gap-3">
        <TabsList className="h-auto flex-wrap justify-start">
          <TabsTrigger value="overview">{t('answerCatalog.detailedAnalytics.views.overview', '개요')}</TabsTrigger>
          <TabsTrigger value="answers">{t('answerCatalog.detailedAnalytics.views.answers', '답변별')}</TabsTrigger>
          <TabsTrigger value="queries">{t('answerCatalog.detailedAnalytics.views.queries', '질문별')}</TabsTrigger>
          <TabsTrigger value="sources">{t('answerCatalog.detailedAnalytics.views.sources', '소스별')}</TabsTrigger>
          <TabsTrigger value="modes">{t('answerCatalog.detailedAnalytics.views.modes', '조회 방식')}</TabsTrigger>
          <TabsTrigger value="time">{t('answerCatalog.detailedAnalytics.views.time', '시간대')}</TabsTrigger>
          <TabsTrigger value="failures">{t('answerCatalog.detailedAnalytics.views.failures', '실패 분석')}</TabsTrigger>
        </TabsList>

        <div className="grid min-h-0 flex-1 gap-4 xl:grid-cols-[minmax(460px,0.85fr)_minmax(0,1.4fr)]">
          <div className="min-h-0 overflow-auto rounded-md border bg-card p-3">
            <TabsContent value="overview" className="mt-0 h-auto space-y-3">
              <OverviewPanel
                stats={eventStats}
                totalLookupEvents={totalLookupEvents}
                onSelect={selectReport}
                onMatchStatusSelect={selectMatchStatus}
              />
            </TabsContent>
            <TabsContent value="answers" className="mt-0 h-auto">
              <GroupTable
                kind="selected_answer"
                title={t('answerCatalog.analytics.topAnswers', '상위 선택 답변')}
                description={t('answerCatalog.detailedAnalytics.answerViewDesc', '답변별 선택 수와 매칭 실패 비중을 확인합니다.')}
                rows={eventStats.selected_answers}
                selectedReport={selectedReport}
                onSelect={selectReport}
              />
            </TabsContent>
            <TabsContent value="queries" className="mt-0 h-auto">
              <GroupTable
                kind="query"
                title={t('answerCatalog.analytics.topQueries', '상위 질문')}
                description={t('answerCatalog.detailedAnalytics.queryViewDesc', '동일 질문 반복, 급증 질문, 실패 질문을 추적하기 위한 기준입니다.')}
                rows={eventStats.queries}
                selectedReport={selectedReport}
                onSelect={selectReport}
              />
            </TabsContent>
            <TabsContent value="sources" className="mt-0 h-auto">
              <GroupTable
                kind="source"
                title={t('answerCatalog.analytics.sourceGroups', '소스별 현황')}
                description={t('answerCatalog.detailedAnalytics.sourceViewDesc', 'Excel, JSON, CSV, DB, URL 등 원천 데이터별 조회 품질을 확인합니다.')}
                rows={eventStats.sources}
                selectedReport={selectedReport}
                onSelect={selectReport}
              />
            </TabsContent>
            <TabsContent value="modes" className="mt-0 h-auto">
              <GroupTable
                kind="mode"
                title={t('answerCatalog.analytics.modeGroups', '조회 방식별 현황')}
                description={t('answerCatalog.detailedAnalytics.modeViewDesc', '키워드, 벡터, LLM ID 선택 방식의 사용량과 결과를 비교합니다.')}
                rows={eventStats.modes}
                selectedReport={selectedReport}
                onSelect={selectReport}
              />
            </TabsContent>
            <TabsContent value="time" className="mt-0 h-auto space-y-4">
              <GroupTable
                kind="date"
                title={t('answerCatalog.analytics.dailyGroups', '일자별 현황')}
                description={t('answerCatalog.analytics.dailyGroupsDesc', '이벤트가 저장된 create_time을 {{timezone}} 기준 날짜로 묶습니다.', { timezone: eventStats.timezone || timezoneName })}
                rows={eventStats.dates}
                selectedReport={selectedReport}
                onSelect={selectReport}
              />
              <GroupTable
                kind="hour"
                title={t('answerCatalog.analytics.hourlyGroups', '시간대별 현황')}
                description={t('answerCatalog.analytics.hourlyGroupsDesc', '이벤트가 저장된 create_time을 {{timezone}} 기준 시간대로 묶습니다.', { timezone: eventStats.timezone || timezoneName })}
                rows={eventStats.hours}
                selectedReport={selectedReport}
                onSelect={selectReport}
              />
            </TabsContent>
            <TabsContent value="failures" className="mt-0 h-auto space-y-3">
              <FailurePanel
                noMatchCount={eventStats.no_match}
                total={eventStats.total_events}
                queries={eventStats.queries}
                selectedReport={selectedReport}
                onSelect={selectReport}
                onMatchStatusSelect={selectMatchStatus}
              />
            </TabsContent>
          </div>

          <EventListPanel
            title={activeListTitle}
            description={selectedReport
              ? t('answerCatalog.analytics.drilldownDesc', '{{count}}건 중 조건에 맞는 이벤트를 페이지 단위로 조회합니다.', { count: selectedReport.count })
              : t('answerCatalog.detailedAnalytics.eventListDesc', '현재 조회 조건과 선택한 분석 관점에 맞는 이벤트 목록입니다.')}
            events={events}
            answerById={answerById}
            page={page}
            pageSize={pageSize}
            totalPages={totalPages}
            totalEvents={totalEvents}
            isLoading={isLoading}
            onPageChange={setPage}
            onPageSizeChange={(value) => { setPageSize(value); setPage(1) }}
            onSelectEvent={setSelectedEvent}
            onClearDrilldown={selectedReport ? () => { setSelectedReport(null); setPage(1) } : undefined}
          />
        </div>
      </Tabs>

      <EventDetailDialog
        event={selectedEvent}
        answerById={answerById}
        onOpenChange={(open) => {
          if (!open) setSelectedEvent(null)
        }}
      />
    </div>
  )
}

function createDefaultFilters(): AnalyticsFilters {
  const today = new Date()
  const from = new Date(today)
  from.setDate(today.getDate() - 6)
  return {
    period: '7d',
    dateFrom: toDateInputValue(from),
    dateTo: toDateInputValue(today),
    eventType: 'all',
    matchStatus: 'all',
    source: 'all',
    mode: 'all',
    minConfidence: '',
    maxLatencyMs: '',
    search: '',
  }
}

function areFiltersEqual(left: AnalyticsFilters, right: AnalyticsFilters) {
  return (Object.keys(left) as Array<keyof AnalyticsFilters>).every((key) => left[key] === right[key])
}

function applyPresetToFilters(filters: AnalyticsFilters, period: PeriodPreset): AnalyticsFilters {
  if (period === 'custom') return filters
  const today = new Date()
  const from = new Date(today)
  if (period === 'today') {
    return { ...filters, period, dateFrom: toDateInputValue(today), dateTo: toDateInputValue(today) }
  }
  from.setDate(today.getDate() - (period === '30d' ? 29 : 6))
  return { ...filters, period, dateFrom: toDateInputValue(from), dateTo: toDateInputValue(today) }
}

function toDateInputValue(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

function startOfLocalDayIso(value: string) {
  if (!value) return undefined
  const [year, month, day] = value.split('-').map(Number)
  return new Date(year, month - 1, day, 0, 0, 0, 0).toISOString()
}

function endOfLocalDayIso(value: string) {
  if (!value) return undefined
  const [year, month, day] = value.split('-').map(Number)
  return new Date(year, month - 1, day, 23, 59, 59, 999).toISOString()
}

function buildFilterParams(filters: AnalyticsFilters, timezoneName: string) {
  const params: Record<string, string | number> = { timezone: timezoneName }
  if (filters.eventType !== 'all') params.event_type = filters.eventType
  if (filters.matchStatus !== 'all') params.match_status = filters.matchStatus
  if (filters.source !== 'all') params.source = filters.source
  if (filters.mode !== 'all') params.mode = filters.mode
  if (filters.dateFrom) params.date_from = startOfLocalDayIso(filters.dateFrom) || ''
  if (filters.dateTo) params.date_to = endOfLocalDayIso(filters.dateTo) || ''
  if (filters.search.trim()) params.search = filters.search.trim()
  if (filters.minConfidence.trim()) {
    const minConfidence = Number(filters.minConfidence)
    if (Number.isFinite(minConfidence) && minConfidence >= 0) params.min_confidence = minConfidence
  }
  if (filters.maxLatencyMs.trim()) {
    const maxLatency = Number(filters.maxLatencyMs)
    if (Number.isFinite(maxLatency) && maxLatency >= 0) params.max_latency_ms = maxLatency
  }
  return params
}

function mergeFilterOptions(rows: AnswerAnalyticsGroupRow[], selectedKey: string) {
  if (!selectedKey || selectedKey === 'all' || rows.some((row) => row.key === selectedKey)) return rows
  return [{ key: selectedKey, label: selectedKey, count: 0 }, ...rows]
}

function displayGroupLabel(
  kind: DrilldownKind,
  row: AnswerAnalyticsGroupRow,
  t: ReturnType<typeof useTranslation>['t']
) {
  if (row.key === '__none__') return t('answerCatalog.analytics.noMatch', '매칭 없음')
  if (kind === 'mode') return modeLabel(row.key, t)
  if (kind === 'source' && row.key === 'manual') return t('answerCatalog.analytics.manualSource', '직접 입력')
  if (kind === 'match_status') {
    return row.key === 'no_match'
      ? t('answerCatalog.analytics.noMatch', '매칭 없음')
      : t('answerCatalog.detailedAnalytics.matched', '매칭 성공')
  }
  return row.label || row.key
}

function drilldownKindLabel(kind: DrilldownKind, t: ReturnType<typeof useTranslation>['t']) {
  if (kind === 'selected_answer') return t('answerCatalog.analytics.topAnswers', '상위 선택 답변')
  if (kind === 'query') return t('answerCatalog.analytics.topQueries', '상위 질문')
  if (kind === 'source') return t('answerCatalog.analytics.sourceGroups', '소스별 현황')
  if (kind === 'mode') return t('answerCatalog.analytics.modeGroups', '조회 방식별 현황')
  if (kind === 'date') return t('answerCatalog.analytics.dailyGroups', '일자별 현황')
  if (kind === 'hour') return t('answerCatalog.analytics.hourlyGroups', '시간대별 현황')
  return t('answerCatalog.detailedAnalytics.matchStatus', '매칭 결과')
}

function sourceLabel(answer: AnswerItem | null | undefined, t: ReturnType<typeof useTranslation>['t']) {
  if (!answer) return t('answerCatalog.analytics.noMatch', '매칭 없음')
  return String(
    answer.metadata?.source_type ||
    answer.metadata?.created_from ||
    answer.metadata?.materialization_mode ||
    t('answerCatalog.analytics.manualSource', '직접 입력')
  )
}

function modeLabel(mode: string, t: ReturnType<typeof useTranslation>['t']) {
  if (mode === 'keyword') return t('answerCatalog.analytics.modes.keyword', '키워드')
  if (mode === 'hybrid') return t('answerCatalog.analytics.modes.hybrid', '키워드+벡터')
  if (mode === 'llm_rerank') return t('answerCatalog.analytics.modes.llmRerank', 'LLM ID 선택')
  if (mode === 'fast') return t('answerCatalog.analytics.modes.fast', '빠른 선택')
  if (mode === 'balanced') return t('answerCatalog.analytics.modes.balanced', '균형')
  return mode || '-'
}

function eventTypeLabel(eventType: string, t: ReturnType<typeof useTranslation>['t']) {
  switch (eventType) {
  case 'resolve':
    return t('answerCatalog.analytics.eventTypes.resolve', '답변 선택')
  case 'search':
    return t('answerCatalog.analytics.eventTypes.search', '검색 API')
  case 'view':
    return t('answerCatalog.analytics.eventTypes.view', '조회')
  case 'feedback':
    return t('answerCatalog.analytics.eventTypes.feedback', '피드백')
  default:
    return eventType || '-'
  }
}

function FilterSelect({
  label,
  value,
  items,
  onValueChange,
}: {
  label: string
  value: string
  items: ReadonlyArray<readonly [string, string]>
  onValueChange: (value: string) => void
}) {
  return (
    <label className="min-w-0 space-y-1">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      <Select value={value} onValueChange={onValueChange}>
        <SelectTrigger className="h-9 min-w-0"><SelectValue /></SelectTrigger>
        <SelectContent>
          {items.map(([itemValue, itemLabel]) => (
            <SelectItem key={itemValue} value={itemValue}>{itemLabel}</SelectItem>
          ))}
        </SelectContent>
      </Select>
    </label>
  )
}

function FilterInput({
  label,
  value,
  onChange,
  type = 'text',
  placeholder,
}: {
  label: string
  value: string
  onChange: (value: string) => void
  type?: string
  placeholder?: string
}) {
  return (
    <label className="min-w-0 space-y-1">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      <Input
        className="h-9"
        type={type}
        value={value}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  )
}

function RatioCard({
  title,
  value,
  detail,
  tone = 'default',
  onClick,
}: {
  title: string
  value: string
  detail: string
  tone?: 'default' | 'warning'
  onClick?: () => void
}) {
  const content = (
    <>
      <div className="text-xs font-medium text-muted-foreground">{title}</div>
      <div className={cn('mt-1 text-2xl font-semibold', tone === 'warning' && 'text-orange-600')}>{value}</div>
      <div className="mt-1 text-xs text-muted-foreground">{detail}</div>
    </>
  )
  if (onClick) {
    return (
      <button type="button" onClick={onClick} className="rounded-md border p-3 text-left hover:bg-muted/40">
        {content}
      </button>
    )
  }
  return <div className="rounded-md border p-3">{content}</div>
}

function OverviewPanel({
  stats,
  totalLookupEvents,
  onSelect,
  onMatchStatusSelect,
}: {
  stats: AnswerEventStatsResponse
  totalLookupEvents: number
  onSelect: (kind: DrilldownKind, row: AnswerAnalyticsGroupRow) => void
  onMatchStatusSelect: (status: MatchStatus, label: string, count: number) => void
}) {
  const { t } = useTranslation()
  const matched = Math.max(0, stats.total_events - stats.no_match)
  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <button
          type="button"
          className="rounded-md border p-3 text-left hover:bg-muted/40"
          onClick={() => onMatchStatusSelect('matched', t('answerCatalog.detailedAnalytics.matched', '매칭 성공'), matched)}
        >
          <div className="text-xs text-muted-foreground">{t('answerCatalog.detailedAnalytics.matched', '매칭 성공')}</div>
          <div className="mt-1 text-xl font-semibold">{matched.toLocaleString()}</div>
        </button>
        <button
          type="button"
          className="rounded-md border p-3 text-left hover:bg-muted/40"
          onClick={() => onMatchStatusSelect('no_match', t('answerCatalog.analytics.noMatch', '매칭 없음'), stats.no_match)}
        >
          <div className="text-xs text-muted-foreground">{t('answerCatalog.analytics.noMatch', '매칭 없음')}</div>
          <div className="mt-1 text-xl font-semibold text-orange-600">{stats.no_match.toLocaleString()}</div>
        </button>
      </div>
      <div className="rounded-md border p-3">
        <div className="flex items-center gap-2 font-semibold">
          <BarChart3Icon className="h-4 w-4" />
          {t('answerCatalog.detailedAnalytics.overviewSummary', '조회 요약')}
        </div>
        <div className="mt-3 grid gap-2 text-sm sm:grid-cols-3">
          <div className="rounded-md bg-muted/40 p-2">
            <div className="text-xs text-muted-foreground">{t('answerCatalog.analytics.visibleEvents', '현재 조건 이벤트')}</div>
            <div className="font-semibold">{stats.total_events.toLocaleString()}</div>
          </div>
          <div className="rounded-md bg-muted/40 p-2">
            <div className="text-xs text-muted-foreground">{t('answerCatalog.analytics.lookupEvents', '누적 조회 이벤트')}</div>
            <div className="font-semibold">{totalLookupEvents.toLocaleString()}</div>
          </div>
          <div className="rounded-md bg-muted/40 p-2">
            <div className="text-xs text-muted-foreground">{t('answerCatalog.analytics.avgLatency', '평균 응답 시간')}</div>
            <div className="font-semibold">{stats.avg_latency_ms.toLocaleString()}ms</div>
          </div>
        </div>
      </div>
      <GroupTable
        kind="selected_answer"
        title={t('answerCatalog.analytics.topAnswers', '상위 선택 답변')}
        description={t('answerCatalog.detailedAnalytics.overviewTopAnswersDesc', '상위 답변을 선택하면 해당 답변 이벤트만 확인합니다.')}
        rows={stats.selected_answers.slice(0, 8)}
        selectedReport={null}
        onSelect={onSelect}
        compact
      />
      <GroupTable
        kind="query"
        title={t('answerCatalog.analytics.topQueries', '상위 질문')}
        description={t('answerCatalog.detailedAnalytics.overviewTopQueriesDesc', '반복 질문을 선택하면 해당 질문 이벤트만 확인합니다.')}
        rows={stats.queries.slice(0, 8)}
        selectedReport={null}
        onSelect={onSelect}
        compact
      />
    </div>
  )
}

function FailurePanel({
  noMatchCount,
  total,
  queries,
  selectedReport,
  onSelect,
  onMatchStatusSelect,
}: {
  noMatchCount: number
  total: number
  queries: AnswerAnalyticsGroupRow[]
  selectedReport: DrilldownFilter | null
  onSelect: (kind: DrilldownKind, row: AnswerAnalyticsGroupRow) => void
  onMatchStatusSelect: (status: MatchStatus, label: string, count: number) => void
}) {
  const { t } = useTranslation()
  const rate = total ? Math.round((noMatchCount / total) * 1000) / 10 : 0
  return (
    <div className="space-y-4">
      <button
        type="button"
        className={cn(
          'flex w-full items-center justify-between gap-3 rounded-md border p-3 text-left hover:bg-muted/40',
          selectedReport?.kind === 'match_status' && selectedReport.key === 'no_match' && 'border-primary bg-primary/5'
        )}
        onClick={() => onMatchStatusSelect('no_match', t('answerCatalog.analytics.noMatch', '매칭 없음'), noMatchCount)}
      >
        <div className="flex items-start gap-3">
          <AlertTriangleIcon className="mt-0.5 h-5 w-5 text-orange-500" />
          <div>
            <div className="font-semibold">{t('answerCatalog.detailedAnalytics.noMatchEvents', '매칭 실패 이벤트')}</div>
            <div className="mt-1 text-xs text-muted-foreground">
              {t('answerCatalog.detailedAnalytics.noMatchDetailWithRate', '{{count}}건, {{rate}}%', {
                count: noMatchCount.toLocaleString(),
                rate,
              })}
            </div>
          </div>
        </div>
        <Badge variant="outline">{noMatchCount.toLocaleString()}</Badge>
      </button>
      <GroupTable
        kind="query"
        title={t('answerCatalog.detailedAnalytics.failureQueries', '검토할 질문')}
        description={t('answerCatalog.detailedAnalytics.failureQueriesDesc', '반복적으로 들어온 질문을 선택해 실제 선택 결과와 후보 점수를 확인합니다.')}
        rows={queries}
        selectedReport={selectedReport}
        onSelect={onSelect}
      />
    </div>
  )
}

function GroupTable({
  kind,
  title,
  description,
  rows,
  selectedReport,
  onSelect,
  compact = false,
}: {
  kind: DrilldownKind
  title: string
  description: string
  rows: AnswerAnalyticsGroupRow[]
  selectedReport: DrilldownFilter | null
  onSelect: (kind: DrilldownKind, row: AnswerAnalyticsGroupRow) => void
  compact?: boolean
}) {
  const { t } = useTranslation()
  const typedKind = kind
  const max = Math.max(...rows.map((row) => row.count), 1)
  return (
    <div className="rounded-md border">
      <div className="border-b p-3">
        <div className="font-semibold">{title}</div>
        <div className="mt-1 text-xs text-muted-foreground">{description}</div>
      </div>
      {rows.length === 0 ? (
        <div className="p-4 text-sm text-muted-foreground">-</div>
      ) : (
        <div className="divide-y">
          {rows.map((row) => {
            const selected = selectedReport?.kind === typedKind && selectedReport.key === row.key
            const label = displayGroupLabel(typedKind, row, t)
            return (
              <button
                type="button"
                key={`${typedKind}:${row.key}`}
                className={cn('w-full p-3 text-left hover:bg-muted/40', selected && 'bg-primary/5')}
                onClick={() => onSelect(typedKind, row)}
              >
                <div className="flex items-center justify-between gap-3">
                  <span className={cn('min-w-0 text-sm font-medium', compact ? 'line-clamp-1' : 'line-clamp-2')}>{label}</span>
                  <Badge variant="outline">{row.count.toLocaleString()}</Badge>
                </div>
                <div className="mt-2 h-1.5 rounded-full bg-muted">
                  <div className="h-1.5 rounded-full bg-primary/70" style={{ width: `${Math.max(4, (row.count / max) * 100)}%` }} />
                </div>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

function EventListPanel({
  title,
  description,
  events,
  answerById,
  page,
  pageSize,
  totalPages,
  totalEvents,
  isLoading,
  onPageChange,
  onPageSizeChange,
  onSelectEvent,
  onClearDrilldown,
}: {
  title: string
  description: string
  events: AnswerEvent[]
  answerById: Record<string, AnswerItem>
  page: number
  pageSize: number
  totalPages: number
  totalEvents: number
  isLoading: boolean
  onPageChange: (page: number) => void
  onPageSizeChange: (pageSize: number) => void
  onSelectEvent: (event: AnswerEvent) => void
  onClearDrilldown?: () => void
}) {
  const { t } = useTranslation()
  return (
    <div className="flex min-h-0 flex-col rounded-md border bg-card">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b p-3">
        <div>
          <div className="font-semibold">{title}</div>
          <div className="mt-1 text-xs text-muted-foreground">{description}</div>
        </div>
        {onClearDrilldown && (
          <Button variant="outline" size="sm" onClick={onClearDrilldown}>
            {t('answerCatalog.analytics.clearDrilldown', '전체 보기')}
          </Button>
        )}
      </div>
      <div className="hidden border-b bg-muted/30 p-3 text-xs font-medium text-muted-foreground 2xl:grid 2xl:grid-cols-[minmax(240px,1.4fr)_minmax(180px,1fr)_110px_130px_170px]">
        <div>{t('answerCatalog.test.query', '사용자 질문')}</div>
        <div>{t('answerCatalog.test.selected', '선택된 답변')}</div>
        <div>{t('answerCatalog.analytics.eventType', '기록 유형')}</div>
        <div>{t('answerCatalog.structured.mode', '모드')}</div>
        <div>{t('common.createdAt', '생성일')}</div>
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        {events.length === 0 ? (
          <div className="flex items-center gap-2 p-4 text-sm text-muted-foreground">
            <SearchXIcon className="h-4 w-4" />
            {t('answerCatalog.analytics.noEvents', '기록된 이벤트가 없습니다.')}
          </div>
        ) : (
          <div className="divide-y">
            {events.map((event) => {
              const selectedAnswer = event.selected_answer_id ? answerById[event.selected_answer_id] : null
              const highestCandidateScore = event.candidate_ids.reduce(
                (highest, candidateId) => Math.max(highest, Number(event.scores?.[candidateId] || 0)),
                0
              )
              return (
                <button
                  key={event.event_id}
                  type="button"
                  className="grid w-full grid-cols-1 gap-3 p-3 text-left hover:bg-muted/40 sm:grid-cols-2 2xl:grid-cols-[minmax(240px,1.4fr)_minmax(180px,1fr)_110px_130px_170px] 2xl:items-center"
                  onClick={() => onSelectEvent(event)}
                >
                  <div className="min-w-0 sm:col-span-2 2xl:col-span-1">
                    <div className="mb-1 text-[11px] font-medium text-muted-foreground 2xl:hidden">
                      {t('answerCatalog.test.query', '사용자 질문')}
                    </div>
                    <div className="line-clamp-2 break-words text-sm font-medium">{event.query || '-'}</div>
                    {event.candidate_ids.length > 0 && (
                      <div className="mt-1 flex min-w-0 items-center gap-1.5 truncate text-xs text-muted-foreground">
                        <span>{t('answerCatalog.analytics.candidateCount', '후보 수')} {event.candidate_ids.length}</span>
                        <span aria-hidden="true">·</span>
                        <span>
                          {t('answerCatalog.analytics.highestCandidateScore', '최고 점수')} {highestCandidateScore.toFixed(2)}
                        </span>
                      </div>
                    )}
                  </div>
                  <div className="min-w-0">
                    <div className="mb-1 text-[11px] font-medium text-muted-foreground 2xl:hidden">
                      {t('answerCatalog.test.selected', '선택된 답변')}
                    </div>
                    <div className="line-clamp-2 break-words text-sm">
                      {selectedAnswer?.title || event.selected_answer_id || t('answerCatalog.analytics.noMatch', '매칭 없음')}
                    </div>
                    {event.selected_answer_id && <div className="mt-1 truncate font-mono text-xs text-muted-foreground">{event.selected_answer_id}</div>}
                  </div>
                  <div className="min-w-0">
                    <div className="mb-1 text-[11px] font-medium text-muted-foreground 2xl:hidden">
                      {t('answerCatalog.analytics.eventType', '기록 유형')}
                    </div>
                    <Badge variant="outline">{eventTypeLabel(event.event_type, t)}</Badge>
                  </div>
                  <div className="min-w-0">
                    <div className="mb-1 text-[11px] font-medium text-muted-foreground 2xl:hidden">
                      {t('answerCatalog.structured.mode', '모드')}
                    </div>
                    <div className="truncate text-sm text-muted-foreground">{modeLabel(String(event.metadata?.mode || '-'), t)}</div>
                  </div>
                  <div className="min-w-0 text-xs text-muted-foreground">
                    <div className="mb-1 text-[11px] font-medium 2xl:hidden">
                      {t('common.createdAt', '생성일')}
                    </div>
                    {event.create_time ? new Date(event.create_time).toLocaleString() : '-'}
                  </div>
                </button>
              )
            })}
          </div>
        )}
      </div>
      <div className="border-t p-3">
        <PaginationControls
          currentPage={page}
          totalPages={totalPages}
          pageSize={pageSize}
          totalCount={totalEvents}
          onPageChange={onPageChange}
          onPageSizeChange={onPageSizeChange}
          pageSizeOptions={EVENT_PAGE_SIZE_OPTIONS}
          isLoading={isLoading}
        />
      </div>
    </div>
  )
}

function Metric({ label, value, suffix }: { label: string; value: number; suffix?: string }) {
  return (
    <div className="rounded-md border p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 text-2xl font-semibold">
        {value.toLocaleString()}{suffix ? <span className="ml-1 text-sm text-muted-foreground">{suffix}</span> : null}
      </div>
    </div>
  )
}

function formatScorePercent(score: number) {
  return `${Math.round(Math.max(0, score) * 1000) / 10}%`
}

function scoreTone(score: number, t: ReturnType<typeof useTranslation>['t']) {
  if (score >= 0.8) return t('answerCatalog.analytics.scoreTones.strong', '매우 높음')
  if (score >= 0.5) return t('answerCatalog.analytics.scoreTones.good', '높음')
  if (score >= 0.2) return t('answerCatalog.analytics.scoreTones.medium', '보통')
  return t('answerCatalog.analytics.scoreTones.low', '낮음')
}

function scoreDetailLabel(key: string, t: ReturnType<typeof useTranslation>['t']) {
  const labels: Record<string, string> = {
    keyword_score: t('answerCatalog.analytics.scoreDetails.keywordScore', '키워드 종합'),
    vector_score: t('answerCatalog.analytics.scoreDetails.vectorScore', '의미 유사도'),
    hybrid_score: t('answerCatalog.analytics.scoreDetails.hybridScore', '혼합 점수'),
    title_exact: t('answerCatalog.analytics.scoreDetails.titleExact', '제목 완전 일치'),
    title_overlap: t('answerCatalog.analytics.scoreDetails.titleOverlap', '제목 단어 일치'),
    summary_overlap: t('answerCatalog.analytics.scoreDetails.summaryOverlap', '요약 단어 일치'),
    body_overlap: t('answerCatalog.analytics.scoreDetails.bodyOverlap', '본문 단어 일치'),
    guidance_question: t('answerCatalog.analytics.scoreDetails.guidanceQuestion', '대표 질문 일치'),
    guidance_keyword: t('answerCatalog.analytics.scoreDetails.guidanceKeyword', '등록 키워드 일치'),
    guidance_note: t('answerCatalog.analytics.scoreDetails.guidanceNote', '운영 메모 일치'),
    metadata_overlap: t('answerCatalog.analytics.scoreDetails.metadataOverlap', '분류/출처 일치'),
    tag_overlap: t('answerCatalog.analytics.scoreDetails.tagOverlap', '태그 일치'),
    priority_boost: t('answerCatalog.analytics.scoreDetails.priorityBoost', '우선순위 보정'),
    negative_penalty: t('answerCatalog.analytics.scoreDetails.negativePenalty', '제외어 감점'),
  }
  return labels[key] || key.replaceAll('_', ' ')
}

function topScoreReasons(details: Record<string, number>, t: ReturnType<typeof useTranslation>['t']) {
  return Object.entries(details)
    .filter(([, value]) => Number(value) > 0)
    .sort(([, left], [, right]) => Number(right) - Number(left))
    .slice(0, 3)
    .map(([key, value]) => ({ key, label: scoreDetailLabel(key, t), value: Number(value) }))
}

function candidateReason(details: Record<string, number>, score: number, t: ReturnType<typeof useTranslation>['t']) {
  const strongReasons = topScoreReasons(details, t)
  if (strongReasons.length === 0) {
    return score > 0
      ? t('answerCatalog.analytics.reason.scoreOnly', '세부 근거는 없지만 최종 점수가 계산된 후보입니다.')
      : t('answerCatalog.analytics.reason.noSignal', '질문과 직접 연결되는 근거가 거의 없습니다.')
  }
  const topKeys = new Set(strongReasons.map((reason) => reason.key))
  if (topKeys.has('title_exact') || topKeys.has('title_overlap')) {
    return t('answerCatalog.analytics.reason.title', '질문이 답변 제목과 강하게 연결되어 후보로 올라왔습니다.')
  }
  if (topKeys.has('guidance_question') || topKeys.has('guidance_keyword') || topKeys.has('keyword_score')) {
    return t('answerCatalog.analytics.reason.guidance', '등록된 대표 질문이나 키워드가 사용자 질문과 잘 맞았습니다.')
  }
  if (topKeys.has('vector_score') || topKeys.has('hybrid_score')) {
    return t('answerCatalog.analytics.reason.vector', '표현은 다르지만 의미 유사도가 높아 후보로 보강되었습니다.')
  }
  if (topKeys.has('metadata_overlap') || topKeys.has('tag_overlap')) {
    return t('answerCatalog.analytics.reason.metadata', '태그나 분류 정보가 질문과 일부 겹쳤습니다.')
  }
  return t('answerCatalog.analytics.reason.partial', '본문이나 요약의 일부 단어가 질문과 겹쳐 후보가 되었습니다.')
}

function CandidateEvidence({
  candidateId,
  rank,
  answer,
  details,
  isSelected,
  score,
}: {
  candidateId: string
  rank: number
  answer: AnswerItem | undefined
  details: Record<string, number>
  isSelected: boolean
  score: number
}) {
  const { t } = useTranslation()
  const topReasons = topScoreReasons(details, t)
  const allDetails = Object.entries(details)
    .filter(([, value]) => Number.isFinite(Number(value)))
    .sort(([, left], [, right]) => Number(right) - Number(left))
  const visibleTags = answer?.tags.slice(0, 2) || []
  const hiddenTagCount = Math.max(0, (answer?.tags.length || 0) - visibleTags.length)

  return (
    <div className={cn('p-4', isSelected && 'bg-primary/5')}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={isSelected ? 'default' : 'outline'}>
              {isSelected
                ? t('answerCatalog.analytics.selectedCandidate', '선택됨')
                : t('answerCatalog.analytics.candidateRank', '{{rank}}순위', { rank })}
            </Badge>
            <div className="min-w-0 truncate text-base font-semibold">{answer?.title || candidateId}</div>
          </div>
          <div className="mt-1 font-mono text-xs text-muted-foreground">{candidateId}</div>
          <div className="mt-2 text-sm text-muted-foreground">
            {candidateReason(details, score, t)}
          </div>
          {answer && (
            <div className="mt-2 flex flex-wrap gap-1">
              <Badge variant="outline">{sourceLabel(answer, t)}</Badge>
              {visibleTags.map((tag) => <Badge key={tag} variant="outline">{tag}</Badge>)}
              {hiddenTagCount > 0 && <Badge variant="outline">+{hiddenTagCount}</Badge>}
            </div>
          )}
        </div>
        <div className="min-w-[120px] text-right">
          <div className="text-xs text-muted-foreground">{t('answerCatalog.analytics.finalScore', '최종 점수')}</div>
          <div className="text-2xl font-semibold">{formatScorePercent(score)}</div>
          <Badge variant="outline">{scoreTone(score, t)}</Badge>
        </div>
      </div>

      <div className="mt-3 h-2 rounded-full bg-muted">
        <div className="h-2 rounded-full bg-primary/70" style={{ width: `${Math.max(2, Math.min(100, score * 100))}%` }} />
      </div>

      <div className="mt-3">
        <div className="text-xs font-medium text-muted-foreground">{t('answerCatalog.analytics.mainEvidence', '주요 근거')}</div>
        {topReasons.length === 0 ? (
          <div className="mt-2 text-sm text-muted-foreground">{t('answerCatalog.analytics.noMainEvidence', '표시할 주요 근거가 없습니다.')}</div>
        ) : (
          <div className="mt-2 grid gap-2 sm:grid-cols-3">
            {topReasons.map((reason) => (
              <div key={reason.key} className="rounded-md border bg-background p-2">
                <div className="truncate text-xs text-muted-foreground">{reason.label}</div>
                <div className="mt-1 text-sm font-semibold">{formatScorePercent(reason.value)}</div>
              </div>
            ))}
          </div>
        )}
      </div>

      {allDetails.length > 0 && (
        <details className="mt-3 rounded-md border bg-muted/20 p-3">
          <summary className="cursor-pointer text-sm font-medium">
            {t('answerCatalog.analytics.showTechnicalScores', '세부 점수 보기')}
          </summary>
          <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {allDetails.map(([key, value]) => (
              <div key={key} className="rounded-md bg-background p-2 text-xs">
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate">{scoreDetailLabel(key, t)}</span>
                  <span className="font-mono">{Number(value || 0).toFixed(3)}</span>
                </div>
              </div>
            ))}
          </div>
        </details>
      )}
    </div>
  )
}

function EventDetailDialog({
  event,
  answerById,
  onOpenChange,
}: {
  event: AnswerEvent | null
  answerById: Record<string, AnswerItem>
  onOpenChange: (open: boolean) => void
}) {
  const { t } = useTranslation()
  if (!event) return null
  const selectedAnswer = event.selected_answer_id ? answerById[event.selected_answer_id] : null
  const scoreDetails = event.metadata?.score_details && typeof event.metadata.score_details === 'object'
    ? event.metadata.score_details as Record<string, Record<string, number>>
    : {}

  return (
    <Dialog open={Boolean(event)} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[86vh] max-w-5xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t('answerCatalog.analytics.detailTitle', '이벤트 상세')}</DialogTitle>
          <DialogDescription>{event.event_id}</DialogDescription>
        </DialogHeader>

        <div className="grid gap-3 md:grid-cols-4">
          <DetailValue label={t('answerCatalog.analytics.eventType', '기록 유형')} value={eventTypeLabel(event.event_type, t)} />
          <Metric label={t('answerCatalog.analytics.confidence', '신뢰도')} value={Math.round(Number(event.selected_answer_id ? event.scores?.[event.selected_answer_id] || 0 : 0) * 100)} suffix="%" />
          <Metric label={t('answerCatalog.analytics.avgLatency', '응답 시간')} value={Number(event.metadata?.latency_ms || 0)} suffix="ms" />
          <Metric label={t('answerCatalog.analytics.candidateCount', '후보 수')} value={event.candidate_ids.length} />
        </div>

        <div className="rounded-md border p-3">
          <div className="text-xs font-medium text-muted-foreground">{t('answerCatalog.test.query', '사용자 질문')}</div>
          <div className="mt-1 whitespace-pre-wrap text-sm">{event.query || '-'}</div>
        </div>

        <div className="rounded-md border p-3">
          <div className="text-xs font-medium text-muted-foreground">{t('answerCatalog.test.selected', '선택된 답변')}</div>
          <div className="mt-1 text-sm font-semibold">
            {selectedAnswer?.title || event.selected_answer_id || t('answerCatalog.analytics.noMatch', '매칭 없음')}
          </div>
          {event.selected_answer_id && <div className="mt-1 font-mono text-xs text-muted-foreground">{event.selected_answer_id}</div>}
          {selectedAnswer && (
            <div className="mt-2 flex flex-wrap gap-1">
              <Badge variant="outline">{sourceLabel(selectedAnswer, t)}</Badge>
              {selectedAnswer.tags.slice(0, 3).map((tag) => <Badge key={tag} variant="outline">{tag}</Badge>)}
              {selectedAnswer.tags.length > 3 && <Badge variant="outline">+{selectedAnswer.tags.length - 3}</Badge>}
            </div>
          )}
        </div>

        <div className="rounded-md border">
          <div className="border-b bg-muted/30 p-3">
            <div className="text-sm font-semibold">{t('answerCatalog.analytics.candidates', '후보 답변')}</div>
            <div className="mt-1 text-xs text-muted-foreground">
              {t('answerCatalog.analytics.candidatesDesc', '최종 점수가 높은 순서입니다. 주요 근거를 먼저 보고, 필요한 경우에만 세부 점수를 펼쳐 확인하세요.')}
            </div>
          </div>
          <div className="divide-y">
            {event.candidate_ids.length === 0 ? (
              <div className="p-3 text-sm text-muted-foreground">-</div>
            ) : (
              event.candidate_ids.map((candidateId, index) => {
                const answer = answerById[candidateId]
                const details = scoreDetails[candidateId] || {}
                return (
                  <CandidateEvidence
                    key={candidateId}
                    candidateId={candidateId}
                    rank={index + 1}
                    answer={answer}
                    details={details}
                    isSelected={event.selected_answer_id === candidateId}
                    score={Number(event.scores?.[candidateId] || 0)}
                  />
                )
              })
            )}
          </div>
        </div>

        <details className="rounded-md border p-3">
          <summary className="cursor-pointer text-sm font-semibold">
            {t('answerCatalog.analytics.rawMetadata', '원본 메타데이터')}
          </summary>
          <pre className="mt-3 max-h-80 overflow-auto rounded-md bg-muted p-3 text-xs">
            {JSON.stringify(event.metadata || {}, null, 2)}
          </pre>
        </details>
      </DialogContent>
    </Dialog>
  )
}

function DetailValue({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 text-lg font-semibold">{value}</div>
    </div>
  )
}

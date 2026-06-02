import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import {
  BarChart3Icon,
  CalendarDaysIcon,
  ClockIcon,
  DatabaseIcon,
  ListFilterIcon,
  MousePointerClickIcon,
  RefreshCwIcon,
  SearchXIcon,
} from 'lucide-react'

import {
  AnswerAnalyticsGroupRow,
  AnswerEvent,
  AnswerEventStatsResponse,
  AnswerItem,
  getAnswerEventStats,
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
import { cn, localizedErrorMessage } from '@/lib/utils'
import { useWorkspaceStore } from '@/stores/workspace'

type AnalyticsEventType = 'all' | 'resolve' | 'search' | 'view' | 'feedback'
type ReportKind = 'selected_answer' | 'query' | 'source' | 'mode' | 'date' | 'hour'

type DrilldownFilter = {
  kind: ReportKind
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

export default function AnswerAnalytics() {
  const { t } = useTranslation()
  const currentWorkspaceId = useWorkspaceStore.use.currentWorkspaceId()
  const timezoneName = useMemo(() => {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Seoul'
  }, [])

  const [events, setEvents] = useState<AnswerEvent[]>([])
  const [answerById, setAnswerById] = useState<Record<string, AnswerItem>>({})
  const [eventStats, setEventStats] = useState<AnswerEventStatsResponse>(DEFAULT_EVENT_STATS)
  const [search, setSearch] = useState('')
  const [eventType, setEventType] = useState<AnalyticsEventType>('all')
  const [selectedReport, setSelectedReport] = useState<DrilldownFilter | null>(null)
  const [selectedEvent, setSelectedEvent] = useState<AnswerEvent | null>(null)
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(25)
  const [totalEvents, setTotalEvents] = useState(0)
  const [isLoading, setIsLoading] = useState(false)

  const eventFilterParams = useMemo(() => {
    const params: Record<string, string | number> = {
      page,
      page_size: pageSize,
      timezone: timezoneName,
    }
    if (eventType !== 'all') params.event_type = eventType
    if (search.trim()) params.search = search.trim()
    if (selectedReport) {
      if (selectedReport.kind === 'selected_answer') params.selected_answer_id = selectedReport.key
      if (selectedReport.kind === 'query') params.query = selectedReport.label
      if (selectedReport.kind === 'source') params.source = selectedReport.key
      if (selectedReport.kind === 'mode') params.mode = selectedReport.key
      if (selectedReport.kind === 'date') params.date = selectedReport.key
      if (selectedReport.kind === 'hour') params.hour = selectedReport.key
    }
    return params
  }, [eventType, page, pageSize, search, selectedReport, timezoneName])

  const fetchData = useCallback(async () => {
    const workspaceId = currentWorkspaceId
    setIsLoading(true)
    try {
      const statsParams = {
        event_type: eventType === 'all' ? undefined : eventType,
        search: search.trim() || undefined,
        timezone: timezoneName,
        limit: 20,
      }
      const [groupedStats, eventPage] = await Promise.all([
        getAnswerEventStats(statsParams),
        listAnswerEventsPage(eventFilterParams),
      ])
      if (workspaceId !== useWorkspaceStore.getState().currentWorkspaceId) return
      setEventStats(groupedStats)
      setEvents(eventPage.events)
      setTotalEvents(eventPage.total)
      setAnswerById(Object.fromEntries((eventPage.answers || []).map((answer) => [answer.answer_id, answer])))
    } catch (err) {
      toast.error(localizedErrorMessage(err, t))
    } finally {
      setIsLoading(false)
    }
  }, [currentWorkspaceId, eventFilterParams, eventType, search, t, timezoneName])

  useEffect(() => {
    setEvents([])
    setAnswerById({})
    setEventStats(DEFAULT_EVENT_STATS)
    setSelectedEvent(null)
    setSelectedReport(null)
    setPage(1)
  }, [currentWorkspaceId])

  useEffect(() => {
    fetchData()
  }, [fetchData])

  const reportSections = useMemo(() => {
    return [
      {
        kind: 'selected_answer' as const,
        title: t('answerCatalog.analytics.topAnswers', '상위 선택 답변'),
        description: t('answerCatalog.analytics.topAnswersDesc', '가장 자주 선택되었거나 매칭 실패로 기록된 답변입니다.'),
        icon: <MousePointerClickIcon className="h-4 w-4" />,
        rows: eventStats.selected_answers,
      },
      {
        kind: 'source' as const,
        title: t('answerCatalog.analytics.sourceGroups', '소스별 현황'),
        description: t('answerCatalog.analytics.sourceGroupsDesc', '선택된 답변의 원천 데이터 유형 기준입니다.'),
        icon: <DatabaseIcon className="h-4 w-4" />,
        rows: eventStats.sources,
      },
      {
        kind: 'mode' as const,
        title: t('answerCatalog.analytics.modeGroups', '조회 방식별 현황'),
        description: t('answerCatalog.analytics.modeGroupsDesc', '키워드, 키워드+벡터, LLM ID 선택 등 실제 조회 방식 기준입니다.'),
        icon: <ListFilterIcon className="h-4 w-4" />,
        rows: eventStats.modes,
      },
      {
        kind: 'date' as const,
        title: t('answerCatalog.analytics.dailyGroups', '일자별 현황'),
        description: t('answerCatalog.analytics.dailyGroupsDesc', '이벤트가 저장된 create_time을 {{timezone}} 기준 날짜로 묶습니다.', { timezone: eventStats.timezone || timezoneName }),
        icon: <CalendarDaysIcon className="h-4 w-4" />,
        rows: eventStats.dates,
      },
      {
        kind: 'hour' as const,
        title: t('answerCatalog.analytics.hourlyGroups', '시간대별 현황'),
        description: t('answerCatalog.analytics.hourlyGroupsDesc', '이벤트가 저장된 create_time을 {{timezone}} 기준 시간대로 묶습니다.', { timezone: eventStats.timezone || timezoneName }),
        icon: <ClockIcon className="h-4 w-4" />,
        rows: eventStats.hours,
      },
      {
        kind: 'query' as const,
        title: t('answerCatalog.analytics.topQueries', '상위 질문'),
        description: t('answerCatalog.analytics.topQueriesDesc', '동일하게 들어온 사용자 질문을 기준으로 묶습니다.'),
        icon: <BarChart3Icon className="h-4 w-4" />,
        rows: eventStats.queries,
      },
    ]
  }, [eventStats, t, timezoneName])

  const totalPages = Math.max(1, Math.ceil(totalEvents / pageSize))
  const activeReportTitle = selectedReport
    ? `${reportKindLabel(selectedReport.kind, t)}: ${selectedReport.label}`
    : t('answerCatalog.analytics.allEvents', '전체 이벤트')

  const handleReportSelect = (kind: ReportKind, row: AnswerAnalyticsGroupRow) => {
    setSelectedReport({
      kind,
      key: row.key,
      label: displayGroupLabel(kind, row, t),
      count: row.count,
    })
    setPage(1)
  }

  const handleSearchChange = (value: string) => {
    setSearch(value)
    setSelectedReport(null)
    setPage(1)
  }

  const handleEventTypeChange = (value: string) => {
    setEventType(value as AnalyticsEventType)
    setSelectedReport(null)
    setPage(1)
  }

  const handlePageSizeChange = (value: number) => {
    setPageSize(value)
    setPage(1)
  }

  return (
    <div className="flex h-full flex-col gap-4 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <div className="rounded-md border bg-muted/40 p-2">
            <BarChart3Icon className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-2xl font-bold">{t('answerCatalog.analytics.title', '답변 분석')}</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {t('answerCatalog.analytics.description', '답변 사용량, 매칭 실패, 조회 방식, 소스별 현황을 확인합니다.')}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              {t('answerCatalog.analytics.timeBasis', '일자와 시간대는 이벤트 저장 시각(create_time)을 {{timezone}} 기준으로 변환해 집계합니다.', { timezone: eventStats.timezone || timezoneName })}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <AnswerHelpButton />
          <Button variant="outline" size="sm" onClick={fetchData} disabled={isLoading}>
            <RefreshCwIcon className={isLoading ? 'h-4 w-4 animate-spin' : 'h-4 w-4'} />
            {t('common.refresh', '새로고침')}
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 rounded-md border p-3">
        <Input
          className="min-w-64 flex-1"
          value={search}
          onChange={(event) => handleSearchChange(event.target.value)}
          placeholder={t('answerCatalog.analytics.search', '질문, 답변, 소스, 조회 방식 검색...')}
        />
        <Select value={eventType} onValueChange={handleEventTypeChange}>
          <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t('common.all', '전체')}</SelectItem>
            <SelectItem value="resolve">{t('answerCatalog.analytics.eventTypes.resolve', '답변 선택')}</SelectItem>
            <SelectItem value="search">{t('answerCatalog.analytics.eventTypes.search', '검색 API')}</SelectItem>
            <SelectItem value="view">{t('answerCatalog.analytics.eventTypes.view', '조회')}</SelectItem>
            <SelectItem value="feedback">{t('answerCatalog.analytics.eventTypes.feedback', '피드백')}</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="grid min-h-0 flex-1 gap-4 xl:grid-cols-[430px_minmax(0,1fr)]">
        <div className="min-h-0 overflow-auto rounded-md border bg-card">
          <div className="border-b p-3">
            <div className="font-semibold">{t('answerCatalog.analytics.reportSummary', '현황')}</div>
            <div className="mt-1 text-xs text-muted-foreground">
              {t('answerCatalog.analytics.reportSummaryDesc', '항목을 선택하면 오른쪽에 해당 이벤트 목록이 표시됩니다.')}
            </div>
          </div>
          <div className="space-y-3 p-3">
            {reportSections.map((section) => (
              <ReportCard
                key={section.kind}
                kind={section.kind}
                title={section.title}
                description={section.description}
                icon={section.icon}
                rows={section.rows}
                selectedReport={selectedReport}
                onSelect={handleReportSelect}
              />
            ))}
          </div>
        </div>

        <div className="flex min-h-0 flex-col rounded-md border bg-card">
          <div className="flex flex-wrap items-start justify-between gap-3 border-b p-3">
            <div>
              <div className="text-sm font-semibold">{activeReportTitle}</div>
              <div className="mt-1 text-xs text-muted-foreground">
                {selectedReport
                  ? t('answerCatalog.analytics.drilldownDesc', '{{count}}건 중 조건에 맞는 이벤트를 페이지 단위로 조회합니다.', { count: selectedReport.count })
                  : t('answerCatalog.analytics.allEventsDesc', '좌측 현황을 선택하지 않은 상태의 전체 이벤트 목록입니다.')}
              </div>
            </div>
            {selectedReport && (
              <Button variant="outline" size="sm" onClick={() => { setSelectedReport(null); setPage(1) }}>
                {t('answerCatalog.analytics.clearDrilldown', '전체 보기')}
              </Button>
            )}
          </div>

          <div className="grid border-b bg-muted/30 p-3 text-xs font-medium text-muted-foreground lg:grid-cols-[minmax(0,1fr)_240px_120px_130px_170px]">
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
                  return (
                    <button
                      key={event.event_id}
                      type="button"
                      className="grid w-full gap-2 p-3 text-left hover:bg-muted/40 lg:grid-cols-[minmax(0,1fr)_240px_120px_130px_170px] lg:items-center"
                      onClick={() => setSelectedEvent(event)}
                    >
                      <div className="min-w-0">
                        <div className="truncate text-sm">{event.query || '-'}</div>
                        <div className="mt-1 flex flex-wrap gap-1">
                          {event.candidate_ids.slice(0, 4).map((candidateId) => (
                            <Badge key={candidateId} variant="outline">
                              {answerById[candidateId]?.title || candidateId}: {Number(event.scores?.[candidateId] || 0).toFixed(2)}
                            </Badge>
                          ))}
                        </div>
                      </div>
                      <div className="min-w-0">
                        <div className="truncate text-sm">
                          {selectedAnswer?.title || event.selected_answer_id || t('answerCatalog.analytics.noMatch', '매칭 없음')}
                        </div>
                        {event.selected_answer_id && <div className="mt-1 truncate font-mono text-xs text-muted-foreground">{event.selected_answer_id}</div>}
                      </div>
                      <div>
                        <Badge variant="outline">{eventTypeLabel(event.event_type, t)}</Badge>
                      </div>
                      <div className="text-sm text-muted-foreground">{modeLabel(String(event.metadata?.mode || '-'), t)}</div>
                      <div className="text-xs text-muted-foreground">
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
              onPageChange={setPage}
              onPageSizeChange={handlePageSizeChange}
              pageSizeOptions={EVENT_PAGE_SIZE_OPTIONS}
              isLoading={isLoading}
            />
          </div>
        </div>
      </div>

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

function displayGroupLabel(
  kind: ReportKind,
  row: AnswerAnalyticsGroupRow,
  t: ReturnType<typeof useTranslation>['t']
) {
  if (row.key === '__none__') return t('answerCatalog.analytics.noMatch', '매칭 없음')
  if (kind === 'mode') return modeLabel(row.key, t)
  if (kind === 'source' && row.key === 'manual') return t('answerCatalog.analytics.manualSource', '직접 입력')
  return row.label || row.key
}

function reportKindLabel(kind: ReportKind, t: ReturnType<typeof useTranslation>['t']) {
  if (kind === 'selected_answer') return t('answerCatalog.analytics.topAnswers', '상위 선택 답변')
  if (kind === 'query') return t('answerCatalog.analytics.topQueries', '상위 질문')
  if (kind === 'source') return t('answerCatalog.analytics.sourceGroups', '소스별 현황')
  if (kind === 'mode') return t('answerCatalog.analytics.modeGroups', '조회 방식별 현황')
  if (kind === 'date') return t('answerCatalog.analytics.dailyGroups', '일자별 현황')
  return t('answerCatalog.analytics.hourlyGroups', '시간대별 현황')
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

function ReportCard({
  kind,
  title,
  description,
  icon,
  rows,
  selectedReport,
  onSelect,
}: {
  kind: ReportKind
  title: string
  description: string
  icon: React.ReactNode
  rows: AnswerAnalyticsGroupRow[]
  selectedReport: DrilldownFilter | null
  onSelect: (kind: ReportKind, row: AnswerAnalyticsGroupRow) => void
}) {
  const { t } = useTranslation()
  const max = Math.max(...rows.map((row) => row.count), 1)
  return (
    <div className="rounded-md border p-3">
      <div className="mb-1 flex items-center gap-2 font-semibold">
        {icon}
        {title}
      </div>
      <div className="mb-3 text-xs text-muted-foreground">{description}</div>
      {rows.length === 0 ? (
        <div className="text-sm text-muted-foreground">-</div>
      ) : (
        <div className="space-y-1.5">
          {rows.map((row) => {
            const selected = selectedReport?.kind === kind && selectedReport.key === row.key
            const label = displayGroupLabel(kind, row, t)
            return (
              <button
                key={`${kind}:${row.key}`}
                type="button"
                className={cn(
                  'w-full rounded-md border p-2 text-left transition hover:bg-muted/60',
                  selected && 'border-primary bg-primary/5'
                )}
                onClick={() => onSelect(kind, row)}
              >
                <div className="flex items-center justify-between gap-2 text-sm">
                  <span className="line-clamp-2 min-w-0">{label}</span>
                  <Badge variant="outline">{row.count.toLocaleString()}</Badge>
                </div>
                <div className="mt-2 h-1.5 rounded-full bg-muted">
                  <div className="h-1.5 rounded-full bg-primary/70" style={{ width: `${Math.max(6, (row.count / max) * 100)}%` }} />
                </div>
              </button>
            )
          })}
        </div>
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
          <DialogDescription>
            {event.event_id}
          </DialogDescription>
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
          {event.selected_answer_id && (
            <div className="mt-1 font-mono text-xs text-muted-foreground">{event.selected_answer_id}</div>
          )}
          {selectedAnswer && (
            <div className="mt-2 flex flex-wrap gap-1">
              <Badge variant="outline">{sourceLabel(selectedAnswer, t)}</Badge>
              {selectedAnswer.tags.slice(0, 6).map((tag) => <Badge key={tag} variant="outline">{tag}</Badge>)}
            </div>
          )}
        </div>

        <div className="rounded-md border">
          <div className="border-b bg-muted/30 p-3 text-sm font-semibold">{t('answerCatalog.analytics.candidates', '후보 답변')}</div>
          <div className="divide-y">
            {event.candidate_ids.length === 0 ? (
              <div className="p-3 text-sm text-muted-foreground">-</div>
            ) : (
              event.candidate_ids.map((candidateId) => {
                const answer = answerById[candidateId]
                const details = scoreDetails[candidateId] || {}
                return (
                  <div key={candidateId} className="p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="min-w-0">
                        <div className="font-medium">{answer?.title || candidateId}</div>
                        <div className="font-mono text-xs text-muted-foreground">{candidateId}</div>
                      </div>
                      <Badge variant="outline">{Number(event.scores?.[candidateId] || 0).toFixed(4)}</Badge>
                    </div>
                    {Object.keys(details).length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-1">
                        {Object.entries(details).map(([key, value]) => (
                          <Badge key={key} variant="outline">
                            {key}: {Number(value || 0).toFixed(3)}
                          </Badge>
                        ))}
                      </div>
                    )}
                  </div>
                )
              })
            )}
          </div>
        </div>

        <div className="rounded-md border p-3">
          <div className="mb-2 text-sm font-semibold">{t('answerCatalog.analytics.rawMetadata', '원본 메타데이터')}</div>
          <pre className="max-h-80 overflow-auto rounded-md bg-muted p-3 text-xs">
            {JSON.stringify(event.metadata || {}, null, 2)}
          </pre>
        </div>
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

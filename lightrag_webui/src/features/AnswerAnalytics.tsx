import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { BarChart3Icon, RefreshCwIcon } from 'lucide-react'

import { AnswerEvent, getAnswerStats, listAnswerEvents, listAnswers } from '@/api/lightrag'
import AnswerHelpButton from '@/components/answers/AnswerHelpButton'
import Badge from '@/components/ui/Badge'
import Button from '@/components/ui/Button'
import Input from '@/components/ui/Input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/Select'
import { localizedErrorMessage } from '@/lib/utils'

export default function AnswerAnalytics() {
  const { t } = useTranslation()
  const [events, setEvents] = useState<AnswerEvent[]>([])
  const [answerTitles, setAnswerTitles] = useState<Record<string, string>>({})
  const [stats, setStats] = useState<{ answers?: Record<string, number>; events?: Record<string, number> }>({})
  const [search, setSearch] = useState('')
  const [eventType, setEventType] = useState('resolve')
  const [isLoading, setIsLoading] = useState(false)

  const fetchData = useCallback(async () => {
    setIsLoading(true)
    try {
      const [summary, eventRows, answers] = await Promise.all([
        getAnswerStats(),
        listAnswerEvents({ event_type: eventType, limit: 100 }),
        listAnswers({ status: 'all', page: 1, page_size: 100 }),
      ])
      setStats(summary)
      setEvents(eventRows)
      setAnswerTitles(Object.fromEntries(answers.answers.map((answer) => [answer.answer_id, answer.title])))
    } catch (err) {
      toast.error(localizedErrorMessage(err, t))
    } finally {
      setIsLoading(false)
    }
  }, [eventType])

  useEffect(() => {
    fetchData()
  }, [fetchData])

  const filteredEvents = useMemo(() => {
    const term = search.trim().toLowerCase()
    return events.filter((event) =>
      !term ||
      event.query?.toLowerCase().includes(term) ||
      event.selected_answer_id?.toLowerCase().includes(term) ||
      (event.selected_answer_id && answerTitles[event.selected_answer_id]?.toLowerCase().includes(term))
    )
  }, [answerTitles, events, search])

  const selectedCounts = useMemo(() => {
    const counts = new Map<string, number>()
    filteredEvents.forEach((event) => {
      const key = event.selected_answer_id || '__none__'
      counts.set(key, (counts.get(key) || 0) + 1)
    })
    return Array.from(counts.entries())
      .map(([answerId, count]) => ({ answerId, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 8)
  }, [filteredEvents])

  const noMatch = filteredEvents.filter((event) => !event.selected_answer_id).length
  const avgLatency = useMemo(() => {
    const values = filteredEvents
      .map((event) => Number(event.metadata?.latency_ms))
      .filter((value) => Number.isFinite(value) && value >= 0)
    if (values.length === 0) return 0
    return Math.round(values.reduce((sum, value) => sum + value, 0) / values.length)
  }, [filteredEvents])

  return (
    <div className="flex h-full flex-col gap-4 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <div className="rounded-md border bg-muted/40 p-2">
            <BarChart3Icon className="h-5 w-5" />
          </div>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-2xl font-bold">{t('answerCatalog.analytics.title', 'Answer Analytics')}</h1>
              <Badge variant="outline">Phase 4 MVP</Badge>
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              {t('answerCatalog.analytics.description', 'Review answer usage, no-match queries, ambiguous matches, feedback, and stale answer candidates.')}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <AnswerHelpButton />
          <Button variant="outline" size="sm" onClick={fetchData} disabled={isLoading}>
            <RefreshCwIcon className={isLoading ? 'h-4 w-4 animate-spin' : 'h-4 w-4'} />
            {t('common.refresh', 'Refresh')}
          </Button>
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-4">
        <Metric label={t('answerCatalog.library.total', 'Total')} value={Number(stats.answers?.total || 0)} />
        <Metric label={t('answerCatalog.analytics.resolveEvents', 'Resolve Events')} value={Number(stats.events?.resolves || filteredEvents.length)} />
        <Metric label={t('answerCatalog.analytics.noMatch', 'No Match')} value={noMatch} />
        <Metric label={t('answerCatalog.analytics.avgLatency', 'Avg Latency')} value={avgLatency} suffix="ms" />
      </div>

      <div className="flex flex-wrap items-center gap-2 rounded-md border p-3">
        <Input
          className="min-w-64 flex-1"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder={t('answerCatalog.analytics.search', 'Search query or answer...')}
        />
        <Select value={eventType} onValueChange={setEventType}>
          <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="resolve">resolve</SelectItem>
            <SelectItem value="all">{t('common.all', 'All')}</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="grid min-h-0 flex-1 gap-4 xl:grid-cols-[360px_1fr]">
        <div className="rounded-md border p-4">
          <div className="mb-3 font-semibold">{t('answerCatalog.analytics.topAnswers', 'Top Selected Answers')}</div>
          {selectedCounts.length === 0 ? (
            <div className="text-sm text-muted-foreground">{t('answerCatalog.analytics.noEvents', 'No events were recorded yet.')}</div>
          ) : (
            <div className="space-y-2">
              {selectedCounts.map((item) => (
                <div key={item.answerId} className="rounded-md border p-3">
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0 truncate text-sm font-medium">
                      {item.answerId === '__none__' ? t('answerCatalog.analytics.noMatch', 'No Match') : answerTitles[item.answerId] || item.answerId}
                    </div>
                    <Badge variant="outline">{item.count}</Badge>
                  </div>
                  {item.answerId !== '__none__' && (
                    <div className="mt-1 truncate font-mono text-xs text-muted-foreground">{item.answerId}</div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="min-h-0 overflow-auto rounded-md border">
          <div className="grid border-b bg-muted/30 p-3 text-xs font-medium text-muted-foreground lg:grid-cols-[1fr_220px_120px_130px]">
            <div>{t('answerCatalog.test.query', 'User Query')}</div>
            <div>{t('answerCatalog.test.selected', 'Selected Answer')}</div>
            <div>{t('answerCatalog.test.strategy', 'Strategy')}</div>
            <div>{t('common.createdAt', 'Created')}</div>
          </div>
          {filteredEvents.length === 0 ? (
            <div className="p-4 text-sm text-muted-foreground">{t('answerCatalog.analytics.noEvents', 'No events were recorded yet.')}</div>
          ) : (
            <div className="divide-y">
              {filteredEvents.map((event) => (
                <div key={event.event_id} className="grid gap-2 p-3 lg:grid-cols-[1fr_220px_120px_130px] lg:items-center">
                  <div className="min-w-0">
                    <div className="truncate text-sm">{event.query || '-'}</div>
                    <div className="mt-1 flex flex-wrap gap-1">
                      {event.candidate_ids.slice(0, 4).map((candidateId) => (
                        <Badge key={candidateId} variant="outline">
                          {candidateId}: {Number(event.scores?.[candidateId] || 0).toFixed(2)}
                        </Badge>
                      ))}
                    </div>
                  </div>
                  <div className="min-w-0">
                    <div className="truncate text-sm">
                      {event.selected_answer_id ? answerTitles[event.selected_answer_id] || event.selected_answer_id : t('answerCatalog.analytics.noMatch', 'No Match')}
                    </div>
                    {event.selected_answer_id && <div className="mt-1 truncate font-mono text-xs text-muted-foreground">{event.selected_answer_id}</div>}
                  </div>
                  <div className="text-sm text-muted-foreground">{event.metadata?.strategy || event.metadata?.mode || '-'}</div>
                  <div className="text-xs text-muted-foreground">
                    {event.create_time ? new Date(event.create_time).toLocaleString() : '-'}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
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

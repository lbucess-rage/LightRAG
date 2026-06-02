import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { CheckCircle2Icon, Loader2Icon, SearchIcon, XCircleIcon } from 'lucide-react'

import { AnswerResolveResponse, resolveAnswer } from '@/api/lightrag'
import AnswerHelpButton from '@/components/answers/AnswerHelpButton'
import Badge from '@/components/ui/Badge'
import Button from '@/components/ui/Button'
import Checkbox from '@/components/ui/Checkbox'
import Input from '@/components/ui/Input'
import { Label } from '@/components/ui/Label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/Select'
import { localizedErrorMessage } from '@/lib/utils'
import { useWorkspaceStore } from '@/stores/workspace'

export default function AnswerTestConsole() {
  const { t } = useTranslation()
  const currentWorkspaceId = useWorkspaceStore.use.currentWorkspaceId()
  const [query, setQuery] = useState('')
  const [topK, setTopK] = useState('5')
  const [minScore, setMinScore] = useState('0.18')
  const [strategy, setStrategy] = useState<'fast' | 'balanced'>('balanced')
  const [retrievalMode, setRetrievalMode] = useState<'keyword' | 'hybrid' | 'llm_rerank'>('keyword')
  const [includeDrafts, setIncludeDrafts] = useState(false)
  const [result, setResult] = useState<AnswerResolveResponse | null>(null)
  const [isLoading, setIsLoading] = useState(false)

  useEffect(() => {
    setResult(null)
  }, [currentWorkspaceId])

  const handleResolve = async () => {
    if (!query.trim()) {
      toast.error(t('answerCatalog.test.queryRequired', 'Enter a query to test.'))
      return
    }
    setIsLoading(true)
    setResult(null)
    try {
      const workspaceId = currentWorkspaceId
      const response = await resolveAnswer({
        query: query.trim(),
        top_k: Number(topK),
        min_score: Number(minScore),
        strategy,
        retrieval_mode: retrievalMode,
        vector_top_k: 8,
        llm_candidate_count: 5,
        include_drafts: includeDrafts,
      })
      if (workspaceId !== useWorkspaceStore.getState().currentWorkspaceId) return
      setResult(response)
    } catch (err) {
      toast.error(localizedErrorMessage(err, t))
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div className="flex h-full flex-col gap-4 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">{t('answerCatalog.test.title', 'Answer Test Console')}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {t('answerCatalog.test.description', 'Run a user query and inspect fixed-answer candidates, scores, and the selected answer.')}
          </p>
        </div>
        <AnswerHelpButton />
      </div>

      <div className="rounded-md border p-4">
        <div className="grid gap-3 lg:grid-cols-[1fr_140px_150px_170px_160px_auto]">
          <div>
            <Label>{t('answerCatalog.test.query', 'User Query')}</Label>
            <Input
              className="mt-1"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') handleResolve()
              }}
              placeholder={t('answerCatalog.test.placeholder', '예: 환불은 어떻게 하나요?')}
            />
          </div>
          <div>
            <Label>{t('answerCatalog.test.topK', 'Candidate Count')}</Label>
            <Select value={topK} onValueChange={setTopK}>
              <SelectTrigger className="mt-1">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="3">3</SelectItem>
                <SelectItem value="5">5</SelectItem>
                <SelectItem value="10">10</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>{t('answerCatalog.test.strategy', 'Strategy')}</Label>
            <Select value={strategy} onValueChange={(value) => setStrategy(value as 'fast' | 'balanced')}>
              <SelectTrigger className="mt-1">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="balanced">{t('answerCatalog.test.strategyBalanced', 'Balanced')}</SelectItem>
                <SelectItem value="fast">{t('answerCatalog.test.strategyFast', 'Fast')}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>{t('answerCatalog.test.retrievalMode', 'Retrieval Mode')}</Label>
            <Select value={retrievalMode} onValueChange={(value) => setRetrievalMode(value as 'keyword' | 'hybrid' | 'llm_rerank')}>
              <SelectTrigger className="mt-1">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="keyword">{t('answerCatalog.test.modeKeyword', 'Keyword')}</SelectItem>
                <SelectItem value="hybrid">{t('answerCatalog.test.modeHybrid', 'Keyword + Vector')}</SelectItem>
                <SelectItem value="llm_rerank">{t('answerCatalog.test.modeLlm', 'LLM ID Select')}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>{t('answerCatalog.test.minScore', 'Min Score')}</Label>
            <Input className="mt-1" value={minScore} onChange={(event) => setMinScore(event.target.value)} />
          </div>
          <div className="flex items-end">
            <Button onClick={handleResolve} disabled={isLoading}>
              {isLoading ? <Loader2Icon className="h-4 w-4 animate-spin" /> : <SearchIcon className="h-4 w-4" />}
              {t('answerCatalog.test.run', 'Find Answer')}
            </Button>
          </div>
        </div>
        <label className="mt-3 flex items-center gap-2 text-sm text-muted-foreground">
          <Checkbox checked={includeDrafts} onCheckedChange={(checked) => setIncludeDrafts(Boolean(checked))} />
          {t('answerCatalog.test.includeDrafts', 'Include draft answers')}
        </label>
      </div>

      {result && (
        <div className="grid min-h-0 flex-1 gap-4 lg:grid-cols-[1fr_1fr]">
          <div className="rounded-md border p-4">
            <div className="mb-3 flex items-center gap-2">
              {result.selected_answer ? (
                <CheckCircle2Icon className="h-4 w-4 text-green-600" />
              ) : (
                <XCircleIcon className="h-4 w-4 text-red-600" />
              )}
              <h2 className="font-semibold">{t('answerCatalog.test.selected', 'Selected Answer')}</h2>
              <Badge variant="outline">{Math.round(result.confidence * 100)}%</Badge>
              <Badge variant="outline">{result.selected_by || result.retrieval_mode || retrievalMode}</Badge>
            </div>
            {result.selected_answer ? (
              <div className="space-y-3">
                <div>
                  <div className="text-sm font-medium">{result.selected_answer.title}</div>
                  <div className="mt-1 font-mono text-xs text-muted-foreground">{result.selected_answer.answer_id}</div>
                </div>
                {result.selected_answer.approved_summary && (
                  <div className="rounded-md bg-muted/40 p-3 text-sm">
                    {result.selected_answer.approved_summary}
                  </div>
                )}
                <div className="whitespace-pre-wrap rounded-md border p-3 text-sm">
                  {result.selected_answer.body}
                </div>
              </div>
            ) : (
              <div className="text-sm text-muted-foreground">{result.rationale}</div>
            )}
            <div className="mt-4 text-xs text-muted-foreground">
              {t('answerCatalog.test.trace', 'Trace ID')}: {result.trace_id}
            </div>
          </div>

          <div className="min-h-0 overflow-auto rounded-md border">
            <div className="border-b p-4 font-semibold">{t('answerCatalog.test.candidates', 'Candidates')}</div>
            {result.candidates.length === 0 ? (
              <div className="p-4 text-sm text-muted-foreground">
                {t('answerCatalog.test.noCandidates', 'No candidates were found.')}
              </div>
            ) : (
              <div className="divide-y">
                {result.candidates.map((candidate) => (
                  <div key={candidate.answer.answer_id} className="p-4">
                    <div className="flex flex-wrap items-center gap-2">
                      <div className="font-medium">{candidate.answer.title}</div>
                      <Badge variant="outline">{candidate.score}</Badge>
                      <Badge variant="outline">{candidate.selected_by || result.retrieval_mode || retrievalMode}</Badge>
                      <Badge variant={candidate.answer.status === 'published' ? 'secondary' : 'default'}>
                        {t(`answerCatalog.status.${candidate.answer.status}`, candidate.answer.status)}
                      </Badge>
                    </div>
                    <div className="mt-1 font-mono text-xs text-muted-foreground">{candidate.answer.answer_id}</div>
                    <div className="mt-2 text-xs text-muted-foreground">{candidate.reason}</div>
                    {candidate.score_details && Object.keys(candidate.score_details).length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-1">
                        {Object.entries(candidate.score_details).map(([key, value]) => (
                          <Badge key={key} variant={value < 0 ? 'destructive' : 'outline'}>
                            {key}: {Number(value).toFixed(2)}
                          </Badge>
                        ))}
                      </div>
                    )}
                    {candidate.matched_guidance.length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-1">
                        {candidate.matched_guidance.map((item) => (
                          <Badge key={item} variant="outline">{item}</Badge>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

import { ChangeEvent, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import {
  CheckCircle2Icon,
  DatabaseIcon,
  EyeIcon,
  FileTextIcon,
  LinkIcon,
  Loader2Icon,
  PlusIcon,
  SparklesIcon,
  Trash2Icon,
} from 'lucide-react'

import {
  AnswerContentFormat,
  AnswerGuidanceType,
  AnswerItem,
  createAnswerSourceDraft,
} from '@/api/lightrag'
import AnswerHelpButton from '@/components/answers/AnswerHelpButton'
import Badge from '@/components/ui/Badge'
import Button from '@/components/ui/Button'
import Input from '@/components/ui/Input'
import Textarea from '@/components/ui/Textarea'
import { Label } from '@/components/ui/Label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/Select'
import { localizedErrorMessage } from '@/lib/utils'
import { useWorkspaceStore } from '@/stores/workspace'

type SourceType = 'plain' | 'markdown' | 'html' | 'url' | 'file' | 'structured'

type StructuredProfile = {
  kind: 'json' | 'table' | 'text'
  columns: string[]
  rowCount: number
  sampleRows: string[][]
  jsonKeys: string[]
}

type SourceProfile = {
  charCount: number
  lineCount: number
  tokenCount: number
  headings: string[]
  keywords: string[]
  structured: StructuredProfile
}

type GuidanceCandidate = {
  guidance_type: AnswerGuidanceType
  text: string
  weight: number
  source: string
}

type AnswerCandidate = {
  title: string
  summary: string
  tags: string[]
  profile: SourceProfile
  guidance: GuidanceCandidate[]
}

const sourceFormat: Record<SourceType, AnswerContentFormat> = {
  plain: 'plain',
  markdown: 'markdown',
  html: 'html',
  url: 'markdown',
  file: 'markdown',
  structured: 'markdown',
}

const sourceTypeToTag: Record<SourceType, string> = {
  plain: 'text',
  markdown: 'markdown',
  html: 'html',
  url: 'url',
  file: 'file',
  structured: 'structured',
}

const stopWords = new Set([
  'and',
  'the',
  'for',
  'with',
  'from',
  'this',
  'that',
  'what',
  'how',
  'are',
  'you',
  'your',
  '하다',
  '있는',
  '없는',
  '대한',
  '관련',
  '사용',
  '답변',
  '정보',
])

const splitLines = (value: string) =>
  value.split('\n').map((line) => line.trim()).filter(Boolean)

const parseTags = (value: string) =>
  value.split(',').map((tag) => tag.trim()).filter(Boolean)

const unique = <T,>(items: T[]) => Array.from(new Set(items))

const stripMarkup = (value: string, format: AnswerContentFormat) => {
  if (format === 'html') {
    return value
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
  }
  return value.replace(/^#{1,6}\s+/gm, '').replace(/\*\*|__/g, '')
}

const extractHeadings = (value: string, format: AnswerContentFormat) => {
  if (format === 'html') {
    return Array.from(value.matchAll(/<h[1-3][^>]*>(.*?)<\/h[1-3]>/gi))
      .map((match) => stripMarkup(match[1], 'html').trim())
      .filter(Boolean)
      .slice(0, 6)
  }
  return Array.from(value.matchAll(/^#{1,3}\s+(.+)$/gm))
    .map((match) => match[1].trim())
    .filter(Boolean)
    .slice(0, 6)
}

const tokenize = (value: string) =>
  Array.from(value.toLowerCase().matchAll(/[0-9a-z가-힣_]{2,}/g))
    .map((match) => match[0])
    .filter((token) => !stopWords.has(token))

const extractKeywords = (value: string) => {
  const counts = new Map<string, number>()
  tokenize(value).forEach((token) => counts.set(token, (counts.get(token) || 0) + 1))
  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 10)
    .map(([token]) => token)
}

const splitCsvLine = (line: string) => {
  const cells: string[] = []
  let current = ''
  let quoted = false
  for (const char of line) {
    if (char === '"') {
      quoted = !quoted
      continue
    }
    if (char === ',' && !quoted) {
      cells.push(current.trim())
      current = ''
      continue
    }
    current += char
  }
  cells.push(current.trim())
  return cells
}

const profileStructured = (value: string): StructuredProfile => {
  const trimmed = value.trim()
  if (!trimmed) {
    return { kind: 'text', columns: [], rowCount: 0, sampleRows: [], jsonKeys: [] }
  }

  try {
    const parsed = JSON.parse(trimmed)
    const rows = Array.isArray(parsed) ? parsed : [parsed]
    const objects = rows.filter((row) => row && typeof row === 'object' && !Array.isArray(row)) as Record<string, unknown>[]
    const columns = unique(objects.flatMap((row) => Object.keys(row))).slice(0, 20)
    const sampleRows = objects.slice(0, 3).map((row) => columns.slice(0, 6).map((column) => String(row[column] ?? '')))
    return {
      kind: 'json',
      columns,
      rowCount: rows.length,
      sampleRows,
      jsonKeys: columns,
    }
  } catch {
    // Not JSON. Try CSV/table below.
  }

  const rows = trimmed.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
  if (rows.length >= 2 && rows[0].includes(',')) {
    const columns = splitCsvLine(rows[0]).slice(0, 20)
    return {
      kind: 'table',
      columns,
      rowCount: Math.max(rows.length - 1, 0),
      sampleRows: rows.slice(1, 4).map((row) => splitCsvLine(row).slice(0, 6)),
      jsonKeys: [],
    }
  }

  return { kind: 'text', columns: [], rowCount: 0, sampleRows: [], jsonKeys: [] }
}

const buildCandidate = ({
  sourceType,
  contentFormat,
  title,
  summary,
  body,
  tags,
  guidance,
  sourceUri,
  fileName,
}: {
  sourceType: SourceType
  contentFormat: AnswerContentFormat
  title: string
  summary: string
  body: string
  tags: string
  guidance: string
  sourceUri: string
  fileName: string
}): AnswerCandidate => {
  const clean = stripMarkup(body, contentFormat)
  const headings = extractHeadings(body, contentFormat)
  const lines = splitLines(clean)
  const structured = profileStructured(body)
  const keywords = extractKeywords(`${title}\n${summary}\n${clean}\n${structured.columns.join(' ')}`)
  const fallbackTitle =
    headings[0] ||
    title.trim() ||
    fileName.replace(/\.[^.]+$/, '') ||
    sourceUri.replace(/^https?:\/\//, '').split(/[/?#]/)[0] ||
    lines[0]?.slice(0, 80) ||
    'Untitled Answer'
  const fallbackSummary = summary.trim() || lines.slice(0, 3).join(' ').slice(0, 280)
  const manualGuidance = splitLines(guidance).map<GuidanceCandidate>((text) => ({
    guidance_type: text.includes('?') || text.includes('？') ? 'question' : 'keyword',
    text,
    weight: text.includes('?') || text.includes('？') ? 1.2 : 1,
    source: 'manual',
  }))
  const keywordGuidance = keywords.slice(0, 6).map<GuidanceCandidate>((text) => ({
    guidance_type: 'keyword',
    text,
    weight: 0.9,
    source: 'profile',
  }))
  const headingGuidance = headings.slice(0, 3).map<GuidanceCandidate>((text) => ({
    guidance_type: 'question',
    text,
    weight: 1.1,
    source: 'heading',
  }))
  const columnGuidance = structured.columns.slice(0, 5).map<GuidanceCandidate>((text) => ({
    guidance_type: 'synonym',
    text,
    weight: 0.7,
    source: 'structured_field',
  }))

  return {
    title: fallbackTitle,
    summary: fallbackSummary,
    tags: unique([...parseTags(tags), sourceTypeToTag[sourceType], ...structured.columns.slice(0, 3)]),
    profile: {
      charCount: body.length,
      lineCount: lines.length,
      tokenCount: tokenize(clean).length,
      headings,
      keywords,
      structured,
    },
    guidance: unique([...manualGuidance, ...headingGuidance, ...keywordGuidance, ...columnGuidance].map((item) => JSON.stringify(item)))
      .map((item) => JSON.parse(item) as GuidanceCandidate)
      .slice(0, 18),
  }
}

export default function AnswerSources() {
  const { t } = useTranslation()
  const currentWorkspaceId = useWorkspaceStore.use.currentWorkspaceId()
  const [sourceType, setSourceType] = useState<SourceType>('plain')
  const [contentFormat, setContentFormat] = useState<AnswerContentFormat>('plain')
  const [sourceUri, setSourceUri] = useState('')
  const [title, setTitle] = useState('')
  const [summary, setSummary] = useState('')
  const [body, setBody] = useState('')
  const [tags, setTags] = useState('')
  const [guidance, setGuidance] = useState('')
  const [guidanceCandidates, setGuidanceCandidates] = useState<GuidanceCandidate[]>([])
  const [priority, setPriority] = useState('0')
  const [fileName, setFileName] = useState('')
  const [candidate, setCandidate] = useState<AnswerCandidate | null>(null)
  const [createdAnswer, setCreatedAnswer] = useState<AnswerItem | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)

  useEffect(() => {
    setSourceUri('')
    setTitle('')
    setSummary('')
    setBody('')
    setTags('')
    setGuidance('')
    setGuidanceCandidates([])
    setPriority('0')
    setFileName('')
    setCandidate(null)
    setCreatedAnswer(null)
    setContentFormat(sourceFormat[sourceType])
  }, [currentWorkspaceId])

  const sourceHelp = useMemo(() => {
    if (sourceType === 'url') return t('answerCatalog.sources.urlHelp', 'URL is stored as source metadata. Paste the relevant content to create a reviewable answer draft.')
    if (sourceType === 'file') return t('answerCatalog.sources.fileHelp', 'Text, Markdown, and HTML files can be read locally and converted into an answer draft.')
    if (sourceType === 'structured') return t('answerCatalog.sources.structuredHelp', 'Paste a table row, JSON record, DB extract, or NoSQL document snapshot. Structured profiling will be expanded later.')
    return t('answerCatalog.sources.textHelp', 'Paste source material and create a draft fixed answer for review.')
  }, [sourceType, t])

  const resetForm = () => {
    setSourceUri('')
    setTitle('')
    setSummary('')
    setBody('')
    setTags('')
    setGuidance('')
    setGuidanceCandidates([])
    setPriority('0')
    setFileName('')
    setCandidate(null)
    setContentFormat(sourceFormat[sourceType])
  }

  const handleFileChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return
    try {
      const text = await file.text()
      setFileName(file.name)
      setTitle((current) => current || file.name.replace(/\.[^.]+$/, ''))
      setBody(text)
      const lowerName = file.name.toLowerCase()
      if (lowerName.endsWith('.html') || lowerName.endsWith('.htm')) {
        setContentFormat('html')
      } else if (lowerName.endsWith('.txt') || lowerName.endsWith('.csv') || lowerName.endsWith('.json')) {
        setContentFormat('plain')
      } else {
        setContentFormat('markdown')
      }
      setCandidate(null)
    } catch (err) {
      toast.error(localizedErrorMessage(err, t))
    }
  }

  const handleAnalyzeSource = () => {
    if (!body.trim()) {
      toast.error(t('answerCatalog.sources.bodyRequired', 'Paste source content before preview.'))
      return
    }
    const nextCandidate = buildCandidate({
      sourceType,
      contentFormat,
      title,
      summary,
      body,
      tags,
      guidance,
      sourceUri,
      fileName,
    })
    setCandidate(nextCandidate)
    setGuidanceCandidates(nextCandidate.guidance)
    if (!title.trim()) setTitle(nextCandidate.title)
    if (!summary.trim()) setSummary(nextCandidate.summary)
    if (!tags.trim()) setTags(nextCandidate.tags.join(', '))
    toast.success(t('answerCatalog.sources.previewReady', 'Source preview is ready for review.'))
  }

  const updateGuidanceCandidate = (index: number, patch: Partial<GuidanceCandidate>) => {
    setGuidanceCandidates((items) => items.map((item, itemIndex) => itemIndex === index ? { ...item, ...patch } : item))
  }

  const handleCreateDraft = async () => {
    if (!title.trim() || !body.trim()) {
      toast.error(t('answerCatalog.library.required', 'Title and body are required.'))
      return
    }
    setIsSubmitting(true)
    try {
      const workspaceId = currentWorkspaceId
      const result = await createAnswerSourceDraft({
        title: title.trim(),
        approved_summary: summary.trim() || null,
        body: body.trim(),
        content_format: contentFormat,
        display_policy: 'both',
        status: 'draft',
        priority: Number(priority) || 0,
        tags: parseTags(tags),
        metadata: {
          created_from: 'answer_source_wizard',
        },
        source_type: sourceType,
        source_uri: sourceUri.trim() || undefined,
        file_name: fileName || undefined,
        source_profile: candidate?.profile,
        guidance: guidanceCandidates
          .filter((item) => item.text.trim())
          .map((item) => ({
            guidance_type: item.guidance_type,
            text: item.text.trim(),
            weight: item.weight,
            source: item.source,
            metadata: {
              created_from: 'answer_source_wizard',
              source: item.source,
            },
          })),
      })
      if (workspaceId !== useWorkspaceStore.getState().currentWorkspaceId) return
      setCreatedAnswer(result.answer)
      toast.success(t('answerCatalog.sources.created', 'Answer draft created from source.'))
      resetForm()
    } catch (err) {
      toast.error(localizedErrorMessage(err, t))
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div className="flex h-full flex-col gap-4 p-4">
      <div className="flex items-start gap-3">
        <div className="rounded-md border bg-muted/40 p-2">
          <LinkIcon className="h-5 w-5" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-2xl font-bold">{t('answerCatalog.sources.title', 'Answer Sources')}</h1>
              <Badge variant="outline">Phase 2+</Badge>
            </div>
            <AnswerHelpButton />
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            {t('answerCatalog.sources.description', 'Connect text, HTML, markdown, URL, DB, NoSQL, and document sources for answer candidate generation.')}
          </p>
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-[380px_1fr]">
        <div className="rounded-md border p-4">
          <div className="mb-4 flex items-center gap-2">
            <FileTextIcon className="h-4 w-4" />
            <div className="font-semibold">{t('answerCatalog.sources.sourceSetup', 'Source Setup')}</div>
          </div>
          <div className="grid gap-4">
            <div className="grid gap-2">
              <Label>{t('answerCatalog.sources.sourceType', 'Source Type')}</Label>
              <Select
                value={sourceType}
                onValueChange={(value) => {
                  const nextType = value as SourceType
                  setSourceType(nextType)
                  setContentFormat(sourceFormat[nextType])
                  setCandidate(null)
                }}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="plain">{t('answerCatalog.sources.types.plain', 'Plain Text')}</SelectItem>
                  <SelectItem value="markdown">{t('answerCatalog.sources.types.markdown', 'Markdown')}</SelectItem>
                  <SelectItem value="html">{t('answerCatalog.sources.types.html', 'HTML')}</SelectItem>
                  <SelectItem value="url">{t('answerCatalog.sources.types.url', 'URL')}</SelectItem>
                  <SelectItem value="file">{t('answerCatalog.sources.types.file', 'Text File')}</SelectItem>
                  <SelectItem value="structured">{t('answerCatalog.sources.types.structured', 'Structured Snapshot')}</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs leading-5 text-muted-foreground">{sourceHelp}</p>
            </div>

            {(sourceType === 'url' || sourceType === 'structured') && (
              <div className="grid gap-2">
                <Label>{t('answerCatalog.sources.sourceUri', 'Source URI')}</Label>
                <Input
                  value={sourceUri}
                  onChange={(event) => setSourceUri(event.target.value)}
                  placeholder={sourceType === 'url' ? 'https://example.com/faq' : 'db://table/key 또는 collection/id'}
                />
              </div>
            )}

            {sourceType === 'file' && (
              <div className="grid gap-2">
                <Label>{t('answerCatalog.sources.file', 'File')}</Label>
                <Input type="file" accept=".txt,.md,.markdown,.html,.htm,.json,.csv" onChange={handleFileChange} />
                {fileName && <div className="text-xs text-muted-foreground">{fileName}</div>}
              </div>
            )}

            <div className="grid gap-2">
              <Label>{t('answerCatalog.library.contentFormat', 'Format')}</Label>
              <Select value={contentFormat} onValueChange={(value) => setContentFormat(value as AnswerContentFormat)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="plain">Plain</SelectItem>
                  <SelectItem value="markdown">Markdown</SelectItem>
                  <SelectItem value="html">HTML</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="grid gap-2">
              <Label>{t('answerCatalog.library.tags', 'Tags')}</Label>
              <Input
                value={tags}
                onChange={(event) => setTags(event.target.value)}
                placeholder={t('answerCatalog.library.tagsPlaceholder', 'billing, refund, membership')}
              />
            </div>

            <div className="grid gap-2">
              <Label>{t('answerCatalog.library.priority', 'Priority')}</Label>
              <Input type="number" value={priority} onChange={(event) => setPriority(event.target.value)} />
            </div>

            <Button variant="outline" onClick={handleAnalyzeSource}>
              <EyeIcon className="h-4 w-4" />
              {t('answerCatalog.sources.preview', 'Preview Source')}
            </Button>
          </div>
        </div>

        <div className="rounded-md border p-4">
          <div className="mb-4 flex items-center gap-2">
            <DatabaseIcon className="h-4 w-4" />
            <div className="font-semibold">{t('answerCatalog.sources.materialize', 'Materialize Draft')}</div>
          </div>
          <div className="grid gap-4">
            <div className="grid gap-2">
              <Label>{t('answerCatalog.library.answerTitle', 'Title')}</Label>
              <Input value={title} onChange={(event) => setTitle(event.target.value)} />
            </div>
            <div className="grid gap-2">
              <Label>{t('answerCatalog.library.summary', 'Approved Summary')}</Label>
              <Textarea rows={3} value={summary} onChange={(event) => setSummary(event.target.value)} />
            </div>
            <div className="grid gap-2">
              <Label>{t('answerCatalog.sources.sourceBody', 'Source Content / Answer Body')}</Label>
              <Textarea className="min-h-56" value={body} onChange={(event) => {
                setBody(event.target.value)
                setCandidate(null)
              }} />
            </div>
            <div className="grid gap-2">
              <Label>{t('answerCatalog.library.guidance', 'Guidance Questions / Keywords')}</Label>
              <Textarea
                rows={4}
                value={guidance}
                onChange={(event) => setGuidance(event.target.value)}
                placeholder={t('answerCatalog.library.guidancePlaceholder', 'How do I get a refund?\nCancel payment\nrefund policy')}
              />
            </div>

            {candidate ? (
              <div className="grid gap-3 rounded-md border bg-muted/20 p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <SparklesIcon className="h-4 w-4" />
                  <div className="font-semibold">{t('answerCatalog.sources.previewTitle', 'Review Candidate')}</div>
                  <Badge variant="outline">{candidate.profile.structured.kind}</Badge>
                </div>
                <div className="grid gap-2 md:grid-cols-4">
                  <Metric label={t('answerCatalog.sources.characters', 'Characters')} value={candidate.profile.charCount} />
                  <Metric label={t('answerCatalog.sources.lines', 'Lines')} value={candidate.profile.lineCount} />
                  <Metric label={t('answerCatalog.sources.tokens', 'Tokens')} value={candidate.profile.tokenCount} />
                  <Metric label={t('answerCatalog.sources.rows', 'Rows')} value={candidate.profile.structured.rowCount} />
                </div>
                {(candidate.profile.headings.length > 0 || candidate.profile.keywords.length > 0) && (
                  <div className="grid gap-3 md:grid-cols-2">
                    <PreviewList title={t('answerCatalog.sources.detectedHeadings', 'Detected Headings')} items={candidate.profile.headings} />
                    <PreviewList title={t('answerCatalog.sources.detectedKeywords', 'Detected Keywords')} items={candidate.profile.keywords} />
                  </div>
                )}
                {candidate.profile.structured.columns.length > 0 && (
                  <div className="rounded-md border bg-background p-3">
                    <div className="mb-2 text-sm font-medium">{t('answerCatalog.sources.structuredProfile', 'Structured Profile')}</div>
                    <div className="flex flex-wrap gap-1">
                      {candidate.profile.structured.columns.map((column) => (
                        <Badge key={column} variant="outline">{column}</Badge>
                      ))}
                    </div>
                  </div>
                )}
                <div className="rounded-md border bg-background p-3">
                  <div className="mb-3 flex items-center justify-between gap-2">
                    <div className="text-sm font-medium">{t('answerCatalog.sources.guidanceCandidates', 'Guidance Candidates')}</div>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setGuidanceCandidates((items) => [...items, { guidance_type: 'keyword', text: '', weight: 1, source: 'manual' }])}
                    >
                      <PlusIcon className="h-4 w-4" />
                      {t('common.add', 'Add')}
                    </Button>
                  </div>
                  <div className="grid gap-2">
                    {guidanceCandidates.length === 0 ? (
                      <div className="text-sm text-muted-foreground">
                        {t('answerCatalog.library.noGuidance', 'No guidance is registered.')}
                      </div>
                    ) : (
                      guidanceCandidates.map((item, index) => (
                        <div key={`${item.source}-${index}`} className="grid gap-2 md:grid-cols-[150px_1fr_90px_40px]">
                          <Select
                            value={item.guidance_type}
                            onValueChange={(value) => updateGuidanceCandidate(index, { guidance_type: value as AnswerGuidanceType })}
                          >
                            <SelectTrigger><SelectValue /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="question">{t('answerCatalog.guidanceTypes.question', 'Question')}</SelectItem>
                              <SelectItem value="keyword">{t('answerCatalog.guidanceTypes.keyword', 'Keyword')}</SelectItem>
                              <SelectItem value="synonym">{t('answerCatalog.guidanceTypes.synonym', 'Synonym')}</SelectItem>
                              <SelectItem value="negative_keyword">{t('answerCatalog.guidanceTypes.negative_keyword', 'Negative')}</SelectItem>
                              <SelectItem value="note">{t('answerCatalog.guidanceTypes.note', 'Note')}</SelectItem>
                            </SelectContent>
                          </Select>
                          <Input value={item.text} onChange={(event) => updateGuidanceCandidate(index, { text: event.target.value })} />
                          <Input
                            type="number"
                            step="0.1"
                            value={item.weight}
                            onChange={(event) => updateGuidanceCandidate(index, { weight: Number(event.target.value) || 1 })}
                          />
                          <Button
                            size="icon"
                            variant="ghost"
                            onClick={() => setGuidanceCandidates((items) => items.filter((_, itemIndex) => itemIndex !== index))}
                          >
                            <Trash2Icon className="h-4 w-4 text-red-500" />
                          </Button>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              </div>
            ) : (
              <div className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
                {t('answerCatalog.sources.previewHint', 'Preview the source first to inspect profiling, candidate keywords, and structured fields before creating a draft.')}
              </div>
            )}

            <div className="flex flex-wrap items-center justify-between gap-3">
              {createdAnswer ? (
                <div className="flex min-w-0 items-center gap-2 text-sm text-muted-foreground">
                  <CheckCircle2Icon className="h-4 w-4 text-green-600" />
                  <span className="truncate">{createdAnswer.title}</span>
                  <Badge variant="outline">{createdAnswer.answer_id}</Badge>
                </div>
              ) : (
                <div className="text-sm text-muted-foreground">
                  {t('answerCatalog.sources.reviewHint', 'Drafts are created unpublished so they can be reviewed before serving.')}
                </div>
              )}
              <Button onClick={handleCreateDraft} disabled={isSubmitting || !candidate}>
                {isSubmitting ? <Loader2Icon className="h-4 w-4 animate-spin" /> : <PlusIcon className="h-4 w-4" />}
                {t('answerCatalog.sources.createDraft', 'Create Draft')}
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-md border bg-background p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 text-lg font-semibold">{value.toLocaleString()}</div>
    </div>
  )
}

function PreviewList({ title, items }: { title: string; items: string[] }) {
  return (
    <div className="rounded-md border bg-background p-3">
      <div className="mb-2 text-sm font-medium">{title}</div>
      {items.length === 0 ? (
        <div className="text-xs text-muted-foreground">-</div>
      ) : (
        <div className="flex flex-wrap gap-1">
          {items.map((item) => (
            <Badge key={item} variant="outline">{item}</Badge>
          ))}
        </div>
      )}
    </div>
  )
}

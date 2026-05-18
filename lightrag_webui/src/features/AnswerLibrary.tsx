import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import {
  ArchiveIcon,
  BookOpenIcon,
  Edit3Icon,
  HistoryIcon,
  Loader2Icon,
  PlusIcon,
  RefreshCwIcon,
  RotateCcwIcon,
  SaveIcon,
  SendIcon,
  Trash2Icon,
} from 'lucide-react'

import {
  AnswerContentFormat,
  AnswerDisplayPolicy,
  AnswerGuidance,
  AnswerGuidanceType,
  AnswerItem,
  AnswerRevision,
  AnswerStatus,
  addAnswerGuidance,
  archiveAnswer,
  createAnswer,
  deleteAnswerGuidance,
  listAnswerGuidance,
  listAnswerRevisions,
  listAnswers,
  publishAnswer,
  restoreAnswerRevision,
  updateAnswer,
} from '@/api/lightrag'
import Badge from '@/components/ui/Badge'
import AnswerHelpButton from '@/components/answers/AnswerHelpButton'
import Button from '@/components/ui/Button'
import Input from '@/components/ui/Input'
import Textarea from '@/components/ui/Textarea'
import { Label } from '@/components/ui/Label'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/Dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/Select'
import { localizedErrorMessage } from '@/lib/utils'
import { useWorkspaceStore } from '@/stores/workspace'

const statusVariant = (status: AnswerStatus): 'default' | 'secondary' | 'destructive' | 'outline' => {
  if (status === 'published') return 'secondary'
  if (status === 'archived' || status === 'expired') return 'outline'
  return 'default'
}

const parseCsv = (value: string) =>
  value.split(',').map((item) => item.trim()).filter(Boolean)

const toLocalDateTimeValue = (value?: string | null) => {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  const localDate = new Date(date.getTime() - date.getTimezoneOffset() * 60000)
  return localDate.toISOString().slice(0, 16)
}

const fromLocalDateTimeValue = (value: string) => (value ? new Date(value).toISOString() : null)

export default function AnswerLibrary() {
  const { t } = useTranslation()
  const currentWorkspaceId = useWorkspaceStore.use.currentWorkspaceId()
  const [answers, setAnswers] = useState<AnswerItem[]>([])
  const [status, setStatus] = useState<string>('all')
  const [search, setSearch] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [isCreateOpen, setIsCreateOpen] = useState(false)
  const [selectedAnswer, setSelectedAnswer] = useState<AnswerItem | null>(null)

  const fetchAnswers = useCallback(async () => {
    const workspaceId = currentWorkspaceId
    setIsLoading(true)
    try {
      const result = await listAnswers({ status, search: search.trim() || undefined, page: 1, page_size: 100 })
      if (workspaceId !== useWorkspaceStore.getState().currentWorkspaceId) return
      setAnswers(result.answers)
    } catch (err) {
      toast.error(localizedErrorMessage(err, t))
    } finally {
      setIsLoading(false)
    }
  }, [currentWorkspaceId, search, status, t])

  useEffect(() => {
    setAnswers([])
    setSelectedAnswer(null)
    setIsCreateOpen(false)
  }, [currentWorkspaceId])

  useEffect(() => {
    fetchAnswers()
  }, [fetchAnswers])

  const counts = useMemo(() => ({
    total: answers.length,
    draft: answers.filter((answer) => answer.status === 'draft').length,
    published: answers.filter((answer) => answer.status === 'published').length,
    archived: answers.filter((answer) => answer.status === 'archived').length,
  }), [answers])

  const handlePublish = async (answer: AnswerItem) => {
    try {
      await publishAnswer(answer.answer_id)
      toast.success(t('answerCatalog.library.published', 'Answer published.'))
      fetchAnswers()
    } catch (err) {
      toast.error(localizedErrorMessage(err, t))
    }
  }

  const handleArchive = async (answer: AnswerItem) => {
    try {
      await archiveAnswer(answer.answer_id)
      toast.success(t('answerCatalog.library.archived', 'Answer archived.'))
      fetchAnswers()
    } catch (err) {
      toast.error(localizedErrorMessage(err, t))
    }
  }

  return (
    <div className="flex h-full flex-col gap-4 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">{t('answerCatalog.library.title', 'Answer Library')}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {t('answerCatalog.library.description', 'Manage approved fixed answers, versions, validity, and matching guidance.')}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <AnswerHelpButton />
          <Button variant="outline" size="sm" onClick={fetchAnswers} disabled={isLoading}>
            <RefreshCwIcon className={isLoading ? 'h-4 w-4 animate-spin' : 'h-4 w-4'} />
            {t('common.refresh', 'Refresh')}
          </Button>
          <CreateAnswerDialog
            open={isCreateOpen}
            onOpenChange={setIsCreateOpen}
            onCreated={fetchAnswers}
          />
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-4">
        <Metric label={t('answerCatalog.library.total', 'Total')} value={counts.total} />
        <Metric label={t('answerCatalog.library.draft', 'Draft')} value={counts.draft} />
        <Metric label={t('answerCatalog.library.publishedCount', 'Published')} value={counts.published} />
        <Metric label={t('answerCatalog.library.archivedCount', 'Archived')} value={counts.archived} />
      </div>

      <div className="flex flex-wrap gap-2 rounded-md border p-3">
        <Input
          className="min-w-64 flex-1"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder={t('answerCatalog.library.search', 'Search answers...')}
        />
        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger className="w-40">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t('common.all', 'All')}</SelectItem>
            <SelectItem value="draft">{t('answerCatalog.status.draft', 'Draft')}</SelectItem>
            <SelectItem value="published">{t('answerCatalog.status.published', 'Published')}</SelectItem>
            <SelectItem value="archived">{t('answerCatalog.status.archived', 'Archived')}</SelectItem>
          </SelectContent>
        </Select>
        <Button onClick={fetchAnswers} disabled={isLoading}>
          {isLoading ? <Loader2Icon className="h-4 w-4 animate-spin" /> : <RefreshCwIcon className="h-4 w-4" />}
          {t('common.search', 'Search')}
        </Button>
      </div>

      <div className="min-h-0 flex-1 overflow-auto rounded-md border">
        {answers.length === 0 ? (
          <div className="flex h-full min-h-72 flex-col items-center justify-center p-8 text-center">
            <BookOpenIcon className="mb-3 h-8 w-8 text-muted-foreground" />
            <div className="text-sm font-medium">{t('answerCatalog.library.empty', 'No answers yet')}</div>
            <div className="mt-1 text-sm text-muted-foreground">
              {t('answerCatalog.library.emptyDesc', 'Create the first fixed answer for this workspace.')}
            </div>
          </div>
        ) : (
          <div className="divide-y">
            {answers.map((answer) => (
              <div key={answer.answer_id} className="grid gap-3 p-4 lg:grid-cols-[1fr_auto]">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="truncate text-base font-semibold">{answer.title}</h2>
                    <Badge variant={statusVariant(answer.status)}>
                      {t(`answerCatalog.status.${answer.status}`, answer.status)}
                    </Badge>
                    <Badge variant="outline">v{answer.version}</Badge>
                    <span className="font-mono text-xs text-muted-foreground">{answer.answer_id}</span>
                  </div>
                  {answer.approved_summary && (
                    <p className="mt-2 line-clamp-2 text-sm text-muted-foreground">{answer.approved_summary}</p>
                  )}
                  <p className="mt-2 line-clamp-3 whitespace-pre-wrap text-sm">{answer.body}</p>
                  {answer.tags.length > 0 && (
                    <div className="mt-3 flex flex-wrap gap-1">
                      {answer.tags.map((tag) => (
                        <Badge key={tag} variant="outline">{tag}</Badge>
                      ))}
                    </div>
                  )}
                </div>
                <div className="flex items-start gap-2">
                  <Button size="sm" variant="outline" onClick={() => setSelectedAnswer(answer)}>
                    <Edit3Icon className="h-4 w-4" />
                    {t('common.edit', 'Edit')}
                  </Button>
                  {answer.status !== 'published' && (
                    <Button size="sm" onClick={() => handlePublish(answer)}>
                      <SendIcon className="h-4 w-4" />
                      {t('answerCatalog.library.publish', 'Publish')}
                    </Button>
                  )}
                  {answer.status !== 'archived' && (
                    <Button size="sm" variant="outline" onClick={() => handleArchive(answer)}>
                      <ArchiveIcon className="h-4 w-4" />
                      {t('answerCatalog.library.archive', 'Archive')}
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
      <AnswerDetailDialog
        answer={selectedAnswer}
        open={Boolean(selectedAnswer)}
        onOpenChange={(open) => {
          if (!open) setSelectedAnswer(null)
        }}
        onChanged={(answer) => {
          setSelectedAnswer(answer)
          fetchAnswers()
        }}
      />
    </div>
  )
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-md border p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 text-2xl font-semibold">{value}</div>
    </div>
  )
}

function AnswerDetailDialog({
  answer,
  open,
  onOpenChange,
  onChanged,
}: {
  answer: AnswerItem | null
  open: boolean
  onOpenChange: (open: boolean) => void
  onChanged: (answer: AnswerItem) => void
}) {
  const { t } = useTranslation()
  const [section, setSection] = useState<'content' | 'guidance' | 'revisions'>('content')
  const [title, setTitle] = useState('')
  const [summary, setSummary] = useState('')
  const [body, setBody] = useState('')
  const [status, setStatus] = useState<AnswerStatus>('draft')
  const [displayPolicy, setDisplayPolicy] = useState<AnswerDisplayPolicy>('both')
  const [contentFormat, setContentFormat] = useState<AnswerContentFormat>('markdown')
  const [priority, setPriority] = useState('0')
  const [tags, setTags] = useState('')
  const [validFrom, setValidFrom] = useState('')
  const [validUntil, setValidUntil] = useState('')
  const [guidance, setGuidance] = useState<AnswerGuidance[]>([])
  const [revisions, setRevisions] = useState<AnswerRevision[]>([])
  const [guidanceType, setGuidanceType] = useState<AnswerGuidanceType>('keyword')
  const [guidanceText, setGuidanceText] = useState('')
  const [guidanceWeight, setGuidanceWeight] = useState('1')
  const [isSaving, setIsSaving] = useState(false)
  const [isLoadingDetails, setIsLoadingDetails] = useState(false)

  const resetFromAnswer = useCallback((value: AnswerItem | null) => {
    if (!value) return
    setTitle(value.title)
    setSummary(value.approved_summary || '')
    setBody(value.body)
    setStatus(value.status)
    setDisplayPolicy(value.display_policy)
    setContentFormat(value.content_format)
    setPriority(String(value.priority ?? 0))
    setTags(value.tags.join(', '))
    setValidFrom(toLocalDateTimeValue(value.valid_from))
    setValidUntil(toLocalDateTimeValue(value.valid_until))
  }, [])

  const reloadDetails = useCallback(async () => {
    if (!answer) return
    setIsLoadingDetails(true)
    try {
      const [nextGuidance, nextRevisions] = await Promise.all([
        listAnswerGuidance(answer.answer_id),
        listAnswerRevisions(answer.answer_id),
      ])
      setGuidance(nextGuidance)
      setRevisions(nextRevisions)
    } catch (err) {
      toast.error(localizedErrorMessage(err, t))
    } finally {
      setIsLoadingDetails(false)
    }
  }, [answer])

  useEffect(() => {
    if (!open || !answer) return
    resetFromAnswer(answer)
    setSection('content')
    reloadDetails()
  }, [answer, open, reloadDetails, resetFromAnswer])

  const handleSave = async () => {
    if (!answer) return
    if (!title.trim() || !body.trim()) {
      toast.error(t('answerCatalog.library.required', 'Title and body are required.'))
      return
    }
    setIsSaving(true)
    try {
      const updated = await updateAnswer(answer.answer_id, {
        title: title.trim(),
        approved_summary: summary.trim() || null,
        body: body.trim(),
        status,
        display_policy: displayPolicy,
        content_format: contentFormat,
        priority: Number(priority) || 0,
        tags: parseCsv(tags),
        valid_from: fromLocalDateTimeValue(validFrom),
        valid_until: fromLocalDateTimeValue(validUntil),
      })
      toast.success(t('answerCatalog.library.saved', 'Answer saved.'))
      onChanged(updated)
      reloadDetails()
    } catch (err) {
      toast.error(localizedErrorMessage(err, t))
    } finally {
      setIsSaving(false)
    }
  }

  const handleAddGuidance = async () => {
    if (!answer || !guidanceText.trim()) return
    setIsSaving(true)
    try {
      await addAnswerGuidance(answer.answer_id, {
        guidance_type: guidanceType,
        text: guidanceText.trim(),
        weight: Number(guidanceWeight) || 1,
      })
      setGuidanceText('')
      setGuidanceWeight('1')
      toast.success(t('answerCatalog.library.guidanceAdded', 'Guidance added.'))
      reloadDetails()
    } catch (err) {
      toast.error(localizedErrorMessage(err, t))
    } finally {
      setIsSaving(false)
    }
  }

  const handleDeleteGuidance = async (item: AnswerGuidance) => {
    if (!answer) return
    setIsSaving(true)
    try {
      await deleteAnswerGuidance(answer.answer_id, item.guidance_id)
      toast.success(t('answerCatalog.library.guidanceDeleted', 'Guidance deleted.'))
      reloadDetails()
    } catch (err) {
      toast.error(localizedErrorMessage(err, t))
    } finally {
      setIsSaving(false)
    }
  }

  const handleRestoreRevision = async (revision: AnswerRevision) => {
    if (!answer) return
    setIsSaving(true)
    try {
      const restored = await restoreAnswerRevision(answer.answer_id, revision.revision_id)
      resetFromAnswer(restored)
      onChanged(restored)
      toast.success(t('answerCatalog.library.revisionRestored', 'Revision restored.'))
      reloadDetails()
    } catch (err) {
      toast.error(localizedErrorMessage(err, t))
    } finally {
      setIsSaving(false)
    }
  }

  if (!answer) return null

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-6xl">
        <DialogHeader>
          <DialogTitle>{t('answerCatalog.library.detailTitle', 'Answer Details')}</DialogTitle>
          <DialogDescription>
            <span className="font-mono">{answer.answer_id}</span>
            <span className="ml-2">v{answer.version}</span>
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-wrap gap-2">
          {(['content', 'guidance', 'revisions'] as const).map((item) => (
            <Button
              key={item}
              type="button"
              size="sm"
              variant={section === item ? 'default' : 'outline'}
              onClick={() => setSection(item)}
            >
              {item === 'content' && t('answerCatalog.library.contentSection', 'Content')}
              {item === 'guidance' && t('answerCatalog.library.guidanceSection', 'Guidance')}
              {item === 'revisions' && t('answerCatalog.library.revisionsSection', 'Revisions')}
            </Button>
          ))}
        </div>

        {section === 'content' && (
          <div className="grid gap-4 py-2">
            <div className="grid gap-4 lg:grid-cols-[1fr_180px_180px_130px]">
              <div className="grid gap-2">
                <Label>{t('answerCatalog.library.answerTitle', 'Title')}</Label>
                <Input value={title} onChange={(event) => setTitle(event.target.value)} />
              </div>
              <div className="grid gap-2">
                <Label>{t('answerCatalog.library.status', 'Status')}</Label>
                <Select value={status} onValueChange={(value) => setStatus(value as AnswerStatus)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="draft">{t('answerCatalog.status.draft', 'Draft')}</SelectItem>
                    <SelectItem value="published">{t('answerCatalog.status.published', 'Published')}</SelectItem>
                    <SelectItem value="archived">{t('answerCatalog.status.archived', 'Archived')}</SelectItem>
                    <SelectItem value="expired">{t('answerCatalog.status.expired', 'Expired')}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-2">
                <Label>{t('answerCatalog.library.displayPolicy', 'Display Policy')}</Label>
                <Select value={displayPolicy} onValueChange={(value) => setDisplayPolicy(value as AnswerDisplayPolicy)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="summary">{t('answerCatalog.display.summary', 'Summary')}</SelectItem>
                    <SelectItem value="full">{t('answerCatalog.display.full', 'Full')}</SelectItem>
                    <SelectItem value="both">{t('answerCatalog.display.both', 'Both')}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-2">
                <Label>{t('answerCatalog.library.priority', 'Priority')}</Label>
                <Input type="number" value={priority} onChange={(event) => setPriority(event.target.value)} />
              </div>
            </div>

            <div className="grid gap-4 lg:grid-cols-3">
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
                <Label>{t('answerCatalog.library.validFrom', 'Valid From')}</Label>
                <Input type="datetime-local" value={validFrom} onChange={(event) => setValidFrom(event.target.value)} />
              </div>
              <div className="grid gap-2">
                <Label>{t('answerCatalog.library.validUntil', 'Valid Until')}</Label>
                <Input type="datetime-local" value={validUntil} onChange={(event) => setValidUntil(event.target.value)} />
              </div>
            </div>

            <div className="grid gap-2">
              <Label>{t('answerCatalog.library.summary', 'Approved Summary')}</Label>
              <Textarea value={summary} onChange={(event) => setSummary(event.target.value)} rows={3} />
            </div>
            <div className="grid gap-2">
              <Label>{t('answerCatalog.library.body', 'Body')}</Label>
              <Textarea value={body} onChange={(event) => setBody(event.target.value)} className="min-h-56" />
            </div>
            <div className="grid gap-2">
              <Label>{t('answerCatalog.library.tags', 'Tags')}</Label>
              <Input value={tags} onChange={(event) => setTags(event.target.value)} />
            </div>
          </div>
        )}

        {section === 'guidance' && (
          <div className="grid gap-4 py-2">
            <div className="grid gap-3 rounded-md border p-3 lg:grid-cols-[180px_1fr_120px_auto]">
              <div>
                <Label>{t('answerCatalog.library.guidanceType', 'Type')}</Label>
                <Select value={guidanceType} onValueChange={(value) => setGuidanceType(value as AnswerGuidanceType)}>
                  <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="keyword">{t('answerCatalog.guidance.keyword', 'Keyword')}</SelectItem>
                    <SelectItem value="question">{t('answerCatalog.guidance.question', 'Question')}</SelectItem>
                    <SelectItem value="synonym">{t('answerCatalog.guidance.synonym', 'Synonym')}</SelectItem>
                    <SelectItem value="negative_keyword">{t('answerCatalog.guidance.negative_keyword', 'Negative')}</SelectItem>
                    <SelectItem value="note">{t('answerCatalog.guidance.note', 'Note')}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>{t('answerCatalog.library.guidanceText', 'Guidance Text')}</Label>
                <Input className="mt-1" value={guidanceText} onChange={(event) => setGuidanceText(event.target.value)} />
              </div>
              <div>
                <Label>{t('answerCatalog.library.weight', 'Weight')}</Label>
                <Input className="mt-1" type="number" min="0" max="10" step="0.1" value={guidanceWeight} onChange={(event) => setGuidanceWeight(event.target.value)} />
              </div>
              <div className="flex items-end">
                <Button onClick={handleAddGuidance} disabled={isSaving || !guidanceText.trim()}>
                  <PlusIcon className="h-4 w-4" />
                  {t('common.add', 'Add')}
                </Button>
              </div>
            </div>
            <div className="rounded-md border">
              <div className="flex items-center justify-between border-b p-3">
                <div className="font-medium">{t('answerCatalog.library.guidanceSection', 'Guidance')}</div>
                {isLoadingDetails && <Loader2Icon className="h-4 w-4 animate-spin" />}
              </div>
              {guidance.length === 0 ? (
                <div className="p-4 text-sm text-muted-foreground">{t('answerCatalog.library.noGuidance', 'No guidance is registered.')}</div>
              ) : (
                <div className="divide-y">
                  {guidance.map((item) => (
                    <div key={item.guidance_id} className="grid gap-2 p-3 lg:grid-cols-[140px_1fr_100px_auto]">
                      <Badge variant={item.guidance_type === 'negative_keyword' ? 'destructive' : 'outline'}>
                        {t(`answerCatalog.guidance.${item.guidance_type}`, item.guidance_type)}
                      </Badge>
                      <div className="text-sm">{item.text}</div>
                      <div className="text-sm text-muted-foreground">{item.weight}</div>
                      <Button size="sm" variant="outline" onClick={() => handleDeleteGuidance(item)} disabled={isSaving}>
                        <Trash2Icon className="h-4 w-4" />
                        {t('common.delete', 'Delete')}
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {section === 'revisions' && (
          <div className="grid gap-3 py-2">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <HistoryIcon className="h-4 w-4" />
              {t('answerCatalog.library.revisionDesc', 'Every save creates a restorable answer snapshot.')}
            </div>
            <div className="rounded-md border">
              {revisions.length === 0 ? (
                <div className="p-4 text-sm text-muted-foreground">{t('answerCatalog.library.noRevisions', 'No revisions were recorded.')}</div>
              ) : (
                <div className="divide-y">
                  {revisions.map((revision) => (
                    <div key={revision.revision_id} className="grid gap-3 p-3 lg:grid-cols-[140px_1fr_auto]">
                      <div>
                        <Badge variant="outline">v{revision.version}</Badge>
                        <div className="mt-1 text-xs text-muted-foreground">{revision.created_at ? new Date(revision.created_at).toLocaleString() : '-'}</div>
                      </div>
                      <div className="min-w-0">
                        <div className="truncate text-sm font-medium">{String(revision.snapshot.title || '')}</div>
                        <div className="mt-1 line-clamp-2 text-xs text-muted-foreground">{String(revision.snapshot.approved_summary || revision.snapshot.body || '')}</div>
                      </div>
                      <Button size="sm" variant="outline" onClick={() => handleRestoreRevision(revision)} disabled={isSaving}>
                        <RotateCcwIcon className="h-4 w-4" />
                        {t('answerCatalog.library.restoreRevision', 'Restore')}
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isSaving}>
            {t('common.close', 'Close')}
          </Button>
          <Button onClick={handleSave} disabled={isSaving}>
            {isSaving ? <Loader2Icon className="h-4 w-4 animate-spin" /> : <SaveIcon className="h-4 w-4" />}
            {t('common.save', 'Save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function CreateAnswerDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreated: () => void
}) {
  const { t } = useTranslation()
  const [title, setTitle] = useState('')
  const [summary, setSummary] = useState('')
  const [body, setBody] = useState('')
  const [tags, setTags] = useState('')
  const [guidance, setGuidance] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)

  const reset = () => {
    setTitle('')
    setSummary('')
    setBody('')
    setTags('')
    setGuidance('')
  }

  const handleCreate = async () => {
    if (!title.trim() || !body.trim()) {
      toast.error(t('answerCatalog.library.required', 'Title and body are required.'))
      return
    }
    setIsSubmitting(true)
    try {
      await createAnswer({
        title: title.trim(),
        body: body.trim(),
        approved_summary: summary.trim() || undefined,
        content_format: 'markdown',
        display_policy: 'both',
        status: 'draft',
        tags: tags.split(',').map((tag) => tag.trim()).filter(Boolean),
        guidance: guidance.split('\n').map((line) => line.trim()).filter(Boolean),
      })
      toast.success(t('answerCatalog.library.created', 'Answer created.'))
      reset()
      onOpenChange(false)
      onCreated()
    } catch (err) {
      toast.error(localizedErrorMessage(err, t))
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        <Button size="sm">
          <PlusIcon className="h-4 w-4" />
          {t('answerCatalog.library.create', 'Create Answer')}
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-3xl max-h-[86vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t('answerCatalog.library.createTitle', 'Create Fixed Answer')}</DialogTitle>
          <DialogDescription>
            {t('answerCatalog.library.createDesc', 'Create a draft answer first. Publish it after review.')}
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-2">
          <div className="grid gap-2">
            <Label>{t('answerCatalog.library.answerTitle', 'Title')}</Label>
            <Input value={title} onChange={(event) => setTitle(event.target.value)} />
          </div>
          <div className="grid gap-2">
            <Label>{t('answerCatalog.library.summary', 'Approved Summary')}</Label>
            <Textarea value={summary} onChange={(event) => setSummary(event.target.value)} rows={3} />
          </div>
          <div className="grid gap-2">
            <Label>{t('answerCatalog.library.body', 'Body')}</Label>
            <Textarea value={body} onChange={(event) => setBody(event.target.value)} className="min-h-44" />
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
            <Label>{t('answerCatalog.library.guidance', 'Guidance Questions / Keywords')}</Label>
            <Textarea
              value={guidance}
              onChange={(event) => setGuidance(event.target.value)}
              rows={5}
              placeholder={t('answerCatalog.library.guidancePlaceholder', 'How do I get a refund?\nCancel payment\nrefund policy')}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isSubmitting}>
            {t('common.cancel', 'Cancel')}
          </Button>
          <Button onClick={handleCreate} disabled={isSubmitting}>
            {isSubmitting && <Loader2Icon className="h-4 w-4 animate-spin" />}
            {t('answerCatalog.library.create', 'Create Answer')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

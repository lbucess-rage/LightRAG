import { useState, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import Button from '@/components/ui/Button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/Dialog'
import Input from '@/components/ui/Input'
import Textarea from '@/components/ui/Textarea'
import Checkbox from '@/components/ui/Checkbox'
import { Label } from '@/components/ui/Label'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/Tabs'
import Badge from '@/components/ui/Badge'
import TaskProgressPanel from './TaskProgressPanel'
import {
  validateUrl,
  ingestUrl,
  ingestUrlBatch,
  URLValidateResponse,
  URLBatchSkippedInfo,
} from '@/api/lightrag'
import { toast } from 'sonner'
import { errorMessage } from '@/lib/utils'
import { Link, CheckCircle2, AlertCircle, Loader2 } from 'lucide-react'

interface URLIngestDialogProps {
  onDocumentsUploaded?: () => Promise<void>
}

export default function URLIngestDialog({ onDocumentsUploaded }: URLIngestDialogProps) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)

  // Single URL state
  const [singleUrl, setSingleUrl] = useState('')
  const [validationResult, setValidationResult] = useState<URLValidateResponse | null>(null)
  const [isValidating, setIsValidating] = useState(false)

  // Batch URL state
  const [batchUrls, setBatchUrls] = useState('')
  const [skippedUrls, setSkippedUrls] = useState<URLBatchSkippedInfo[]>([])

  // Options
  const [processImages, setProcessImages] = useState(true)
  const [processTables, setProcessTables] = useState(true)
  const [skipDuplicates, setSkipDuplicates] = useState(true)
  const [followLinks, setFollowLinks] = useState(false)
  const [maxDepth, setMaxDepth] = useState(2)

  // Task state
  const [activeTaskIds, setActiveTaskIds] = useState<string[]>([])
  const [isSubmitting, setIsSubmitting] = useState(false)

  const resetState = useCallback(() => {
    setSingleUrl('')
    setValidationResult(null)
    setBatchUrls('')
    setSkippedUrls([])
    setActiveTaskIds([])
    setIsSubmitting(false)
    setIsValidating(false)
  }, [])

  const handleValidate = useCallback(async () => {
    if (!singleUrl.trim()) return
    setIsValidating(true)
    setValidationResult(null)
    try {
      const result = await validateUrl(singleUrl.trim())
      setValidationResult(result)
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setIsValidating(false)
    }
  }, [singleUrl])

  const handleSingleIngest = useCallback(async () => {
    if (!singleUrl.trim()) return
    setIsSubmitting(true)
    try {
      const result = await ingestUrl({
        url: singleUrl.trim(),
        process_images: processImages,
        process_tables: processTables,
        skip_duplicates: skipDuplicates,
        follow_links: followLinks,
        max_depth: maxDepth,
      })
      setActiveTaskIds([result.task_id])
      toast.success(result.message)
    } catch (err) {
      const msg = errorMessage(err)
      if (msg.includes('409')) {
        toast.error(t('documentPanel.urlIngest.alreadyIngested'))
      } else {
        toast.error(msg)
      }
      setIsSubmitting(false)
    }
  }, [singleUrl, processImages, processTables, skipDuplicates, t])

  const handleBatchIngest = useCallback(async () => {
    const urls = batchUrls
      .split('\n')
      .map(u => u.trim())
      .filter(u => u.length > 0)

    if (urls.length === 0) return
    setIsSubmitting(true)
    setSkippedUrls([])

    try {
      const result = await ingestUrlBatch({
        urls,
        process_images: processImages,
        process_tables: processTables,
        skip_duplicates: skipDuplicates,
        follow_links: followLinks,
        max_depth: maxDepth,
      })

      if (result.skipped.length > 0) {
        setSkippedUrls(result.skipped)
      }

      if (result.tasks.length > 0) {
        setActiveTaskIds(result.tasks.map(t => t.task_id))
        toast.success(
          t('documentPanel.urlIngest.batchStarted', {
            submitted: result.total_submitted,
            skipped: result.total_skipped,
          })
        )
      } else {
        toast.warning(t('documentPanel.urlIngest.allSkipped'))
        setIsSubmitting(false)
      }
    } catch (err) {
      toast.error(errorMessage(err))
      setIsSubmitting(false)
    }
  }, [batchUrls, processImages, processTables, skipDuplicates, t])

  const handleTaskComplete = useCallback(() => {
    onDocumentsUploaded?.()
  }, [onDocumentsUploaded])

  const hasActiveTasks = activeTaskIds.length > 0

  return (
    <Dialog
      open={open}
      onOpenChange={(newOpen) => {
        if (hasActiveTasks) return
        if (!newOpen) resetState()
        setOpen(newOpen)
      }}
    >
      <DialogTrigger asChild>
        <Button variant="outline" side="bottom" tooltip={t('documentPanel.urlIngest.tooltip')} size="sm">
          <Link className="h-4 w-4" /> {t('documentPanel.urlIngest.button')}
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg" onCloseAutoFocus={(e) => e.preventDefault()}>
        <DialogHeader>
          <DialogTitle>{t('documentPanel.urlIngest.title')}</DialogTitle>
          <DialogDescription>{t('documentPanel.urlIngest.description')}</DialogDescription>
        </DialogHeader>

        {hasActiveTasks ? (
          <div className="space-y-3">
            {activeTaskIds.map((taskId) => (
              <div key={taskId} className="border rounded-md p-3">
                <TaskProgressPanel
                  taskId={taskId}
                  onComplete={handleTaskComplete}
                  compact={activeTaskIds.length > 1}
                />
              </div>
            ))}
            <Button
              variant="outline"
              className="w-full"
              onClick={() => {
                resetState()
                setOpen(false)
              }}
            >
              {t('documentPanel.urlIngest.close')}
            </Button>
          </div>
        ) : (
          <Tabs defaultValue="single" className="w-full">
            <TabsList className="w-full">
              <TabsTrigger value="single" className="flex-1">
                {t('documentPanel.urlIngest.singleTab')}
              </TabsTrigger>
              <TabsTrigger value="batch" className="flex-1">
                {t('documentPanel.urlIngest.batchTab')}
              </TabsTrigger>
            </TabsList>

            <TabsContent value="single" className="mt-4 space-y-3 h-auto">
              {/* URL Input with validate button */}
              <div className="flex gap-2">
                <Input
                  placeholder={t('documentPanel.urlIngest.urlPlaceholder')}
                  value={singleUrl}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
                    setSingleUrl(e.target.value)
                    setValidationResult(null)
                  }}
                  onKeyDown={(e: React.KeyboardEvent<HTMLInputElement>) => {
                    if (e.key === 'Enter') handleValidate()
                  }}
                />
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleValidate}
                  disabled={!singleUrl.trim() || isValidating}
                >
                  {isValidating ? <Loader2 className="h-4 w-4 animate-spin" /> : t('documentPanel.urlIngest.validate')}
                </Button>
              </div>

              {/* Validation result */}
              {validationResult && (
                <div className="flex items-center gap-2 text-sm p-2 rounded-md bg-muted">
                  {validationResult.valid ? (
                    <>
                      <CheckCircle2 className="h-4 w-4 text-green-500" />
                      <span className="text-green-600">{validationResult.domain}</span>
                      <Badge variant="outline" className="text-xs">{validationResult.doc_id}</Badge>
                    </>
                  ) : (
                    <>
                      <AlertCircle className="h-4 w-4 text-red-500" />
                      <span className="text-red-600">{t('documentPanel.urlIngest.invalidUrl')}</span>
                    </>
                  )}
                </div>
              )}

              {/* Options */}
              <OptionsSection
                processImages={processImages}
                processTables={processTables}
                skipDuplicates={skipDuplicates}
                followLinks={followLinks}
                maxDepth={maxDepth}
                onProcessImagesChange={setProcessImages}
                onProcessTablesChange={setProcessTables}
                onSkipDuplicatesChange={setSkipDuplicates}
                onFollowLinksChange={setFollowLinks}
                onMaxDepthChange={setMaxDepth}
              />

              {/* Submit */}
              <Button
                className="w-full"
                onClick={handleSingleIngest}
                disabled={!singleUrl.trim() || isSubmitting}
              >
                {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                {t('documentPanel.urlIngest.ingest')}
              </Button>
            </TabsContent>

            <TabsContent value="batch" className="mt-4 space-y-3 h-auto">
              {/* Batch URL textarea */}
              <Textarea
                placeholder={t('documentPanel.urlIngest.batchPlaceholder')}
                value={batchUrls}
                onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setBatchUrls(e.target.value)}
                rows={6}
                className="font-mono text-sm"
              />

              {/* Skipped URLs */}
              {skippedUrls.length > 0 && (
                <div className="space-y-1 p-2 bg-muted rounded-md">
                  <p className="text-xs font-medium text-muted-foreground">
                    {t('documentPanel.urlIngest.skippedUrls', { count: skippedUrls.length })}
                  </p>
                  {skippedUrls.map((s, i) => (
                    <div key={i} className="flex gap-2 text-xs">
                      <span className="text-red-500 truncate max-w-[200px]">{s.url}</span>
                      <span className="text-muted-foreground">— {s.reason}</span>
                    </div>
                  ))}
                </div>
              )}

              {/* Options */}
              <OptionsSection
                processImages={processImages}
                processTables={processTables}
                skipDuplicates={skipDuplicates}
                followLinks={followLinks}
                maxDepth={maxDepth}
                onProcessImagesChange={setProcessImages}
                onProcessTablesChange={setProcessTables}
                onSkipDuplicatesChange={setSkipDuplicates}
                onFollowLinksChange={setFollowLinks}
                onMaxDepthChange={setMaxDepth}
              />

              {/* Submit */}
              <Button
                className="w-full"
                onClick={handleBatchIngest}
                disabled={!batchUrls.trim() || isSubmitting}
              >
                {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                {t('documentPanel.urlIngest.ingestBatch')}
              </Button>
            </TabsContent>
          </Tabs>
        )}
      </DialogContent>
    </Dialog>
  )
}

function OptionsSection({
  processImages,
  processTables,
  skipDuplicates,
  followLinks,
  maxDepth,
  onProcessImagesChange,
  onProcessTablesChange,
  onSkipDuplicatesChange,
  onFollowLinksChange,
  onMaxDepthChange,
}: {
  processImages: boolean
  processTables: boolean
  skipDuplicates: boolean
  followLinks: boolean
  maxDepth: number
  onProcessImagesChange: (v: boolean) => void
  onProcessTablesChange: (v: boolean) => void
  onSkipDuplicatesChange: (v: boolean) => void
  onFollowLinksChange: (v: boolean) => void
  onMaxDepthChange: (v: number) => void
}) {
  const { t } = useTranslation()

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-4 text-sm">
        <div className="flex items-center gap-2">
          <Checkbox
            id="url-process-images"
            checked={processImages}
            onCheckedChange={(v) => onProcessImagesChange(v === true)}
          />
          <Label htmlFor="url-process-images">{t('documentPanel.urlIngest.processImages')}</Label>
        </div>
        <div className="flex items-center gap-2">
          <Checkbox
            id="url-process-tables"
            checked={processTables}
            onCheckedChange={(v) => onProcessTablesChange(v === true)}
          />
          <Label htmlFor="url-process-tables">{t('documentPanel.urlIngest.processTables')}</Label>
        </div>
        <div className="flex items-center gap-2">
          <Checkbox
            id="url-skip-duplicates"
            checked={skipDuplicates}
            onCheckedChange={(v) => onSkipDuplicatesChange(v === true)}
          />
          <Label htmlFor="url-skip-duplicates">{t('documentPanel.urlIngest.skipDuplicates')}</Label>
        </div>
      </div>
      <div className="flex flex-wrap gap-4 text-sm items-center">
        <div className="flex items-center gap-2">
          <Checkbox
            id="url-follow-links"
            checked={followLinks}
            onCheckedChange={(v) => onFollowLinksChange(v === true)}
          />
          <Label htmlFor="url-follow-links">{t('documentPanel.urlIngest.followLinks')}</Label>
        </div>
        {followLinks && (
          <div className="flex items-center gap-2">
            <Label className="text-xs text-muted-foreground">{t('documentPanel.urlIngest.maxDepth')}</Label>
            <select
              className="h-7 rounded-md border bg-background px-2 text-xs"
              value={maxDepth}
              onChange={(e: React.ChangeEvent<HTMLSelectElement>) => onMaxDepthChange(Number(e.target.value))}
            >
              <option value={1}>1</option>
              <option value={2}>2</option>
              <option value={3}>3</option>
            </select>
          </div>
        )}
      </div>
    </div>
  )
}

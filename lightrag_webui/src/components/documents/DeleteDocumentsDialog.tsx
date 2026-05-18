import { useState, useCallback, useEffect } from 'react'
import Button from '@/components/ui/Button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter
} from '@/components/ui/Dialog'
import Input from '@/components/ui/Input'
import { toast } from 'sonner'
import { errorMessage } from '@/lib/utils'
import { DeletionPreviewResponse, executeDeletion, previewDeletion } from '@/api/lightrag'
import DeletionImpactSummary from '@/components/deletion/DeletionImpactSummary'

import { TrashIcon, AlertTriangleIcon } from 'lucide-react'
import { useTranslation } from 'react-i18next'

// Simple Label component
const Label = ({
  htmlFor,
  className,
  children,
  ...props
}: React.LabelHTMLAttributes<HTMLLabelElement>) => (
  <label
    htmlFor={htmlFor}
    className={className}
    {...props}
  >
    {children}
  </label>
)

interface DeleteDocumentsDialogProps {
  selectedDocIds: string[]
  onDocumentsDeleted?: () => Promise<void>
}

export default function DeleteDocumentsDialog({ selectedDocIds, onDocumentsDeleted }: DeleteDocumentsDialogProps) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [confirmText, setConfirmText] = useState('')
  const [deleteFile, setDeleteFile] = useState(false)
  const [preview, setPreview] = useState<DeletionPreviewResponse | null>(null)
  const [isPreviewing, setIsPreviewing] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)
  const [deleteLLMCache, setDeleteLLMCache] = useState(false)
  const [deleteS3File, setDeleteS3File] = useState(false)
  const isConfirmEnabled = !!preview && confirmText.toLowerCase() === 'yes' && !isDeleting && !isPreviewing

  // Reset state when dialog closes
  useEffect(() => {
    if (!open) {
      setConfirmText('')
      setDeleteFile(false)
      setDeleteLLMCache(false)
      setDeleteS3File(false)
      setPreview(null)
      setIsPreviewing(false)
      setIsDeleting(false)
    }
  }, [open])

  useEffect(() => {
    setPreview(null)
    setConfirmText('')
  }, [selectedDocIds, deleteFile, deleteLLMCache, deleteS3File])

  const buildRequest = useCallback(() => ({
    target_type: 'document' as const,
    policy: 'delete_documents' as const,
    ids: selectedDocIds,
    relations: [],
    delete_file: deleteFile,
    delete_s3_file: deleteS3File,
    delete_llm_cache: deleteLLMCache,
    invalidate_cache: true,
  }), [selectedDocIds, deleteFile, deleteS3File, deleteLLMCache])

  const handlePreview = useCallback(async () => {
    if (selectedDocIds.length === 0) return

    setIsPreviewing(true)
    try {
      const result = await previewDeletion(buildRequest())
      setPreview(result)
    } catch (err) {
      toast.error(t('documentPanel.deleteDocuments.error', { error: errorMessage(err) }))
    } finally {
      setIsPreviewing(false)
    }
  }, [buildRequest, selectedDocIds.length, t])

  const handleDelete = useCallback(async () => {
    if (!isConfirmEnabled || selectedDocIds.length === 0) return

    setIsDeleting(true)
    try {
      const result = await executeDeletion(buildRequest())
      const statuses = result.results.map((item) => String(item.status || ''))

      if (statuses.some((status) => status === 'deletion_started' || status === 'success')) {
        toast.success(t('documentPanel.deleteDocuments.success', { count: selectedDocIds.length }))
      } else if (statuses.some((status) => status === 'busy')) {
        toast.error(t('documentPanel.deleteDocuments.busy'))
        setConfirmText('')
        setIsDeleting(false)
        return
      } else if (statuses.some((status) => status === 'not_allowed')) {
        toast.error(t('documentPanel.deleteDocuments.notAllowed'))
        setConfirmText('')
        setIsDeleting(false)
        return
      } else {
        const message = result.results
          .map((item) => typeof item.message === 'string' ? item.message : '')
          .filter(Boolean)
          .join('\n')
        toast.error(t('documentPanel.deleteDocuments.failed', { message }))
        setConfirmText('')
        setIsDeleting(false)
        return
      }

      // Refresh document list if provided
      if (onDocumentsDeleted) {
        onDocumentsDeleted().catch(console.error)
      }

      // Close dialog after successful operation
      setOpen(false)
    } catch (err) {
      toast.error(t('documentPanel.deleteDocuments.error', { error: errorMessage(err) }))
      setConfirmText('')
    } finally {
      setIsDeleting(false)
    }
  }, [isConfirmEnabled, selectedDocIds, buildRequest, setOpen, t, onDocumentsDeleted])

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          variant="destructive"
          side="bottom"
          tooltip={t('documentPanel.deleteDocuments.tooltip', { count: selectedDocIds.length })}
          size="sm"
          disabled={selectedDocIds.length === 0}
        >
          <TrashIcon/> {t('documentPanel.deleteDocuments.button')}
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-xl" onCloseAutoFocus={(e) => e.preventDefault()}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-red-500 dark:text-red-400 font-bold">
            <AlertTriangleIcon className="h-5 w-5" />
            {t('documentPanel.deleteDocuments.title')}
          </DialogTitle>
          <DialogDescription className="pt-2">
            {t('documentPanel.deleteDocuments.description', { count: selectedDocIds.length })}
          </DialogDescription>
        </DialogHeader>

        <div className="text-red-500 dark:text-red-400 font-semibold mb-4">
          {t('documentPanel.deleteDocuments.warning')}
        </div>

        <div className="mb-4">
          {t('documentPanel.deleteDocuments.confirm', { count: selectedDocIds.length })}
        </div>

        <div className="space-y-4">
          <Button
            variant="outline"
            onClick={handlePreview}
            disabled={selectedDocIds.length === 0 || isPreviewing || isDeleting}
            className="w-full"
          >
            {isPreviewing ? t('common.loading', 'Loading...') : t('documentPanel.deleteDocuments.previewImpact', 'Preview deletion impact')}
          </Button>

          {preview && <DeletionImpactSummary preview={preview} />}

          <div className="space-y-2">
            <Label htmlFor="confirm-text" className="text-sm font-medium">
              {t('documentPanel.deleteDocuments.confirmPrompt')}
            </Label>
            <Input
              id="confirm-text"
              value={confirmText}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setConfirmText(e.target.value)}
              placeholder={t('documentPanel.deleteDocuments.confirmPlaceholder')}
              className="w-full"
              disabled={isDeleting || !preview}
            />
          </div>

          <div className="flex items-center space-x-2">
            <input
              type="checkbox"
              id="delete-file"
              checked={deleteFile}
              onChange={(e) => setDeleteFile(e.target.checked)}
              disabled={isDeleting}
              className="h-4 w-4 text-red-600 focus:ring-red-500 border-gray-300 rounded"
            />
            <Label htmlFor="delete-file" className="text-sm font-medium cursor-pointer">
              {t('documentPanel.deleteDocuments.deleteFileOption')}
            </Label>
          </div>

          <div className="flex items-center space-x-2">
            <input
              type="checkbox"
              id="delete-llm-cache"
              checked={deleteLLMCache}
              onChange={(e) => setDeleteLLMCache(e.target.checked)}
              disabled={isDeleting}
              className="h-4 w-4 text-red-600 focus:ring-red-500 border-gray-300 rounded"
            />
            <Label htmlFor="delete-llm-cache" className="text-sm font-medium cursor-pointer">
              {t('documentPanel.deleteDocuments.deleteLLMCacheOption')}
            </Label>
          </div>

          <div className="flex items-center space-x-2">
            <input
              type="checkbox"
              id="delete-s3-file"
              checked={deleteS3File}
              onChange={(e) => setDeleteS3File(e.target.checked)}
              disabled={isDeleting}
              className="h-4 w-4 text-red-600 focus:ring-red-500 border-gray-300 rounded"
            />
            <Label htmlFor="delete-s3-file" className="text-sm font-medium cursor-pointer">
              {t('documentPanel.deleteDocuments.deleteS3FileOption')}
            </Label>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={isDeleting}>
            {t('common.cancel')}
          </Button>
          <Button
            variant="destructive"
            onClick={handleDelete}
            disabled={!isConfirmEnabled}
          >
            {isDeleting ? t('documentPanel.deleteDocuments.deleting') : t('documentPanel.deleteDocuments.confirmButton')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

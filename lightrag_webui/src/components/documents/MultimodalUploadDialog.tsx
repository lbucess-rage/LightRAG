import { useState, useCallback, useRef } from 'react'
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
import TaskProgressPanel from './TaskProgressPanel'
import { processMultimodal } from '@/api/lightrag'
import { toast } from 'sonner'
import { errorMessage } from '@/lib/utils'
import { Layers, Upload, FileText, X, Loader2, ChevronDown, ChevronUp, MessageSquareText } from 'lucide-react'
import { cn } from '@/lib/utils'

interface MultimodalUploadDialogProps {
  onDocumentsUploaded?: () => Promise<void>
}

const ACCEPTED_TYPES = [
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
]
const ACCEPTED_EXTENSIONS = ['.pdf', '.docx', '.pptx', '.xlsx']

// Formats that only Docling can parse (PyMuPDF = PDF only)
const DOCLING_ONLY_EXTENSIONS = ['.pptx', '.xlsx', '.docx']

export default function MultimodalUploadDialog({ onDocumentsUploaded }: MultimodalUploadDialogProps) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // File state
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [uploadProgress, setUploadProgress] = useState(0)

  // Options
  const [parser, setParser] = useState<'pymupdf' | 'docling'>('pymupdf')
  const [processImages, setProcessImages] = useState(true)
  const [processTables, setProcessTables] = useState(true)
  const [processEquations, setProcessEquations] = useState(true)
  const [filePathLabel, setFilePathLabel] = useState('')
  const [pdfPassword, setPdfPassword] = useState('')

  // Custom prompts
  const [showCustomPrompts, setShowCustomPrompts] = useState(false)
  const [documentPrompt, setDocumentPrompt] = useState('')
  const [imagePrompt, setImagePrompt] = useState('')
  const [tablePrompt, setTablePrompt] = useState('')

  // Task state
  const [activeTaskId, setActiveTaskId] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isDragOver, setIsDragOver] = useState(false)

  const resetState = useCallback(() => {
    setSelectedFile(null)
    setUploadProgress(0)
    setActiveTaskId(null)
    setIsSubmitting(false)
    setFilePathLabel('')
    setPdfPassword('')
    setIsDragOver(false)
    setShowCustomPrompts(false)
    setDocumentPrompt('')
    setImagePrompt('')
    setTablePrompt('')
  }, [])

  const isValidFile = useCallback((file: File) => {
    if (ACCEPTED_TYPES.includes(file.type)) return true
    const ext = '.' + file.name.split('.').pop()?.toLowerCase()
    return ACCEPTED_EXTENSIONS.includes(ext)
  }, [])

  const handleFileSelect = useCallback((file: File) => {
    if (!isValidFile(file)) {
      toast.error(t('documentPanel.multimodalUpload.unsupportedType'))
      return
    }
    setSelectedFile(file)
    setUploadProgress(0)
    // Auto-switch to Docling for formats PyMuPDF can't handle
    const ext = '.' + file.name.split('.').pop()?.toLowerCase()
    if (DOCLING_ONLY_EXTENSIONS.includes(ext)) {
      setParser('docling')
    }
  }, [isValidFile, t])

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDragOver(false)
    const file = e.dataTransfer.files[0]
    if (file) handleFileSelect(file)
  }, [handleFileSelect])

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDragOver(true)
  }, [])

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDragOver(false)
  }, [])

  const handleSubmit = useCallback(async () => {
    if (!selectedFile) return
    setIsSubmitting(true)
    setUploadProgress(0)

    try {
      const result = await processMultimodal(
        selectedFile,
        {
          parser,
          process_images: processImages,
          process_tables: processTables,
          process_equations: processEquations,
          file_path_label: filePathLabel || undefined,
          pdf_password: pdfPassword || undefined,
          document_prompt: documentPrompt || undefined,
          image_prompt: imagePrompt || undefined,
          table_prompt: tablePrompt || undefined,
        },
        (percent) => setUploadProgress(percent)
      )

      setActiveTaskId(result.task_id)
      toast.success(result.message)
    } catch (err) {
      toast.error(errorMessage(err))
      setIsSubmitting(false)
    }
  }, [selectedFile, parser, processImages, processTables, processEquations, filePathLabel, pdfPassword, documentPrompt, imagePrompt, tablePrompt])

  const handleTaskComplete = useCallback(() => {
    onDocumentsUploaded?.()
  }, [onDocumentsUploaded])

  return (
    <Dialog
      open={open}
      onOpenChange={(newOpen) => {
        if (activeTaskId) return
        if (!newOpen) resetState()
        setOpen(newOpen)
      }}
    >
      <DialogTrigger asChild>
        <Button variant="outline" side="bottom" tooltip={t('documentPanel.multimodalUpload.tooltip')} size="sm">
          <Layers className="h-4 w-4" /> {t('documentPanel.multimodalUpload.button')}
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg max-h-[85vh] overflow-y-auto" onCloseAutoFocus={(e) => e.preventDefault()}>
        <DialogHeader>
          <DialogTitle>{t('documentPanel.multimodalUpload.title')}</DialogTitle>
          <DialogDescription>{t('documentPanel.multimodalUpload.description')}</DialogDescription>
        </DialogHeader>

        {activeTaskId ? (
          <div className="space-y-3">
            <TaskProgressPanel
              taskId={activeTaskId}
              onComplete={handleTaskComplete}
            />
            <Button
              variant="outline"
              className="w-full"
              onClick={() => {
                resetState()
                setOpen(false)
              }}
            >
              {t('documentPanel.multimodalUpload.close')}
            </Button>
          </div>
        ) : (
          <div className="space-y-4">
            {/* File drop zone */}
            <div
              className={cn(
                'border-2 border-dashed rounded-lg p-6 text-center cursor-pointer transition-colors',
                isDragOver && 'border-primary bg-primary/5',
                selectedFile ? 'border-green-500 bg-green-50 dark:bg-green-950/20' : 'border-muted-foreground/25 hover:border-muted-foreground/50',
              )}
              onDrop={handleDrop}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onClick={() => fileInputRef.current?.click()}
            >
              <input
                ref={fileInputRef}
                type="file"
                className="hidden"
                accept={ACCEPTED_EXTENSIONS.join(',')}
                onChange={(e) => {
                  const file = e.target.files?.[0]
                  if (file) handleFileSelect(file)
                  e.target.value = ''
                }}
              />
              {selectedFile ? (
                <div className="flex items-center justify-center gap-2">
                  <FileText className="h-5 w-5 text-green-500" />
                  <span className="text-sm font-medium">{selectedFile.name}</span>
                  <span className="text-xs text-muted-foreground">
                    ({(selectedFile.size / 1024 / 1024).toFixed(1)} MB)
                  </span>
                  <button
                    className="ml-2 p-1 rounded-full hover:bg-muted"
                    onClick={(e) => {
                      e.stopPropagation()
                      setSelectedFile(null)
                    }}
                  >
                    <X className="h-4 w-4 text-muted-foreground" />
                  </button>
                </div>
              ) : (
                <div className="space-y-2">
                  <Upload className="h-8 w-8 mx-auto text-muted-foreground" />
                  <p className="text-sm text-muted-foreground">
                    {t('documentPanel.multimodalUpload.dropZone')}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {t('documentPanel.multimodalUpload.acceptedFormats')}
                  </p>
                </div>
              )}
            </div>

            {/* Upload progress */}
            {isSubmitting && uploadProgress > 0 && uploadProgress < 100 && (
              <div className="text-xs text-muted-foreground text-center">
                {t('documentPanel.multimodalUpload.uploading', { percent: uploadProgress })}
              </div>
            )}

            {/* Parser selection */}
            <div className="space-y-2">
              <Label>{t('documentPanel.multimodalUpload.parser')}</Label>
              {(() => {
                const ext = selectedFile ? '.' + selectedFile.name.split('.').pop()?.toLowerCase() : ''
                const pymupdfDisabled = DOCLING_ONLY_EXTENSIONS.includes(ext)
                return (
              <div className="flex gap-3">
                <button
                  className={cn(
                    'flex-1 p-2 rounded-md border text-sm text-center transition-colors',
                    pymupdfDisabled && 'opacity-40 cursor-not-allowed',
                    parser === 'pymupdf' && !pymupdfDisabled
                      ? 'border-primary bg-primary/10 font-medium'
                      : 'border-muted hover:border-muted-foreground/50'
                  )}
                  onClick={() => !pymupdfDisabled && setParser('pymupdf')}
                  disabled={pymupdfDisabled}
                  title={pymupdfDisabled ? t('documentPanel.multimodalUpload.pymupdfUnsupported') : undefined}
                >
                  PyMuPDF
                  <span className="block text-xs text-muted-foreground">
                    {pymupdfDisabled
                      ? t('documentPanel.multimodalUpload.pymupdfUnsupported')
                      : t('documentPanel.multimodalUpload.pymupdfDesc')}
                  </span>
                </button>
                <button
                  className={cn(
                    'flex-1 p-2 rounded-md border text-sm text-center transition-colors',
                    parser === 'docling'
                      ? 'border-primary bg-primary/10 font-medium'
                      : 'border-muted hover:border-muted-foreground/50'
                  )}
                  onClick={() => setParser('docling')}
                >
                  Docling
                  <span className="block text-xs text-muted-foreground">{t('documentPanel.multimodalUpload.doclingDesc')}</span>
                </button>
              </div>
                )
              })()}
            </div>

            {/* Processing options */}
            <div className="flex flex-wrap gap-4 text-sm">
              <div className="flex items-center gap-2">
                <Checkbox
                  id="mm-process-images"
                  checked={processImages}
                  onCheckedChange={(v) => setProcessImages(v === true)}
                />
                <Label htmlFor="mm-process-images">{t('documentPanel.multimodalUpload.processImages')}</Label>
              </div>
              <div className="flex items-center gap-2">
                <Checkbox
                  id="mm-process-tables"
                  checked={processTables}
                  onCheckedChange={(v) => setProcessTables(v === true)}
                />
                <Label htmlFor="mm-process-tables">{t('documentPanel.multimodalUpload.processTables')}</Label>
              </div>
              <div className="flex items-center gap-2">
                <Checkbox
                  id="mm-process-equations"
                  checked={processEquations}
                  onCheckedChange={(v) => setProcessEquations(v === true)}
                />
                <Label htmlFor="mm-process-equations">{t('documentPanel.multimodalUpload.processEquations')}</Label>
              </div>
            </div>

            {/* Optional fields */}
            <div className="space-y-2">
              <div>
                <Label className="text-xs text-muted-foreground">{t('documentPanel.multimodalUpload.filePathLabel')}</Label>
                <Input
                  placeholder={t('documentPanel.multimodalUpload.filePathLabelPlaceholder')}
                  value={filePathLabel}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => setFilePathLabel(e.target.value)}
                  className="mt-1"
                />
              </div>
              {selectedFile?.name.toLowerCase().endsWith('.pdf') && (
                <div>
                  <Label className="text-xs text-muted-foreground">{t('documentPanel.multimodalUpload.pdfPassword')}</Label>
                  <Input
                    type="password"
                    placeholder={t('documentPanel.multimodalUpload.pdfPasswordPlaceholder')}
                    value={pdfPassword}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) => setPdfPassword(e.target.value)}
                    className="mt-1"
                  />
                </div>
              )}
            </div>

            {/* Custom Prompts (collapsible) */}
            <div className="space-y-2">
              <button
                type="button"
                className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors w-full"
                onClick={() => setShowCustomPrompts(!showCustomPrompts)}
              >
                <MessageSquareText className="h-4 w-4" />
                <span>{t('documentPanel.multimodalUpload.customPrompts.title')}</span>
                {showCustomPrompts ? <ChevronUp className="h-4 w-4 ml-auto" /> : <ChevronDown className="h-4 w-4 ml-auto" />}
              </button>
              {showCustomPrompts && (
                <div className="space-y-3 pt-1">
                  <p className="text-xs text-muted-foreground">
                    {t('documentPanel.multimodalUpload.customPrompts.description')}
                  </p>
                  <div>
                    <Label className="text-xs text-muted-foreground">{t('documentPanel.multimodalUpload.customPrompts.documentPrompt')}</Label>
                    <Textarea
                      rows={2}
                      className="mt-1 min-h-[60px]"
                      placeholder={t('documentPanel.multimodalUpload.customPrompts.documentPromptPlaceholder')}
                      value={documentPrompt}
                      onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setDocumentPrompt(e.target.value)}
                    />
                  </div>
                  <div>
                    <Label className="text-xs text-muted-foreground">{t('documentPanel.multimodalUpload.customPrompts.imagePrompt')}</Label>
                    <Textarea
                      rows={2}
                      className="mt-1 min-h-[60px]"
                      placeholder={t('documentPanel.multimodalUpload.customPrompts.imagePromptPlaceholder')}
                      value={imagePrompt}
                      onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setImagePrompt(e.target.value)}
                    />
                  </div>
                  <div>
                    <Label className="text-xs text-muted-foreground">{t('documentPanel.multimodalUpload.customPrompts.tablePrompt')}</Label>
                    <Textarea
                      rows={2}
                      className="mt-1 min-h-[60px]"
                      placeholder={t('documentPanel.multimodalUpload.customPrompts.tablePromptPlaceholder')}
                      value={tablePrompt}
                      onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setTablePrompt(e.target.value)}
                    />
                  </div>
                </div>
              )}
            </div>

            {/* Submit */}
            <Button
              className="w-full"
              onClick={handleSubmit}
              disabled={!selectedFile || isSubmitting}
            >
              {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              {t('documentPanel.multimodalUpload.process')}
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}

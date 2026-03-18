import { useState, useCallback, useRef, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import Button from '@/components/ui/Button'
import Input from '@/components/ui/Input'
import Textarea from '@/components/ui/Textarea'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter
} from '@/components/ui/Dialog'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'
import { errorMessage } from '@/lib/utils'
import {
  ZapIcon,
  TypeIcon,
  ImageIcon,
  ChevronDownIcon,
  ChevronUpIcon,
  Loader2Icon,
  XIcon
} from 'lucide-react'
import { insertTextWithSource, quickIngestImage } from '@/api/lightrag'

interface QuickIngestDialogProps {
  onDocumentsUploaded?: () => Promise<void>
}

export default function QuickIngestDialog({ onDocumentsUploaded }: QuickIngestDialogProps) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [activeTab, setActiveTab] = useState('text')

  // Text tab state
  const [textTitle, setTextTitle] = useState('')
  const [textContent, setTextContent] = useState('')
  const [textPrompt, setTextPrompt] = useState('')
  const [showTextPrompt, setShowTextPrompt] = useState(false)
  const [textLoading, setTextLoading] = useState(false)

  // Image tab state
  const [imageTitle, setImageTitle] = useState('')
  const [imageData, setImageData] = useState<string | null>(null)
  const [imageFile, setImageFile] = useState<File | null>(null)
  const [imagePrompt, setImagePrompt] = useState('')
  const [showImagePrompt, setShowImagePrompt] = useState(false)
  const [imageLoading, setImageLoading] = useState(false)

  const pasteAreaRef = useRef<HTMLDivElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Reset state when dialog closes
  useEffect(() => {
    if (!open) {
      setTextTitle('')
      setTextContent('')
      setTextPrompt('')
      setShowTextPrompt(false)
      setTextLoading(false)
      setImageTitle('')
      setImageData(null)
      setImageFile(null)
      setImagePrompt('')
      setShowImagePrompt(false)
      setImageLoading(false)
    }
  }, [open])

  const handleImageFromFile = useCallback((file: File) => {
    if (!file.type.startsWith('image/')) {
      toast.error(t('documentPanel.quickIngest.invalidImageType'))
      return
    }
    setImageFile(file)
    const reader = new FileReader()
    reader.onload = (e) => {
      setImageData(e.target?.result as string)
    }
    reader.readAsDataURL(file)
  }, [t])

  const handlePaste = useCallback(
    (e: React.ClipboardEvent) => {
      const items = e.clipboardData?.items
      if (!items) return

      for (let i = 0; i < items.length; i++) {
        if (items[i].type.startsWith('image/')) {
          e.preventDefault()
          const file = items[i].getAsFile()
          if (file) {
            const timestamp = new Date().toISOString().replace(/[:.]/g, '').slice(0, 15)
            const namedFile = new File([file], `clipboard_${timestamp}.png`, {
              type: file.type
            })
            handleImageFromFile(namedFile)
          }
          return
        }
      }
    },
    [handleImageFromFile]
  )

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault()
      e.stopPropagation()
      const files = e.dataTransfer?.files
      if (files && files.length > 0) {
        handleImageFromFile(files[0])
      }
    },
    [handleImageFromFile]
  )

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
  }, [])

  const clearImage = useCallback(() => {
    setImageData(null)
    setImageFile(null)
  }, [])

  const handleTextSubmit = useCallback(async () => {
    if (!textTitle.trim()) {
      toast.error(t('documentPanel.quickIngest.titleRequired'))
      return
    }
    if (!textContent.trim()) {
      toast.error(t('documentPanel.quickIngest.contentRequired'))
      return
    }

    setTextLoading(true)
    try {
      const response = await insertTextWithSource(textContent.trim(), textTitle.trim())
      if (response?.status === 'duplicated') {
        toast.warning(t('documentPanel.quickIngest.duplicateSource'))
      } else {
        toast.success(t('documentPanel.quickIngest.textSuccess'))
        await onDocumentsUploaded?.()
        setOpen(false)
      }
    } catch (err) {
      toast.error(
        t('documentPanel.quickIngest.textFailed', { error: errorMessage(err) })
      )
    } finally {
      setTextLoading(false)
    }
  }, [textTitle, textContent, textPrompt, onDocumentsUploaded, t])

  const handleImageSubmit = useCallback(async () => {
    if (!imageTitle.trim()) {
      toast.error(t('documentPanel.quickIngest.titleRequired'))
      return
    }
    if (!imageFile || !imageData) {
      toast.error(t('documentPanel.quickIngest.imageRequired'))
      return
    }

    setImageLoading(true)
    try {
      const response = await quickIngestImage(
        imageFile,
        imageTitle.trim(),
        imagePrompt.trim() || undefined,
      )

      if (response?.status === 'skipped') {
        toast.warning(response.message || 'Image skipped (decorative)')
      } else {
        toast.success(t('documentPanel.quickIngest.imageSuccess'))
        await onDocumentsUploaded?.()
        setOpen(false)
      }
    } catch (err) {
      toast.error(
        t('documentPanel.quickIngest.imageFailed', { error: errorMessage(err) })
      )
    } finally {
      setImageLoading(false)
    }
  }, [imageTitle, imageFile, imageData, onDocumentsUploaded, t])

  const handleFileInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0]
      if (file) {
        handleImageFromFile(file)
      }
      // Reset so the same file can be re-selected
      e.target.value = ''
    },
    [handleImageFromFile]
  )

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" tooltip={t('documentPanel.quickIngest.tooltip')}>
          <ZapIcon className="h-4 w-4" />
          {t('documentPanel.quickIngest.button')}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ZapIcon className="h-5 w-5" />
            {t('documentPanel.quickIngest.title')}
          </DialogTitle>
        </DialogHeader>

        {/* Tab buttons */}
        <div className="grid grid-cols-2 gap-1 p-1 bg-muted rounded-lg">
          <button
            type="button"
            className={cn(
              'flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-colors',
              activeTab === 'text' ? 'bg-background shadow-sm' : 'text-muted-foreground hover:text-foreground'
            )}
            onClick={() => setActiveTab('text')}
          >
            <TypeIcon className="h-4 w-4" />
            {t('documentPanel.quickIngest.textTab')}
          </button>
          <button
            type="button"
            className={cn(
              'flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-colors',
              activeTab === 'image' ? 'bg-background shadow-sm' : 'text-muted-foreground hover:text-foreground'
            )}
            onClick={() => setActiveTab('image')}
          >
            <ImageIcon className="h-4 w-4" />
            {t('documentPanel.quickIngest.imageTab')}
          </button>
        </div>

        {/* Text Input Tab */}
        {activeTab === 'text' && (
          <div className="space-y-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">
                {t('documentPanel.quickIngest.titleLabel')} <span className="text-destructive">*</span>
              </label>
              <Input
                value={textTitle}
                onChange={(e) => setTextTitle(e.target.value)}
                placeholder={t('documentPanel.quickIngest.titlePlaceholder')}
                disabled={textLoading}
              />
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">
                {t('documentPanel.quickIngest.contentLabel')} <span className="text-destructive">*</span>
              </label>
              <Textarea
                value={textContent}
                onChange={(e) => setTextContent(e.target.value)}
                placeholder={t('documentPanel.quickIngest.contentPlaceholder')}
                className="min-h-[200px]"
                disabled={textLoading}
              />
            </div>

            {/* Collapsible Custom Prompt */}
            <div className="border rounded-md">
              <button
                type="button"
                className="w-full flex items-center justify-between px-3 py-2 text-sm font-medium hover:bg-accent rounded-md"
                onClick={() => setShowTextPrompt(!showTextPrompt)}
              >
                {t('documentPanel.quickIngest.customPrompt')}
                {showTextPrompt ? (
                  <ChevronUpIcon className="h-4 w-4" />
                ) : (
                  <ChevronDownIcon className="h-4 w-4" />
                )}
              </button>
              {showTextPrompt && (
                <div className="px-3 pb-3">
                  <Textarea
                    value={textPrompt}
                    onChange={(e) => setTextPrompt(e.target.value)}
                    placeholder={t('documentPanel.quickIngest.customPromptPlaceholder')}
                    className="min-h-[80px]"
                    disabled={textLoading}
                  />
                </div>
              )}
            </div>

            <DialogFooter>
              <Button
                onClick={handleTextSubmit}
                disabled={textLoading || !textTitle.trim() || !textContent.trim()}
              >
                {textLoading ? (
                  <>
                    <Loader2Icon className="h-4 w-4 animate-spin" />
                    {t('documentPanel.quickIngest.processing')}
                  </>
                ) : (
                  <>
                    <ZapIcon className="h-4 w-4" />
                    {t('documentPanel.quickIngest.ingest')}
                  </>
                )}
              </Button>
            </DialogFooter>
          </div>
        )}

        {/* Image Paste Tab */}
        {activeTab === 'image' && (
          <div className="space-y-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">
                {t('documentPanel.quickIngest.titleLabel')} <span className="text-destructive">*</span>
              </label>
              <Input
                value={imageTitle}
                onChange={(e) => setImageTitle(e.target.value)}
                placeholder={t('documentPanel.quickIngest.imageTitlePlaceholder')}
                disabled={imageLoading}
              />
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">
                {t('documentPanel.quickIngest.imageLabel')} <span className="text-destructive">*</span>
              </label>

              {imageData ? (
                <div className="relative border rounded-md p-2">
                  <button
                    type="button"
                    className="absolute top-2 right-2 p-1 bg-background/80 rounded-full hover:bg-destructive hover:text-destructive-foreground transition-colors"
                    onClick={clearImage}
                  >
                    <XIcon className="h-4 w-4" />
                  </button>
                  <img
                    src={imageData}
                    alt="Preview"
                    className="max-h-[300px] w-full object-contain rounded"
                  />
                </div>
              ) : (
                <div
                  ref={pasteAreaRef}
                  tabIndex={0}
                  onPaste={handlePaste}
                  onDrop={handleDrop}
                  onDragOver={handleDragOver}
                  onClick={() => fileInputRef.current?.click()}
                  className="flex flex-col items-center justify-center min-h-[200px] border-2 border-dashed rounded-md cursor-pointer hover:border-primary/50 hover:bg-accent/50 transition-colors focus:outline-none focus:ring-2 focus:ring-ring"
                >
                  <ImageIcon className="h-10 w-10 text-muted-foreground mb-2" />
                  <p className="text-sm text-muted-foreground text-center px-4">
                    {t('documentPanel.quickIngest.pasteHint')}
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">
                    {t('documentPanel.quickIngest.pasteHintSub')}
                  </p>
                </div>
              )}
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={handleFileInputChange}
              />
            </div>

            {/* Collapsible Image Prompt */}
            <div className="border rounded-md">
              <button
                type="button"
                className="w-full flex items-center justify-between px-3 py-2 text-sm font-medium hover:bg-accent rounded-md"
                onClick={() => setShowImagePrompt(!showImagePrompt)}
              >
                {t('documentPanel.quickIngest.imagePromptTitle')}
                {showImagePrompt ? (
                  <ChevronUpIcon className="h-4 w-4" />
                ) : (
                  <ChevronDownIcon className="h-4 w-4" />
                )}
              </button>
              {showImagePrompt && (
                <div className="px-3 pb-3">
                  <Textarea
                    value={imagePrompt}
                    onChange={(e) => setImagePrompt(e.target.value)}
                    placeholder={t('documentPanel.quickIngest.imagePromptPlaceholder')}
                    className="min-h-[80px]"
                    disabled={imageLoading}
                  />
                </div>
              )}
            </div>

            <DialogFooter>
              <Button
                onClick={handleImageSubmit}
                disabled={imageLoading || !imageTitle.trim() || !imageData}
              >
                {imageLoading ? (
                  <>
                    <Loader2Icon className="h-4 w-4 animate-spin" />
                    {t('documentPanel.quickIngest.processing')}
                  </>
                ) : (
                  <>
                    <ZapIcon className="h-4 w-4" />
                    {t('documentPanel.quickIngest.ingest')}
                  </>
                )}
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}

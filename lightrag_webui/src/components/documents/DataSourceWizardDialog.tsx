import { useCallback, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import {
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  FileText,
  FolderSearch,
  ImageIcon,
  LayoutList,
  LinkIcon,
  Loader2,
  MessageSquareText,
  ScanSearch,
  Sparkles,
  Type,
  Upload,
  X,
} from 'lucide-react'

import Button from '@/components/ui/Button'
import Badge from '@/components/ui/Badge'
import Checkbox from '@/components/ui/Checkbox'
import Input from '@/components/ui/Input'
import Progress from '@/components/ui/Progress'
import Textarea from '@/components/ui/Textarea'
import { Label } from '@/components/ui/Label'
import {
  Dialog,
  DialogContent,
  DialogDescription,
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
import {
  ingestUrl,
  ingestUrlBatch,
  insertTextWithSource,
  processMultimodal,
  quickIngestImage,
  scanNewDocuments,
  uploadDocument,
  validateUrl,
  URLValidateResponse,
} from '@/api/lightrag'
import { cn, errorMessage } from '@/lib/utils'
import TaskProgressPanel from './TaskProgressPanel'
import BoardIngestDialog from './BoardIngestDialog'

interface DataSourceWizardDialogProps {
  onDocumentsUploaded?: () => Promise<void>
}

type SourceType = 'file' | 'text' | 'image' | 'url' | 'board' | 'scan'
type FileMode = 'standard' | 'multimodal'
type UrlMode = 'single' | 'batch'
type ParserType = 'docling' | 'pymupdf'

type TaskRef = {
  taskId: string
  label: string
}

const MULTIMODAL_EXTENSIONS = ['.pdf', '.docx', '.pptx', '.xlsx']

const getFileExtension = (fileName: string) => {
  const idx = fileName.lastIndexOf('.')
  return idx >= 0 ? fileName.slice(idx).toLowerCase() : ''
}

const compactLabel = (label: string, max = 54) =>
  label.length > max ? `${label.slice(0, max - 3)}...` : label

const checkedValue = (value: boolean | 'indeterminate') => value === true

export default function DataSourceWizardDialog({ onDocumentsUploaded }: DataSourceWizardDialogProps) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [source, setSource] = useState<SourceType>('file')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [taskRefs, setTaskRefs] = useState<TaskRef[]>([])
  const [uploadProgress, setUploadProgress] = useState<Record<string, number>>({})
  const [resultNote, setResultNote] = useState<string | null>(null)
  const [showAdvanced, setShowAdvanced] = useState(false)

  const [files, setFiles] = useState<File[]>([])
  const [fileMode, setFileMode] = useState<FileMode>('standard')
  const [parser, setParser] = useState<ParserType>('docling')
  const [processImages, setProcessImages] = useState(true)
  const [processTables, setProcessTables] = useState(true)
  const [processEquations, setProcessEquations] = useState(true)
  const [filePathLabel, setFilePathLabel] = useState('')
  const [pdfPassword, setPdfPassword] = useState('')

  const [textTitle, setTextTitle] = useState('')
  const [textContent, setTextContent] = useState('')

  const [imageFile, setImageFile] = useState<File | null>(null)
  const [imagePreview, setImagePreview] = useState<string | null>(null)
  const [imageTitle, setImageTitle] = useState('')

  const [urlMode, setUrlMode] = useState<UrlMode>('single')
  const [singleUrl, setSingleUrl] = useState('')
  const [batchUrls, setBatchUrls] = useState('')
  const [urlValidation, setUrlValidation] = useState<URLValidateResponse | null>(null)
  const [skipDuplicates, setSkipDuplicates] = useState(true)
  const [forceReindex, setForceReindex] = useState(false)
  const [followLinks, setFollowLinks] = useState(false)
  const [maxDepth, setMaxDepth] = useState(1)

  const [documentPrompt, setDocumentPrompt] = useState('')
  const [imagePrompt, setImagePrompt] = useState('')
  const [tablePrompt, setTablePrompt] = useState('')

  const fileInputRef = useRef<HTMLInputElement>(null)
  const imageInputRef = useRef<HTMLInputElement>(null)

  const sourceItems = useMemo(() => [
    {
      id: 'file' as const,
      icon: Upload,
      title: t('documentPanel.dataWizard.sources.file.title', '파일'),
      desc: t('documentPanel.dataWizard.sources.file.desc', '일반 업로드 또는 PDF/Office 멀티모달 처리'),
    },
    {
      id: 'text' as const,
      icon: Type,
      title: t('documentPanel.dataWizard.sources.text.title', '빠른 입력'),
      desc: t('documentPanel.dataWizard.sources.text.desc', '짧은 텍스트를 바로 지식화'),
    },
    {
      id: 'image' as const,
      icon: ImageIcon,
      title: t('documentPanel.dataWizard.sources.image.title', '이미지'),
      desc: t('documentPanel.dataWizard.sources.image.desc', '이미지와 설명 프롬프트로 빠른 지식화'),
    },
    {
      id: 'url' as const,
      icon: LinkIcon,
      title: t('documentPanel.dataWizard.sources.url.title', 'URL'),
      desc: t('documentPanel.dataWizard.sources.url.desc', '단일/배치 웹 페이지 수집'),
    },
    {
      id: 'board' as const,
      icon: LayoutList,
      title: t('documentPanel.dataWizard.sources.board.title', '게시판/API'),
      desc: t('documentPanel.dataWizard.sources.board.desc', '목록 API 탐색, 필드 매핑, 첨부 처리'),
    },
    {
      id: 'scan' as const,
      icon: FolderSearch,
      title: t('documentPanel.dataWizard.sources.scan.title', '입력 폴더 스캔'),
      desc: t('documentPanel.dataWizard.sources.scan.desc', '서버 input 디렉터리의 새 파일 처리'),
    },
  ], [t])

  const resetTransientState = useCallback(() => {
    setIsSubmitting(false)
    setTaskRefs([])
    setUploadProgress({})
    setResultNote(null)
    setUrlValidation(null)
  }, [])

  const registerTask = useCallback((taskId: string | undefined, label: string) => {
    if (!taskId) return
    setTaskRefs((prev) => {
      if (prev.some((task) => task.taskId === taskId)) return prev
      return [...prev, { taskId, label }]
    })
  }, [])

  const notifyDocumentsChanged = useCallback(async () => {
    await onDocumentsUploaded?.()
  }, [onDocumentsUploaded])

  const handleOpenChange = useCallback((nextOpen: boolean) => {
    setOpen(nextOpen)
    if (!nextOpen && taskRefs.length === 0) {
      resetTransientState()
    }
  }, [resetTransientState, taskRefs.length])

  const handleFileSelection = useCallback((selected: FileList | null) => {
    const nextFiles = Array.from(selected || [])
    setFiles(nextFiles)
    setUploadProgress({})
    if (nextFiles.some((file) => MULTIMODAL_EXTENSIONS.includes(getFileExtension(file.name)))) {
      setFileMode('multimodal')
    }
  }, [])

  const removeFile = useCallback((fileName: string) => {
    setFiles((prev) => prev.filter((file) => file.name !== fileName))
    setUploadProgress((prev) => {
      const next = { ...prev }
      delete next[fileName]
      return next
    })
  }, [])

  const handleImageSelection = useCallback((file: File | null) => {
    setImageFile(file)
    setImagePreview(file ? URL.createObjectURL(file) : null)
    if (file && !imageTitle.trim()) {
      setImageTitle(file.name.replace(/\.[^.]+$/, ''))
    }
  }, [imageTitle])

  const handleImagePaste = useCallback((event: React.ClipboardEvent<HTMLDivElement>) => {
    const pastedFile = Array.from(event.clipboardData.files || []).find((file) => file.type.startsWith('image/'))
    if (pastedFile) {
      handleImageSelection(pastedFile)
      toast.success(t('documentPanel.dataWizard.image.pasted', '이미지를 붙여넣었습니다.'))
    }
  }, [handleImageSelection, t])

  const handleValidateUrl = useCallback(async () => {
    if (!singleUrl.trim()) return
    setIsSubmitting(true)
    try {
      const result = await validateUrl(singleUrl.trim())
      setUrlValidation(result)
      toast.success(t('documentPanel.dataWizard.url.validated', 'URL을 확인했습니다.'))
    } catch (err) {
      setUrlValidation(null)
      toast.error(errorMessage(err))
    } finally {
      setIsSubmitting(false)
    }
  }, [singleUrl, t])

  const buildPromptOptions = useCallback(() => ({
    document_prompt: documentPrompt.trim() || undefined,
    image_prompt: imagePrompt.trim() || undefined,
    table_prompt: tablePrompt.trim() || undefined,
  }), [documentPrompt, imagePrompt, tablePrompt])

  const handleRunFile = useCallback(async () => {
    if (files.length === 0) {
      toast.error(t('documentPanel.dataWizard.file.noFiles', '처리할 파일을 선택해 주세요.'))
      return
    }
    setIsSubmitting(true)
    setResultNote(null)
    try {
      for (const file of files) {
        if (fileMode === 'multimodal') {
          const result = await processMultimodal(
            file,
            {
              parser,
              process_images: processImages,
              process_tables: processTables,
              process_equations: processEquations,
              file_path_label: filePathLabel.trim() || undefined,
              pdf_password: pdfPassword.trim() || undefined,
              ...buildPromptOptions(),
            },
            (percent) => setUploadProgress((prev) => ({ ...prev, [file.name]: percent }))
          )
          registerTask(result.task_id, file.name)
        } else {
          const result = await uploadDocument(file, (percent) => {
            setUploadProgress((prev) => ({ ...prev, [file.name]: percent }))
          })
          registerTask(result.task_id, file.name)
          if (!result.task_id) {
            setResultNote(result.message)
          }
        }
      }
      toast.success(t('documentPanel.dataWizard.started', '지식화 작업을 시작했습니다.'))
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setIsSubmitting(false)
    }
  }, [
    buildPromptOptions,
    fileMode,
    filePathLabel,
    files,
    parser,
    pdfPassword,
    processEquations,
    processImages,
    processTables,
    registerTask,
    t,
  ])

  const handleRunText = useCallback(async () => {
    if (!textContent.trim()) {
      toast.error(t('documentPanel.dataWizard.text.empty', '입력할 텍스트를 작성해 주세요.'))
      return
    }
    setIsSubmitting(true)
    setResultNote(null)
    try {
      const result = await insertTextWithSource(textContent.trim(), textTitle.trim() || undefined)
      registerTask(result.task_id, textTitle.trim() || t('documentPanel.dataWizard.sources.text.title', '빠른 입력'))
      if (!result.task_id) setResultNote(result.message)
      toast.success(result.message || t('documentPanel.dataWizard.started', '지식화 작업을 시작했습니다.'))
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setIsSubmitting(false)
    }
  }, [registerTask, t, textContent, textTitle])

  const handleRunImage = useCallback(async () => {
    if (!imageFile) {
      toast.error(t('documentPanel.dataWizard.image.noFile', '처리할 이미지를 선택해 주세요.'))
      return
    }
    setIsSubmitting(true)
    setResultNote(null)
    try {
      const result = await quickIngestImage(
        imageFile,
        imageTitle.trim() || imageFile.name,
        imagePrompt.trim() || undefined
      )
      setResultNote(result.message)
      await notifyDocumentsChanged()
      toast.success(result.message)
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setIsSubmitting(false)
    }
  }, [imageFile, imagePrompt, imageTitle, notifyDocumentsChanged, t])

  const handleRunUrl = useCallback(async () => {
    setIsSubmitting(true)
    setResultNote(null)
    try {
      const promptOptions = buildPromptOptions()
      if (urlMode === 'single') {
        if (!singleUrl.trim()) {
          toast.error(t('documentPanel.dataWizard.url.empty', '수집할 URL을 입력해 주세요.'))
          return
        }
        const result = await ingestUrl({
          url: singleUrl.trim(),
          process_images: processImages,
          process_tables: processTables,
          skip_duplicates: skipDuplicates,
          force_reindex: forceReindex,
          follow_links: followLinks,
          max_depth: followLinks ? maxDepth : undefined,
          ...promptOptions,
        })
        registerTask(result.task_id, singleUrl.trim())
        toast.success(result.message)
      } else {
        const urls = batchUrls
          .split('\n')
          .map((url) => url.trim())
          .filter(Boolean)
        if (urls.length === 0) {
          toast.error(t('documentPanel.dataWizard.url.emptyBatch', '수집할 URL 목록을 입력해 주세요.'))
          return
        }
        const result = await ingestUrlBatch({
          urls,
          process_images: processImages,
          process_tables: processTables,
          skip_duplicates: skipDuplicates,
          force_reindex: forceReindex,
          follow_links: followLinks,
          max_depth: followLinks ? maxDepth : undefined,
          ...promptOptions,
        })
        result.tasks.forEach((task) => registerTask(task.task_id, task.url))
        setResultNote(t(
          'documentPanel.dataWizard.url.batchResult',
          '{{submitted}}건 제출, {{skipped}}건 제외',
          { submitted: result.total_submitted, skipped: result.total_skipped }
        ))
        toast.success(t(
          'documentPanel.dataWizard.url.batchStarted',
          '{{count}}개의 URL 지식화 작업을 시작했습니다.',
          { count: result.total_submitted }
        ))
      }
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setIsSubmitting(false)
    }
  }, [
    batchUrls,
    buildPromptOptions,
    followLinks,
    forceReindex,
    maxDepth,
    processImages,
    processTables,
    registerTask,
    singleUrl,
    skipDuplicates,
    t,
    urlMode,
  ])

  const handleRunScan = useCallback(async () => {
    setIsSubmitting(true)
    setResultNote(null)
    try {
      const result = await scanNewDocuments()
      registerTask(result.task_id, t('documentPanel.dataWizard.sources.scan.title', '입력 폴더 스캔'))
      if (!result.task_id) setResultNote(result.message)
      toast.success(result.message)
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setIsSubmitting(false)
    }
  }, [registerTask, t])

  const hasTasks = taskRefs.length > 0

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button variant="default" side="bottom" tooltip={t('documentPanel.dataWizard.tooltip', '데이터 소스를 선택하고 지식화 작업을 시작합니다.')} size="sm">
          <Sparkles className="h-4 w-4" />
          {t('documentPanel.dataWizard.button', '데이터 추가')}
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-6xl max-h-[88vh] overflow-y-auto" onCloseAutoFocus={(event) => event.preventDefault()}>
        <DialogHeader>
          <DialogTitle>{t('documentPanel.dataWizard.title', '데이터 추가 위저드')}</DialogTitle>
          <DialogDescription>
            {t('documentPanel.dataWizard.description', '데이터 소스를 선택하고 처리 방식, 검증, 실행, 진행상황 확인을 한 흐름에서 진행합니다.')}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 lg:grid-cols-[280px_1fr]">
          <div className="space-y-2">
            {sourceItems.map((item) => {
              const Icon = item.icon
              const selected = source === item.id
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => {
                    setSource(item.id)
                    setResultNote(null)
                    setUrlValidation(null)
                  }}
                  className={cn(
                    'w-full rounded-md border p-3 text-left transition-colors hover:bg-accent',
                    selected ? 'border-primary bg-primary/5 shadow-sm' : 'border-border bg-background'
                  )}
                >
                  <div className="flex items-start gap-3">
                    <Icon className={cn('mt-0.5 h-4 w-4', selected ? 'text-primary' : 'text-muted-foreground')} />
                    <div className="min-w-0">
                      <div className="text-sm font-medium">{item.title}</div>
                      <div className="mt-1 text-xs leading-5 text-muted-foreground">{item.desc}</div>
                    </div>
                  </div>
                </button>
              )
            })}
          </div>

          <div className="min-w-0 space-y-4">
            {source === 'file' && (
              <section className="space-y-4">
                <SectionHeader
                  icon={Upload}
                  title={t('documentPanel.dataWizard.file.title', '파일 지식화')}
                  description={t('documentPanel.dataWizard.file.description', '일반 문서 업로드와 Docling/PyMuPDF 기반 멀티모달 처리를 선택할 수 있습니다.')}
                />

                <div className="grid gap-3 md:grid-cols-2">
                  <button
                    type="button"
                    className={cn('rounded-md border p-3 text-left', fileMode === 'standard' ? 'border-primary bg-primary/5' : 'hover:bg-accent')}
                    onClick={() => setFileMode('standard')}
                  >
                    <div className="flex items-center gap-2 text-sm font-medium">
                      <FileText className="h-4 w-4" />
                      {t('documentPanel.dataWizard.file.standard', '일반 업로드')}
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {t('documentPanel.dataWizard.file.standardDesc', '기존 /documents/upload 경로로 파일을 등록합니다.')}
                    </p>
                  </button>
                  <button
                    type="button"
                    className={cn('rounded-md border p-3 text-left', fileMode === 'multimodal' ? 'border-primary bg-primary/5' : 'hover:bg-accent')}
                    onClick={() => setFileMode('multimodal')}
                  >
                    <div className="flex items-center gap-2 text-sm font-medium">
                      <ScanSearch className="h-4 w-4" />
                      {t('documentPanel.dataWizard.file.multimodal', '멀티모달 처리')}
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {t('documentPanel.dataWizard.file.multimodalDesc', 'PDF/Office 문서의 이미지, 표, 수식을 구조화합니다.')}
                    </p>
                  </button>
                </div>

                <input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  className="hidden"
                  onChange={(event) => handleFileSelection(event.target.files)}
                />
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="flex min-h-28 w-full flex-col items-center justify-center rounded-md border border-dashed p-4 text-center hover:bg-accent"
                >
                  <Upload className="mb-2 h-6 w-6 text-muted-foreground" />
                  <span className="text-sm font-medium">{t('documentPanel.dataWizard.file.dropLabel', '파일 선택')}</span>
                  <span className="mt-1 text-xs text-muted-foreground">
                    {t('documentPanel.dataWizard.file.dropHint', '여러 파일을 선택할 수 있습니다.')}
                  </span>
                </button>

                {files.length > 0 && (
                  <div className="space-y-2">
                    {files.map((file) => (
                      <div key={file.name} className="rounded-md border p-3">
                        <div className="flex items-center justify-between gap-3">
                          <div className="min-w-0">
                            <div className="truncate text-sm font-medium">{file.name}</div>
                            <div className="text-xs text-muted-foreground">{(file.size / 1024 / 1024).toFixed(2)} MB</div>
                          </div>
                          <Button variant="ghost" size="icon" onClick={() => removeFile(file.name)} tooltip={t('common.remove', 'Remove')}>
                            <X className="h-4 w-4" />
                          </Button>
                        </div>
                        {uploadProgress[file.name] !== undefined && (
                          <div className="mt-2 space-y-1">
                            <Progress value={uploadProgress[file.name]} className="h-2" />
                            <div className="text-right text-xs text-muted-foreground">{uploadProgress[file.name]}%</div>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}

                {fileMode === 'multimodal' && (
                  <div className="space-y-3 rounded-md border p-3">
                    <div className="grid gap-3 md:grid-cols-2">
                      <div>
                        <Label>{t('documentPanel.dataWizard.file.parser', '파서')}</Label>
                        <Select value={parser} onValueChange={(value) => setParser(value as ParserType)}>
                          <SelectTrigger className="mt-1">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="docling">Docling</SelectItem>
                            <SelectItem value="pymupdf">PyMuPDF</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div>
                        <Label>{t('documentPanel.dataWizard.file.label', '파일 경로 라벨')}</Label>
                        <Input
                          className="mt-1"
                          value={filePathLabel}
                          onChange={(event) => setFilePathLabel(event.target.value)}
                          placeholder="manuals/service-guide.pdf"
                        />
                      </div>
                    </div>
                    <div className="grid gap-2 md:grid-cols-3">
                      <CheckboxRow checked={processImages} onCheckedChange={setProcessImages} label={t('documentPanel.dataWizard.processImages', '이미지 처리')} />
                      <CheckboxRow checked={processTables} onCheckedChange={setProcessTables} label={t('documentPanel.dataWizard.processTables', '표 처리')} />
                      <CheckboxRow checked={processEquations} onCheckedChange={setProcessEquations} label={t('documentPanel.dataWizard.processEquations', '수식 처리')} />
                    </div>
                    <div>
                      <Label>{t('documentPanel.dataWizard.file.pdfPassword', 'PDF 비밀번호')}</Label>
                      <Input
                        className="mt-1"
                        type="password"
                        value={pdfPassword}
                        onChange={(event) => setPdfPassword(event.target.value)}
                        placeholder={t('documentPanel.dataWizard.optional', '선택 사항')}
                      />
                    </div>
                  </div>
                )}

                <PromptOptions
                  open={showAdvanced}
                  onOpenChange={setShowAdvanced}
                  documentPrompt={documentPrompt}
                  imagePrompt={imagePrompt}
                  tablePrompt={tablePrompt}
                  onDocumentPromptChange={setDocumentPrompt}
                  onImagePromptChange={setImagePrompt}
                  onTablePromptChange={setTablePrompt}
                />

                <ActionBar
                  isSubmitting={isSubmitting}
                  onRun={handleRunFile}
                  runLabel={t('documentPanel.dataWizard.execute', '실행')}
                />
              </section>
            )}

            {source === 'text' && (
              <section className="space-y-4">
                <SectionHeader
                  icon={MessageSquareText}
                  title={t('documentPanel.dataWizard.text.title', '빠른 텍스트 입력')}
                  description={t('documentPanel.dataWizard.text.description', '짧은 정의, 운영 메모, 테스트 데이터를 바로 지식화합니다.')}
                />
                <div className="space-y-3">
                  <div>
                    <Label>{t('documentPanel.dataWizard.text.sourceName', '소스 이름')}</Label>
                    <Input
                      className="mt-1"
                      value={textTitle}
                      onChange={(event) => setTextTitle(event.target.value)}
                      placeholder="quick-note-20260517"
                    />
                  </div>
                  <div>
                    <Label>{t('documentPanel.dataWizard.text.content', '내용')}</Label>
                    <Textarea
                      className="mt-1 min-h-52"
                      value={textContent}
                      onChange={(event) => setTextContent(event.target.value)}
                      placeholder={t('documentPanel.dataWizard.text.placeholder', '지식화할 텍스트를 입력하세요.')}
                    />
                  </div>
                </div>
                <ActionBar
                  isSubmitting={isSubmitting}
                  onRun={handleRunText}
                  runLabel={t('documentPanel.dataWizard.execute', '실행')}
                />
              </section>
            )}

            {source === 'image' && (
              <section className="space-y-4">
                <SectionHeader
                  icon={ImageIcon}
                  title={t('documentPanel.dataWizard.image.title', '이미지 빠른 지식화')}
                  description={t('documentPanel.dataWizard.image.description', '이미지를 업로드하거나 붙여넣고, 필요한 경우 분석 프롬프트를 함께 전달합니다.')}
                />
                <input
                  ref={imageInputRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(event) => handleImageSelection(event.target.files?.[0] || null)}
                />
                <div
                  className="rounded-md border border-dashed p-4"
                  tabIndex={0}
                  onPaste={handleImagePaste}
                  onClick={() => imageInputRef.current?.click()}
                >
                  {imagePreview ? (
                    <div className="grid gap-4 md:grid-cols-[220px_1fr]">
                      <img src={imagePreview} alt="" className="h-40 w-full rounded-md object-cover" />
                      <div className="space-y-3">
                        <div>
                          <Label>{t('documentPanel.dataWizard.image.sourceName', '이미지 소스 이름')}</Label>
                          <Input
                            className="mt-1"
                            value={imageTitle}
                            onClick={(event) => event.stopPropagation()}
                            onChange={(event) => setImageTitle(event.target.value)}
                          />
                        </div>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={(event) => {
                            event.stopPropagation()
                            handleImageSelection(null)
                          }}
                        >
                          <X className="h-4 w-4" />
                          {t('common.remove', 'Remove')}
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex min-h-40 flex-col items-center justify-center text-center">
                      <ImageIcon className="mb-2 h-6 w-6 text-muted-foreground" />
                      <div className="text-sm font-medium">{t('documentPanel.dataWizard.image.pick', '이미지 선택 또는 붙여넣기')}</div>
                      <div className="mt-1 text-xs text-muted-foreground">{t('documentPanel.dataWizard.image.pickHint', '웹 이미지 파일을 내려받은 뒤 이 영역에 붙여넣거나 선택할 수 있습니다.')}</div>
                    </div>
                  )}
                </div>
                <div>
                  <Label>{t('documentPanel.dataWizard.image.prompt', '이미지 분석 프롬프트')}</Label>
                  <Textarea
                    className="mt-1 min-h-28"
                    value={imagePrompt}
                    onChange={(event) => setImagePrompt(event.target.value)}
                    placeholder={t('documentPanel.dataWizard.optional', '선택 사항')}
                  />
                </div>
                <ActionBar
                  isSubmitting={isSubmitting}
                  onRun={handleRunImage}
                  runLabel={t('documentPanel.dataWizard.execute', '실행')}
                />
              </section>
            )}

            {source === 'url' && (
              <section className="space-y-4">
                <SectionHeader
                  icon={LinkIcon}
                  title={t('documentPanel.dataWizard.url.title', 'URL 지식화')}
                  description={t('documentPanel.dataWizard.url.description', '단일 URL 검증 후 수집하거나 여러 URL을 배치로 제출합니다.')}
                />
                <div className="flex gap-2">
                  <Button variant={urlMode === 'single' ? 'default' : 'outline'} size="sm" onClick={() => setUrlMode('single')}>
                    {t('documentPanel.dataWizard.url.single', '단일 URL')}
                  </Button>
                  <Button variant={urlMode === 'batch' ? 'default' : 'outline'} size="sm" onClick={() => setUrlMode('batch')}>
                    {t('documentPanel.dataWizard.url.batch', '배치 URL')}
                  </Button>
                </div>

                {urlMode === 'single' ? (
                  <div className="space-y-2">
                    <Label>{t('documentPanel.dataWizard.url.url', 'URL')}</Label>
                    <div className="flex gap-2">
                      <Input
                        value={singleUrl}
                        onChange={(event) => {
                          setSingleUrl(event.target.value)
                          setUrlValidation(null)
                        }}
                        placeholder="https://example.com/docs"
                      />
                      <Button variant="outline" onClick={handleValidateUrl} disabled={isSubmitting || !singleUrl.trim()}>
                        {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                        {t('documentPanel.dataWizard.url.validate', '검증')}
                      </Button>
                    </div>
                    {urlValidation && (
                      <div className="rounded-md border bg-muted/30 p-3 text-sm">
                        <div className="flex items-center gap-2">
                          <Badge variant={urlValidation.valid ? 'secondary' : 'destructive'}>
                            {urlValidation.valid ? t('documentPanel.dataWizard.url.valid', '유효') : t('documentPanel.dataWizard.url.invalid', '오류')}
                          </Badge>
                          <span className="truncate font-mono text-xs">{urlValidation.normalized_url}</span>
                        </div>
                        <div className="mt-2 grid gap-1 text-xs text-muted-foreground md:grid-cols-2">
                          <span>domain: {urlValidation.domain}</span>
                          <span>doc_id: {urlValidation.doc_id}</span>
                        </div>
                      </div>
                    )}
                  </div>
                ) : (
                  <div>
                    <Label>{t('documentPanel.dataWizard.url.urls', 'URL 목록')}</Label>
                    <Textarea
                      className="mt-1 min-h-44 font-mono text-xs"
                      value={batchUrls}
                      onChange={(event) => setBatchUrls(event.target.value)}
                      placeholder={'https://example.com/a\nhttps://example.com/b'}
                    />
                  </div>
                )}

                <div className="grid gap-2 md:grid-cols-2">
                  <CheckboxRow checked={processImages} onCheckedChange={setProcessImages} label={t('documentPanel.dataWizard.processImages', '이미지 처리')} />
                  <CheckboxRow checked={processTables} onCheckedChange={setProcessTables} label={t('documentPanel.dataWizard.processTables', '표 처리')} />
                  <CheckboxRow checked={skipDuplicates} onCheckedChange={setSkipDuplicates} label={t('documentPanel.dataWizard.url.skipDuplicates', '중복 건너뛰기')} />
                  <CheckboxRow checked={forceReindex} onCheckedChange={setForceReindex} label={t('documentPanel.dataWizard.url.forceReindex', '강제 재색인')} />
                  <CheckboxRow checked={followLinks} onCheckedChange={setFollowLinks} label={t('documentPanel.dataWizard.url.followLinks', '링크 추적')} />
                  {followLinks && (
                    <div>
                      <Label>{t('documentPanel.dataWizard.url.maxDepth', '최대 깊이')}</Label>
                      <Input
                        className="mt-1"
                        type="number"
                        min={1}
                        max={5}
                        value={maxDepth}
                        onChange={(event) => setMaxDepth(Number(event.target.value) || 1)}
                      />
                    </div>
                  )}
                </div>

                <PromptOptions
                  open={showAdvanced}
                  onOpenChange={setShowAdvanced}
                  documentPrompt={documentPrompt}
                  imagePrompt={imagePrompt}
                  tablePrompt={tablePrompt}
                  onDocumentPromptChange={setDocumentPrompt}
                  onImagePromptChange={setImagePrompt}
                  onTablePromptChange={setTablePrompt}
                />

                <ActionBar
                  isSubmitting={isSubmitting}
                  onRun={handleRunUrl}
                  runLabel={t('documentPanel.dataWizard.execute', '실행')}
                />
              </section>
            )}

            {source === 'board' && (
              <section className="space-y-4">
                <SectionHeader
                  icon={LayoutList}
                  title={t('documentPanel.dataWizard.board.title', '게시판/API 지식화')}
                  description={t('documentPanel.dataWizard.board.description', 'API 탐색, 필드 매핑, 첨부 문서 처리는 기존 전용 마법사를 같은 데이터 추가 흐름에서 실행합니다.')}
                />
                <div className="rounded-md border p-4">
                  <div className="flex items-start gap-3">
                    <AlertCircle className="mt-0.5 h-4 w-4 text-amber-500" />
                    <div className="space-y-2 text-sm">
                      <p>{t('documentPanel.dataWizard.board.note', '게시판/API는 목록 구조와 페이지네이션 매핑이 필요하므로 전용 매핑 마법사로 이어집니다.')}</p>
                      <p className="text-muted-foreground">
                        {t('documentPanel.dataWizard.board.next', '다음 단계에서는 이 화면 안에서 API 연결, 필드 매핑, 실행까지 완전히 포함하도록 더 통합할 수 있습니다.')}
                      </p>
                    </div>
                  </div>
                  <div className="mt-4">
                    <BoardIngestDialog onDocumentsUploaded={onDocumentsUploaded} />
                  </div>
                </div>
              </section>
            )}

            {source === 'scan' && (
              <section className="space-y-4">
                <SectionHeader
                  icon={FolderSearch}
                  title={t('documentPanel.dataWizard.scan.title', '입력 폴더 스캔')}
                  description={t('documentPanel.dataWizard.scan.description', '서버 input 디렉터리에 새로 들어온 파일을 찾아 지식화 태스크를 시작합니다.')}
                />
                <div className="rounded-md border bg-muted/20 p-4 text-sm text-muted-foreground">
                  {t('documentPanel.dataWizard.scan.hint', '이 작업은 서버가 접근 가능한 입력 폴더를 기준으로 동작합니다. 로컬 브라우저에서 파일을 선택하려면 파일 소스를 사용하세요.')}
                </div>
                <ActionBar
                  isSubmitting={isSubmitting}
                  onRun={handleRunScan}
                  runLabel={t('documentPanel.dataWizard.scan.run', '스캔 시작')}
                />
              </section>
            )}

            {(resultNote || hasTasks) && (
              <div className="space-y-3 rounded-md border p-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2 text-sm font-medium">
                    <CheckCircle2 className="h-4 w-4 text-green-600" />
                    {t('documentPanel.dataWizard.progress.title', '실행 결과 및 진행상황')}
                  </div>
                  {hasTasks && (
                    <Button variant="outline" size="sm" onClick={resetTransientState}>
                      {t('documentPanel.dataWizard.progress.clear', '새 작업 준비')}
                    </Button>
                  )}
                </div>
                {resultNote && (
                  <div className="rounded-md bg-muted/40 p-3 text-sm text-muted-foreground">
                    {resultNote}
                  </div>
                )}
                {taskRefs.map((task) => (
                  <div key={task.taskId} className="rounded-md border p-3">
                    <div className="mb-2 flex items-center justify-between gap-2">
                      <span className="truncate text-sm font-medium">{compactLabel(task.label)}</span>
                      <Badge variant="outline" className="font-mono">{task.taskId.slice(0, 8)}</Badge>
                    </div>
                    <TaskProgressPanel
                      taskId={task.taskId}
                      onComplete={notifyDocumentsChanged}
                      compact
                    />
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

function SectionHeader({
  icon: Icon,
  title,
  description,
}: {
  icon: typeof Upload
  title: string
  description: string
}) {
  return (
    <div className="flex items-start gap-3">
      <div className="rounded-md border bg-muted/40 p-2">
        <Icon className="h-4 w-4" />
      </div>
      <div>
        <h3 className="text-base font-semibold">{title}</h3>
        <p className="mt-1 text-sm text-muted-foreground">{description}</p>
      </div>
    </div>
  )
}

function CheckboxRow({
  checked,
  onCheckedChange,
  label,
}: {
  checked: boolean
  onCheckedChange: (checked: boolean) => void
  label: string
}) {
  return (
    <label className="flex items-center gap-2 rounded-md border p-3 text-sm">
      <Checkbox checked={checked} onCheckedChange={(value) => onCheckedChange(checkedValue(value))} />
      <span>{label}</span>
    </label>
  )
}

function PromptOptions({
  open,
  onOpenChange,
  documentPrompt,
  imagePrompt,
  tablePrompt,
  onDocumentPromptChange,
  onImagePromptChange,
  onTablePromptChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  documentPrompt: string
  imagePrompt: string
  tablePrompt: string
  onDocumentPromptChange: (value: string) => void
  onImagePromptChange: (value: string) => void
  onTablePromptChange: (value: string) => void
}) {
  const { t } = useTranslation()
  return (
    <div className="rounded-md border">
      <button
        type="button"
        className="flex w-full items-center justify-between p-3 text-sm font-medium"
        onClick={() => onOpenChange(!open)}
      >
        <span>{t('documentPanel.dataWizard.prompts.title', '커스텀 프롬프트')}</span>
        {open ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
      </button>
      {open && (
        <div className="space-y-3 border-t p-3">
          <div>
            <Label>{t('documentPanel.dataWizard.prompts.document', '문서 프롬프트')}</Label>
            <Textarea className="mt-1 min-h-24" value={documentPrompt} onChange={(event) => onDocumentPromptChange(event.target.value)} />
          </div>
          <div>
            <Label>{t('documentPanel.dataWizard.prompts.image', '이미지 프롬프트')}</Label>
            <Textarea className="mt-1 min-h-24" value={imagePrompt} onChange={(event) => onImagePromptChange(event.target.value)} />
          </div>
          <div>
            <Label>{t('documentPanel.dataWizard.prompts.table', '표 프롬프트')}</Label>
            <Textarea className="mt-1 min-h-24" value={tablePrompt} onChange={(event) => onTablePromptChange(event.target.value)} />
          </div>
        </div>
      )}
    </div>
  )
}

function ActionBar({
  isSubmitting,
  onRun,
  runLabel,
}: {
  isSubmitting: boolean
  onRun: () => void
  runLabel: string
}) {
  return (
    <div className="flex justify-end">
      <Button onClick={onRun} disabled={isSubmitting}>
        {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
        {runLabel}
      </Button>
    </div>
  )
}

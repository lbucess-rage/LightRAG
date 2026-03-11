import { useState, useRef, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/Card'
import Button from '@/components/ui/Button'
import Badge from '@/components/ui/Badge'
import Input from '@/components/ui/Input'
import Textarea from '@/components/ui/Textarea'
import Progress from '@/components/ui/Progress'
import { Alert, AlertDescription } from '@/components/ui/Alert'
import { Switch } from '@/components/ui/Switch'
import { useSchemaStore } from '@/stores/schema'
import { MergeConfirmDialog } from './MergeConfirmDialog'
import { TemplateEditor } from './TemplateEditor'
import {
  FileText,
  Globe,
  Sparkles,
  Loader2,
  CheckCircle,
  AlertCircle,
  Plus,
  X,
  ArrowRight,
  GitMerge,
  Replace,
  Settings2,
  ChevronDown,
  ChevronUp,
  Save,
  Upload,
  File,
  Trash2,
} from 'lucide-react'

type DiscoveryMode = 'document' | 'domain'

// 지원하는 파일 타입 (서버에서 처리)
const SUPPORTED_FILE_EXTENSIONS = [
  '.txt', '.md', '.pdf', '.docx',
  '.json', '.xml', '.yaml', '.yml', '.csv',
  '.html', '.htm',
]

interface UploadedFile {
  name: string
  file: File  // Keep original File object for server upload
  size: number
}

export function SchemaDiscovery() {
  const { t } = useTranslation()
  const [mode, setMode] = useState<DiscoveryMode>('document')
  const [documentContent, setDocumentContent] = useState('')
  const [domainKeywords, setDomainKeywords] = useState<string[]>([])
  const [newKeyword, setNewKeyword] = useState('')
  const [domainDescription, setDomainDescription] = useState('')
  const [domainTags, setDomainTags] = useState<string[]>([])
  const [newDomainTag, setNewDomainTag] = useState('')

  // Track which mode produced the current result
  const [resultMode, setResultMode] = useState<DiscoveryMode | null>(null)

  const [isApplying, setIsApplying] = useState(false)
  const [useMerge, setUseMerge] = useState(false)
  const [mergeDialogOpen, setMergeDialogOpen] = useState(false)

  // Discovery options
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [maxEntityTypes, setMaxEntityTypes] = useState(30)
  const [maxRelationTypes, setMaxRelationTypes] = useState(25)
  const [includeCommonTypes, setIncludeCommonTypes] = useState(true)  // 기본 타입 포함 (기본값: true)

  // Template editor
  const [templateEditorOpen, setTemplateEditorOpen] = useState(false)

  // File upload
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [uploadedFiles, setUploadedFiles] = useState<UploadedFile[]>([])
  const [isDragging, setIsDragging] = useState(false)
  const [fileError, setFileError] = useState<string | null>(null)

  const {
    discoveryResult,
    isDiscovering,
    discoveryError,
    discoverFromDocuments,
    discoverFromUploadedFiles,
    discoverFromDomains,
    clearDiscoveryResult,
    applySchemaToServer,
  } = useSchemaStore()

  // File upload handlers
  const isValidFileType = (file: File): boolean => {
    const extension = '.' + file.name.split('.').pop()?.toLowerCase()
    return SUPPORTED_FILE_EXTENSIONS.includes(extension)
  }

  const handleFileSelect = useCallback((files: FileList | null) => {
    if (!files || files.length === 0) return

    setFileError(null)
    const newFiles: UploadedFile[] = []
    const errors: string[] = []

    for (let i = 0; i < files.length; i++) {
      const file = files[i]

      // Check file type
      if (!isValidFileType(file)) {
        errors.push(t('schema.discovery.fileUpload.unsupportedType', { name: file.name }))
        continue
      }

      // Check file size (max 10MB for PDF/DOCX)
      if (file.size > 10 * 1024 * 1024) {
        errors.push(t('schema.discovery.fileUpload.fileTooLarge', { name: file.name }))
        continue
      }

      // Check duplicate
      if (uploadedFiles.some(f => f.name === file.name)) {
        errors.push(t('schema.discovery.fileUpload.duplicateFile', { name: file.name }))
        continue
      }

      // Keep File object for server upload
      newFiles.push({
        name: file.name,
        file: file,
        size: file.size,
      })
    }

    if (newFiles.length > 0) {
      setUploadedFiles(prev => [...prev, ...newFiles])
    }

    if (errors.length > 0) {
      setFileError(errors.join('\n'))
    }
  }, [uploadedFiles, t])

  const handleDrop = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragging(false)
    handleFileSelect(e.dataTransfer.files)
  }, [handleFileSelect])

  const handleDragOver = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragging(true)
  }, [])

  const handleDragLeave = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragging(false)
  }, [])

  const handleRemoveFile = (fileName: string) => {
    setUploadedFiles(prev => prev.filter(f => f.name !== fileName))
    setFileError(null)
  }

  const handleClearAllFiles = () => {
    setUploadedFiles([])
    setFileError(null)
    if (fileInputRef.current) {
      fileInputRef.current.value = ''
    }
  }

  const formatFileSize = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  }

  // Build structured domain hints from description + tags
  const buildDomainHints = (): string | undefined => {
    const parts: string[] = []
    if (domainDescription.trim()) {
      parts.push(domainDescription.trim())
    }
    if (domainTags.length > 0) {
      parts.push(`[${domainTags.join(', ')}]`)
    }
    return parts.length > 0 ? parts.join('\n') : undefined
  }

  const handleAddDomainTag = () => {
    const tag = newDomainTag.trim()
    if (tag && !domainTags.includes(tag)) {
      setDomainTags([...domainTags, tag])
      setNewDomainTag('')
    }
  }

  const handleRemoveDomainTag = (tag: string) => {
    setDomainTags(domainTags.filter(t => t !== tag))
  }

  const handleDomainTagKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      handleAddDomainTag()
    }
  }

  const handleDiscoverFromDocument = async () => {
    setResultMode('document')
    const hints = buildDomainHints()

    // Use uploaded files if available (server-side processing for PDF/DOCX)
    if (uploadedFiles.length > 0) {
      const files = uploadedFiles.map(f => f.file)
      await discoverFromUploadedFiles(files, {
        max_entity_types: maxEntityTypes,
        max_relation_types: maxRelationTypes,
        domain_hints: hints,
        include_common_types: includeCommonTypes,
      })
      return
    }

    // Otherwise use pasted text content
    if (!documentContent.trim()) return

    await discoverFromDocuments(
      [{ content: documentContent }],
      {
        max_entity_types: maxEntityTypes,
        max_relation_types: maxRelationTypes,
        domain_hints: hints,
        include_common_types: includeCommonTypes,
      }
    )
  }

  const handleDiscoverFromDomain = async () => {
    if (domainKeywords.length === 0) return
    setResultMode('domain')
    await discoverFromDomains(domainKeywords, {
      max_entity_types: maxEntityTypes,
      max_relation_types: maxRelationTypes,
      include_common_types: includeCommonTypes,
    })
  }

  const handleAddKeyword = () => {
    if (newKeyword.trim() && !domainKeywords.includes(newKeyword.trim())) {
      setDomainKeywords([...domainKeywords, newKeyword.trim()])
      setNewKeyword('')
    }
  }

  const handleRemoveKeyword = (keyword: string) => {
    setDomainKeywords(domainKeywords.filter((k) => k !== keyword))
  }

  const handleApplySchema = async () => {
    if (!discoveryResult) return

    const entityTypes = discoveryResult.entity_types.map((e) => e.name)

    // 병합 모드면 다이얼로그 열기
    if (useMerge) {
      setMergeDialogOpen(true)
      return
    }

    // 교체 모드
    setIsApplying(true)
    try {
      await applySchemaToServer(entityTypes, 'discovery')
    } catch (error) {
      console.error('Failed to apply schema:', error)
    } finally {
      setIsApplying(false)
    }
  }

  const handleClearResult = () => {
    clearDiscoveryResult()
    setResultMode(null)
  }

  const handleMergeConfirm = () => {
    // 병합 완료 후 결과 정리
    handleClearResult()
  }

  const discoveryEntityTypes = discoveryResult?.entity_types.map((e) => e.name) || []

  const handleKeyDown = (e: React.KeyboardEvent) => {
    // IME 조합 중일 때는 Enter 키 처리하지 않음 (한글 입력 등)
    if (e.nativeEvent.isComposing || e.keyCode === 229) {
      return
    }
    if (e.key === 'Enter') {
      e.preventDefault()
      handleAddKeyword()
    }
  }

  return (
    <div className="space-y-4">
      {/* Mode Selection */}
      <div className="grid grid-cols-2 gap-4">
        <Card
          className={`cursor-pointer transition-all ${
            mode === 'document' ? 'ring-2 ring-primary' : 'hover:border-primary/50'
          }`}
          onClick={() => setMode('document')}
        >
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <FileText className="w-5 h-5" />
              {t('schema.discovery.fromDocument', 'From Document')}
            </CardTitle>
            <CardDescription className="text-xs">
              {t(
                'schema.discovery.fromDocumentDesc',
                'Analyze sample documents to discover entity and relation types'
              )}
            </CardDescription>
          </CardHeader>
        </Card>

        <Card
          className={`cursor-pointer transition-all ${
            mode === 'domain' ? 'ring-2 ring-primary' : 'hover:border-primary/50'
          }`}
          onClick={() => setMode('domain')}
        >
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <Globe className="w-5 h-5" />
              {t('schema.discovery.fromDomain', 'From Domain')}
            </CardTitle>
            <CardDescription className="text-xs">
              {t(
                'schema.discovery.fromDomainDesc',
                'Generate schema based on domain keywords'
              )}
            </CardDescription>
          </CardHeader>
        </Card>
      </div>

      {/* Discovery Input */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">
            {mode === 'document'
              ? t('schema.discovery.sampleDocument', 'Sample Document')
              : t('schema.discovery.domainKeywords', 'Domain Keywords')}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {mode === 'document' ? (
            <>
              {/* File Upload Area */}
              <div className="space-y-2">
                <label className="text-sm font-medium flex items-center gap-2">
                  <Upload className="w-4 h-4" />
                  {t('schema.discovery.fileUpload.title', 'Upload Files')}
                </label>
                <div
                  className={`
                    border-2 border-dashed rounded-lg p-6 text-center transition-colors cursor-pointer
                    ${isDragging ? 'border-primary bg-primary/5' : 'border-muted-foreground/25 hover:border-primary/50'}
                  `}
                  onDrop={handleDrop}
                  onDragOver={handleDragOver}
                  onDragLeave={handleDragLeave}
                  onClick={() => fileInputRef.current?.click()}
                >
                  <input
                    ref={fileInputRef}
                    type="file"
                    multiple
                    accept={SUPPORTED_FILE_EXTENSIONS.join(',')}
                    className="hidden"
                    onChange={(e) => handleFileSelect(e.target.files)}
                  />
                  <Upload className="w-8 h-8 mx-auto mb-2 text-muted-foreground" />
                  <p className="text-sm text-muted-foreground">
                    {t('schema.discovery.fileUpload.dropHere', 'Drag and drop files here, or click to select')}
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">
                    {t('schema.discovery.fileUpload.supportedTypes', 'Supported: PDF, DOCX, TXT, MD, JSON, XML, YAML, CSV, HTML (max 10MB each)')}
                  </p>
                </div>

                {/* Uploaded Files List */}
                {uploadedFiles.length > 0 && (
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium">
                        {t('schema.discovery.fileUpload.uploadedFiles', 'Uploaded Files')} ({uploadedFiles.length})
                      </span>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={handleClearAllFiles}
                        className="text-destructive hover:text-destructive"
                      >
                        <Trash2 className="w-4 h-4 mr-1" />
                        {t('schema.discovery.fileUpload.clearAll', 'Clear All')}
                      </Button>
                    </div>
                    <div className="space-y-1 max-h-[150px] overflow-y-auto">
                      {uploadedFiles.map((file) => (
                        <div
                          key={file.name}
                          className="flex items-center justify-between p-2 rounded-md bg-muted/50 text-sm"
                        >
                          <div className="flex items-center gap-2 truncate">
                            <File className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                            <span className="truncate">{file.name}</span>
                            <span className="text-xs text-muted-foreground flex-shrink-0">
                              ({formatFileSize(file.size)})
                            </span>
                          </div>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleRemoveFile(file.name)}
                            className="h-6 w-6 p-0 hover:text-destructive"
                          >
                            <X className="w-4 h-4" />
                          </Button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* File Error */}
                {fileError && (
                  <Alert variant="destructive">
                    <AlertCircle className="w-4 h-4" />
                    <AlertDescription className="whitespace-pre-line">{fileError}</AlertDescription>
                  </Alert>
                )}
              </div>

              {/* Or Separator */}
              {uploadedFiles.length === 0 && (
                <div className="relative">
                  <div className="absolute inset-0 flex items-center">
                    <div className="w-full border-t border-muted-foreground/25"></div>
                  </div>
                  <div className="relative flex justify-center">
                    <span className="bg-card px-3 text-sm text-muted-foreground">
                      {t('schema.discovery.fileUpload.or', 'or paste text directly')}
                    </span>
                  </div>
                </div>
              )}

              {/* Text Input - only show if no files uploaded */}
              {uploadedFiles.length === 0 && (
                <Textarea
                  placeholder={t(
                    'schema.discovery.documentPlaceholder',
                    'Paste a sample document to analyze...'
                  )}
                  value={documentContent}
                  onChange={(e) => setDocumentContent(e.target.value)}
                  className="min-h-[200px]"
                />
              )}

              <div className="space-y-3 rounded-lg border p-4">
                <div className="space-y-2">
                  <label className="text-sm font-medium">
                    {t('schema.discovery.domainDescription', 'Domain Description (optional)')}
                  </label>
                  <Textarea
                    placeholder={t(
                      'schema.discovery.domainDescriptionPlaceholder',
                      'Describe the domain context for better analysis...\ne.g., Analysis of customer service consultation records at a financial institution. Track customer complaints, inquiry types, processing results, and manage agent performance and service quality.'
                    )}
                    value={domainDescription}
                    onChange={(e) => setDomainDescription(e.target.value)}
                    className="min-h-[80px] resize-y"
                  />
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium">
                    {t('schema.discovery.domainTags', 'Keywords (optional)')}
                  </label>
                  <div className="flex gap-2">
                    <Input
                      placeholder={t(
                        'schema.discovery.domainTagsPlaceholder',
                        'Add keyword and press Enter...'
                      )}
                      value={newDomainTag}
                      onChange={(e) => setNewDomainTag(e.target.value)}
                      onKeyDown={handleDomainTagKeyDown}
                      className="flex-1"
                    />
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={handleAddDomainTag}
                      disabled={!newDomainTag.trim()}
                    >
                      <Plus className="h-4 w-4" />
                    </Button>
                  </div>
                  {domainTags.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 pt-1">
                      {domainTags.map((tag) => (
                        <Badge key={tag} variant="secondary" className="gap-1 pr-1">
                          {tag}
                          <button
                            onClick={() => handleRemoveDomainTag(tag)}
                            className="ml-0.5 rounded-full p-0.5 hover:bg-foreground/10"
                          >
                            <X className="h-3 w-3" />
                          </button>
                        </Badge>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </>
          ) : (
            <div className="space-y-4">
              <div className="flex gap-2">
                <Input
                  placeholder={t(
                    'schema.discovery.keywordPlaceholder',
                    'Enter a domain keyword...'
                  )}
                  value={newKeyword}
                  onChange={(e) => setNewKeyword(e.target.value)}
                  onKeyDown={handleKeyDown}
                />
                <Button onClick={handleAddKeyword} size="sm">
                  <Plus className="w-4 h-4" />
                </Button>
              </div>
              <div className="flex flex-wrap gap-2">
                {domainKeywords.map((keyword) => (
                  <Badge
                    key={keyword}
                    variant="secondary"
                    className="flex items-center gap-1 px-3 py-1"
                  >
                    {keyword}
                    <X
                      className="w-3 h-3 cursor-pointer hover:text-destructive"
                      onClick={() => handleRemoveKeyword(keyword)}
                    />
                  </Badge>
                ))}
                {domainKeywords.length === 0 && (
                  <span className="text-sm text-muted-foreground">
                    {t('schema.discovery.noKeywords', 'No keywords added yet')}
                  </span>
                )}
              </div>
              <div className="text-xs text-muted-foreground">
                {t(
                  'schema.discovery.keywordExamples',
                  'Examples: contact center, customer support, e-commerce, logistics, healthcare'
                )}
              </div>
            </div>
          )}

          {/* Advanced Settings */}
          <div className="border rounded-lg">
            <button
              type="button"
              className="w-full flex items-center justify-between p-3 text-sm font-medium hover:bg-muted/50 transition-colors"
              onClick={() => setShowAdvanced(!showAdvanced)}
            >
              <div className="flex items-center gap-2">
                <Settings2 className="w-4 h-4" />
                {t('schema.discovery.advancedSettings', 'Advanced Settings')}
              </div>
              {showAdvanced ? (
                <ChevronUp className="w-4 h-4" />
              ) : (
                <ChevronDown className="w-4 h-4" />
              )}
            </button>
            {showAdvanced && (
              <div className="px-3 pb-3 space-y-4 border-t pt-3">
                {/* Include Common Types Option */}
                <div className="flex items-center justify-between p-3 rounded-lg border bg-muted/30">
                  <div className="space-y-0.5">
                    <label className="text-sm font-medium">
                      {t('schema.discovery.includeCommonTypes', 'Include Common Types')}
                    </label>
                    <p className="text-xs text-muted-foreground">
                      {t('schema.discovery.includeCommonTypesDesc', 'Add common contact center entity/relation types (Customer, Agent, Inquiry, etc.)')}
                    </p>
                  </div>
                  <Switch checked={includeCommonTypes} onCheckedChange={setIncludeCommonTypes} />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <label className="text-sm font-medium">
                      {t('schema.discovery.maxEntityTypes', 'Max Entity Types')}
                    </label>
                    <Input
                      type="number"
                      min={5}
                      max={100}
                      value={maxEntityTypes}
                      onChange={(e) => setMaxEntityTypes(Math.min(100, Math.max(5, parseInt(e.target.value) || 30)))}
                    />
                    <p className="text-xs text-muted-foreground">
                      {t('schema.discovery.maxEntityTypesDesc', 'Maximum number of entity types to generate (5-100)')}
                    </p>
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-medium">
                      {t('schema.discovery.maxRelationTypes', 'Max Relation Types')}
                    </label>
                    <Input
                      type="number"
                      min={5}
                      max={100}
                      value={maxRelationTypes}
                      onChange={(e) => setMaxRelationTypes(Math.min(100, Math.max(5, parseInt(e.target.value) || 25)))}
                    />
                    <p className="text-xs text-muted-foreground">
                      {t('schema.discovery.maxRelationTypesDesc', 'Maximum number of relation types to generate (5-100)')}
                    </p>
                  </div>
                </div>
              </div>
            )}
          </div>

          <Button
            onClick={mode === 'document' ? handleDiscoverFromDocument : handleDiscoverFromDomain}
            disabled={
              isDiscovering ||
              (mode === 'document'
                ? (uploadedFiles.length === 0 && !documentContent.trim())
                : domainKeywords.length === 0)
            }
            className="w-full"
          >
            {isDiscovering ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                {t('schema.discovery.discovering', 'Discovering Schema...')}
              </>
            ) : (
              <>
                <Sparkles className="w-4 h-4 mr-2" />
                {t('schema.discovery.discover', 'Discover Schema')}
              </>
            )}
          </Button>
        </CardContent>
      </Card>

      {/* Discovery Progress */}
      {isDiscovering && (
        <Card>
          <CardContent className="py-6">
            <div className="space-y-4">
              <div className="flex items-center gap-2">
                <Loader2 className="w-5 h-5 animate-spin text-primary" />
                <span className="font-medium">
                  {t('schema.discovery.analyzing', 'Analyzing with LLM...')}
                </span>
              </div>
              <Progress value={undefined} className="w-full" />
              <p className="text-sm text-muted-foreground">
                {t(
                  'schema.discovery.analyzingDesc',
                  'The AI is analyzing the content to identify entity types and relationships...'
                )}
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Discovery Error */}
      {discoveryError && (
        <Alert variant="destructive">
          <AlertCircle className="w-4 h-4" />
          <AlertDescription>{discoveryError}</AlertDescription>
        </Alert>
      )}

      {/* Discovery Result - only show if result mode matches current mode */}
      {discoveryResult && !isDiscovering && resultMode === mode && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <CheckCircle className="w-5 h-5 text-green-500" />
              {t('schema.discovery.result', 'Discovery Result')}
            </CardTitle>
            <CardDescription>
              {t('schema.discovery.confidence', 'Confidence')}: {Math.round(discoveryResult.confidence * 100)}%
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            {/* Entity Types */}
            <div>
              <h4 className="font-medium mb-2 flex items-center gap-2">
                {t('schema.discovery.entityTypes', 'Entity Types')}
                <Badge variant="outline">{discoveryResult.entity_types.length}</Badge>
              </h4>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                {discoveryResult.entity_types.map((entity) => (
                  <div
                    key={entity.name}
                    className="p-2 rounded-md border bg-card hover:bg-accent transition-colors"
                  >
                    <div className="font-medium text-sm">{entity.name}</div>
                    <div className="text-xs text-muted-foreground truncate" title={entity.description}>
                      {entity.display_name}
                    </div>
                    {entity.confidence && (
                      <div className="text-xs text-primary mt-1">
                        {Math.round(entity.confidence * 100)}%
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>

            {/* Relation Types */}
            <div>
              <h4 className="font-medium mb-2 flex items-center gap-2">
                {t('schema.discovery.relationTypes', 'Relation Types')}
                <Badge variant="outline">{discoveryResult.relation_types.length}</Badge>
              </h4>
              <div className="space-y-2">
                {discoveryResult.relation_types.map((relation) => (
                  <div
                    key={relation.name}
                    className="p-2 rounded-md border bg-card flex items-center gap-2 flex-wrap"
                  >
                    <Badge variant="secondary" className="text-xs">
                      {relation.source_types.join(' | ')}
                    </Badge>
                    <ArrowRight className="w-4 h-4 text-muted-foreground" />
                    <span className="font-medium text-sm" title={relation.display_name}>{relation.name}</span>
                    <ArrowRight className="w-4 h-4 text-muted-foreground" />
                    <Badge variant="secondary" className="text-xs">
                      {relation.target_types.join(' | ')}
                    </Badge>
                  </div>
                ))}
              </div>
            </div>

            {/* Suggestions */}
            {discoveryResult.suggestions && discoveryResult.suggestions.length > 0 && (
              <div>
                <h4 className="font-medium mb-2">
                  {t('schema.discovery.suggestions', 'Suggestions')}
                </h4>
                <ul className="text-sm text-muted-foreground space-y-1">
                  {discoveryResult.suggestions.map((suggestion, i) => (
                    <li key={i} className="flex items-start gap-2">
                      <span>•</span>
                      {suggestion}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* Similar Templates */}
            {discoveryResult.similar_templates && discoveryResult.similar_templates.length > 0 && (
              <div>
                <h4 className="font-medium mb-2">
                  {t('schema.discovery.similarTemplates', 'Similar Templates')}
                </h4>
                <div className="flex flex-wrap gap-2">
                  {discoveryResult.similar_templates.map((template) => (
                    <Badge key={template} variant="outline">
                      {template}
                    </Badge>
                  ))}
                </div>
              </div>
            )}

            {/* Apply Mode Selection */}
            <div className="flex items-center justify-between p-3 rounded-lg border bg-muted/30">
              <div className="flex items-center gap-3">
                <div className="flex items-center gap-2">
                  {useMerge ? (
                    <GitMerge className="w-4 h-4 text-primary" />
                  ) : (
                    <Replace className="w-4 h-4 text-amber-500" />
                  )}
                  <span className="text-sm font-medium">
                    {useMerge
                      ? t('schema.merge.mergeMode', 'Merge with existing')
                      : t('schema.merge.replaceMode', 'Replace existing')}
                  </span>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground">
                  {t('schema.merge.toggle', 'Merge')}
                </span>
                <Switch checked={useMerge} onCheckedChange={setUseMerge} />
              </div>
            </div>

            {/* Actions */}
            <div className="flex gap-2 pt-4 border-t">
              <Button onClick={handleApplySchema} disabled={isApplying} className="flex-1">
                {isApplying ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    {t('schema.discovery.applying', 'Applying...')}
                  </>
                ) : useMerge ? (
                  <>
                    <GitMerge className="w-4 h-4 mr-2" />
                    {t('schema.merge.mergeSchema', 'Merge Schema')}
                  </>
                ) : (
                  <>
                    <CheckCircle className="w-4 h-4 mr-2" />
                    {t('schema.discovery.apply', 'Apply Schema')}
                  </>
                )}
              </Button>
              <Button
                variant="outline"
                onClick={() => setTemplateEditorOpen(true)}
                disabled={isApplying}
              >
                <Save className="w-4 h-4 mr-2" />
                {t('schema.discovery.saveAsTemplate', 'Save as Template')}
              </Button>
              <Button variant="ghost" onClick={handleClearResult} disabled={isApplying}>
                {t('schema.discovery.clear', 'Clear')}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Merge Confirm Dialog */}
      <MergeConfirmDialog
        open={mergeDialogOpen}
        onOpenChange={setMergeDialogOpen}
        newEntityTypes={discoveryEntityTypes}
        source="discovery"
        onConfirm={handleMergeConfirm}
      />

      {/* Template Editor Dialog */}
      <TemplateEditor
        open={templateEditorOpen}
        onOpenChange={setTemplateEditorOpen}
        mode="fromDiscovery"
        discoveryResult={discoveryResult}
        onSuccess={() => {
          handleClearResult()
        }}
      />
    </div>
  )
}

import { useState, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/Card'
import Button from '@/components/ui/Button'
import Badge from '@/components/ui/Badge'
import Input from '@/components/ui/Input'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/Dialog'
import { Alert, AlertDescription } from '@/components/ui/Alert'
import { Switch } from '@/components/ui/Switch'
import { useSchemaStore } from '@/stores/schema'
import { MergeConfirmDialog } from './MergeConfirmDialog'
import { TemplateEditor } from './TemplateEditor'
import {
  Search,
  Library,
  Loader2,
  ChevronRight,
  CheckCircle,
  AlertCircle,
  Tag,
  Layers,
  ArrowRight,
  X,
  GitMerge,
  Replace,
  Pencil,
  Copy,
  Trash2,
} from 'lucide-react'

export function TemplateLibrary() {
  const { t } = useTranslation()
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedTags, setSelectedTags] = useState<string[]>([])
  const [detailOpen, setDetailOpen] = useState(false)
  const [isApplying, setIsApplying] = useState(false)
  const [useMerge, setUseMerge] = useState(false)
  const [mergeDialogOpen, setMergeDialogOpen] = useState(false)

  // Template editor states
  const [editorOpen, setEditorOpen] = useState(false)
  const [editorMode, setEditorMode] = useState<'edit' | 'duplicate'>('edit')
  const [editDomain, setEditDomain] = useState<string | undefined>()
  const [isDeleting, setIsDeleting] = useState(false)

  const {
    templates,
    templatesLoading,
    templatesError,
    selectedTemplate,
    selectedTemplateLoading,
    loadTemplate,
    loadTemplates,
    clearSelectedTemplate,
    applySchemaToServer,
    setEditorSchema,
    deleteTemplate,
  } = useSchemaStore()

  // Get unique tags from all templates
  const allTags = useMemo(() => {
    const tagSet = new Set<string>()
    templates.forEach((t) => t.tags.forEach((tag) => tagSet.add(tag)))
    return Array.from(tagSet).sort()
  }, [templates])

  // Filter templates
  const filteredTemplates = useMemo(() => {
    return templates.filter((template) => {
      const matchesSearch =
        !searchQuery ||
        template.display_name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        template.description.toLowerCase().includes(searchQuery.toLowerCase()) ||
        template.domain.toLowerCase().includes(searchQuery.toLowerCase())

      const matchesTags =
        selectedTags.length === 0 || selectedTags.some((tag) => template.tags.includes(tag))

      return matchesSearch && matchesTags
    })
  }, [templates, searchQuery, selectedTags])

  const handleSelectTemplate = async (domain: string) => {
    await loadTemplate(domain)
    setDetailOpen(true)
  }

  const handleToggleTag = (tag: string) => {
    setSelectedTags((prev) =>
      prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]
    )
  }

  const handleApplyTemplate = async () => {
    if (!selectedTemplate) return

    // 병합 모드면 다이얼로그 열기
    if (useMerge) {
      setMergeDialogOpen(true)
      return
    }

    // 교체 모드
    const entityTypes = selectedTemplate.entity_types.map((e) => e.name)
    setIsApplying(true)
    try {
      await applySchemaToServer(entityTypes, `template:${selectedTemplate.domain}`)
      setDetailOpen(false)
      clearSelectedTemplate()
    } catch (error) {
      console.error('Failed to apply template:', error)
    } finally {
      setIsApplying(false)
    }
  }

  const handleMergeConfirm = () => {
    // 병합 완료 후 다이얼로그 닫기
    setDetailOpen(false)
    clearSelectedTemplate()
  }

  const templateEntityTypes = selectedTemplate?.entity_types.map((e) => e.name) || []
  const templateSource = selectedTemplate ? `template:${selectedTemplate.domain}` : 'template'

  const handleEditTemplate = () => {
    if (!selectedTemplate) return
    setEditDomain(selectedTemplate.domain)
    setEditorMode('edit')
    setDetailOpen(false)
    setEditorOpen(true)
  }

  const handleDuplicateTemplate = () => {
    if (!selectedTemplate) return
    setEditDomain(selectedTemplate.domain)
    setEditorMode('duplicate')
    setDetailOpen(false)
    setEditorOpen(true)
  }

  const handleDeleteTemplate = async () => {
    if (!selectedTemplate) return
    if (!window.confirm(t('schema.templates.confirmDelete', `Are you sure you want to delete "${selectedTemplate.display_name}"?`))) {
      return
    }
    setIsDeleting(true)
    try {
      await deleteTemplate(selectedTemplate.domain)
      setDetailOpen(false)
      clearSelectedTemplate()
    } catch (error) {
      console.error('Failed to delete template:', error)
    } finally {
      setIsDeleting(false)
    }
  }

  const handleEditorSuccess = () => {
    loadTemplates()
    clearSelectedTemplate()
  }

  const handleCloseDetail = () => {
    setDetailOpen(false)
    clearSelectedTemplate()
  }

  return (
    <div className="space-y-4">
      {/* Search and Filter */}
      <Card>
        <CardContent className="pt-4 space-y-4">
          {/* Search */}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              placeholder={t('schema.templates.search', 'Search templates...')}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9"
            />
          </div>

          {/* Tags Filter */}
          {allTags.length > 0 && (
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Tag className="w-4 h-4" />
                {t('schema.templates.filterByTags', 'Filter by tags')}
              </div>
              <div className="flex flex-wrap gap-2">
                {allTags.map((tag) => (
                  <Badge
                    key={tag}
                    variant={selectedTags.includes(tag) ? 'default' : 'outline'}
                    className="cursor-pointer"
                    onClick={() => handleToggleTag(tag)}
                  >
                    {tag}
                    {selectedTags.includes(tag) && <X className="w-3 h-3 ml-1" />}
                  </Badge>
                ))}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Error */}
      {templatesError && (
        <Alert variant="destructive">
          <AlertCircle className="w-4 h-4" />
          <AlertDescription>{templatesError}</AlertDescription>
        </Alert>
      )}

      {/* Loading */}
      {templatesLoading && (
        <div className="flex items-center justify-center py-8">
          <Loader2 className="w-6 h-6 animate-spin text-primary" />
          <span className="ml-2">{t('schema.templates.loading', 'Loading templates...')}</span>
        </div>
      )}

      {/* Template Grid */}
      {!templatesLoading && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {filteredTemplates.map((template) => (
            <Card
              key={template.domain}
              className="cursor-pointer hover:border-primary/50 transition-all"
              onClick={() => handleSelectTemplate(template.domain)}
            >
              <CardHeader className="pb-2">
                <div className="flex items-start justify-between">
                  <div>
                    <CardTitle className="text-base flex items-center gap-2">
                      <Library className="w-4 h-4" />
                      {template.display_name}
                    </CardTitle>
                    <CardDescription className="text-xs mt-1">
                      {template.description}
                    </CardDescription>
                  </div>
                  <ChevronRight className="w-5 h-5 text-muted-foreground" />
                </div>
              </CardHeader>
              <CardContent className="pt-0">
                <div className="flex items-center gap-4 text-sm text-muted-foreground">
                  <span className="flex items-center gap-1">
                    <Layers className="w-3 h-3" />
                    {template.entity_count} {t('schema.templates.entities', 'entities')}
                  </span>
                  <span className="flex items-center gap-1">
                    <ArrowRight className="w-3 h-3" />
                    {template.relation_count} {t('schema.templates.relations', 'relations')}
                  </span>
                </div>
                <div className="flex flex-wrap gap-1 mt-2">
                  {template.tags.slice(0, 3).map((tag) => (
                    <Badge key={tag} variant="secondary" className="text-xs">
                      {tag}
                    </Badge>
                  ))}
                  {template.tags.length > 3 && (
                    <Badge variant="secondary" className="text-xs">
                      +{template.tags.length - 3}
                    </Badge>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Empty State */}
      {!templatesLoading && filteredTemplates.length === 0 && (
        <Card>
          <CardContent className="py-8 text-center">
            <Library className="w-12 h-12 mx-auto text-muted-foreground mb-4" />
            <h3 className="font-medium mb-2">
              {t('schema.templates.noTemplates', 'No templates found')}
            </h3>
            <p className="text-sm text-muted-foreground">
              {searchQuery || selectedTags.length > 0
                ? t('schema.templates.tryDifferentSearch', 'Try a different search or filter')
                : t('schema.templates.noTemplatesAvailable', 'No templates are available yet')}
            </p>
          </CardContent>
        </Card>
      )}

      {/* Template Detail Dialog */}
      <Dialog open={detailOpen} onOpenChange={setDetailOpen}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
          {selectedTemplateLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="w-6 h-6 animate-spin text-primary" />
            </div>
          ) : selectedTemplate ? (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  <Library className="w-5 h-5" />
                  {selectedTemplate.display_name}
                </DialogTitle>
                <DialogDescription>{selectedTemplate.description}</DialogDescription>
              </DialogHeader>

              <div className="space-y-6 mt-4">
                {/* Metadata */}
                <div className="flex flex-wrap gap-2">
                  <Badge variant="outline">v{selectedTemplate.version}</Badge>
                  {selectedTemplate.tags.map((tag) => (
                    <Badge key={tag} variant="secondary">
                      {tag}
                    </Badge>
                  ))}
                </div>

                {/* Entity Types */}
                <div>
                  <h4 className="font-medium mb-3 flex items-center gap-2">
                    {t('schema.templates.entityTypes', 'Entity Types')}
                    <Badge variant="outline">{selectedTemplate.entity_types.length}</Badge>
                  </h4>
                  <div className="grid grid-cols-2 gap-2">
                    {selectedTemplate.entity_types.map((entity) => (
                      <div
                        key={entity.name}
                        className="p-3 rounded-md border bg-card"
                      >
                        <div className="font-medium text-sm">{entity.name}</div>
                        <div className="text-xs text-muted-foreground mt-1" title={entity.description}>
                          {entity.display_name}
                        </div>
                        {entity.examples && entity.examples.length > 0 && (
                          <div className="text-xs text-primary mt-2">
                            {t('schema.templates.examples', 'Examples')}: {entity.examples.slice(0, 3).join(', ')}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>

                {/* Relation Types */}
                <div>
                  <h4 className="font-medium mb-3 flex items-center gap-2">
                    {t('schema.templates.relationTypes', 'Relation Types')}
                    <Badge variant="outline">{selectedTemplate.relation_types.length}</Badge>
                  </h4>
                  <div className="space-y-2">
                    {selectedTemplate.relation_types.map((relation) => (
                      <div
                        key={relation.name}
                        className="p-3 rounded-md border bg-card"
                      >
                        <div className="flex items-center gap-2 mb-1 flex-wrap">
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
                        <div className="text-xs text-muted-foreground">
                          {relation.display_name}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

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
                  <Button onClick={handleApplyTemplate} disabled={isApplying} className="flex-1">
                    {isApplying ? (
                      <>
                        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                        {t('schema.templates.applying', 'Applying...')}
                      </>
                    ) : useMerge ? (
                      <>
                        <GitMerge className="w-4 h-4 mr-2" />
                        {t('schema.merge.mergeSchema', 'Merge Schema')}
                      </>
                    ) : (
                      <>
                        <CheckCircle className="w-4 h-4 mr-2" />
                        {t('schema.templates.apply', 'Apply Template')}
                      </>
                    )}
                  </Button>
                  <Button variant="outline" onClick={handleEditTemplate} disabled={isApplying || isDeleting}>
                    <Pencil className="w-4 h-4 mr-2" />
                    {t('schema.templates.edit', 'Edit')}
                  </Button>
                  <Button variant="outline" onClick={handleDuplicateTemplate} disabled={isApplying || isDeleting}>
                    <Copy className="w-4 h-4 mr-2" />
                    {t('schema.templates.duplicate', 'Duplicate')}
                  </Button>
                  <Button
                    variant="ghost"
                    onClick={handleDeleteTemplate}
                    disabled={isApplying || isDeleting}
                    className="text-destructive hover:text-destructive"
                  >
                    {isDeleting ? (
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    ) : (
                      <Trash2 className="w-4 h-4 mr-2" />
                    )}
                    {t('schema.templates.delete', 'Delete')}
                  </Button>
                </div>
              </div>
            </>
          ) : null}
        </DialogContent>
      </Dialog>

      {/* Merge Confirm Dialog */}
      <MergeConfirmDialog
        open={mergeDialogOpen}
        onOpenChange={setMergeDialogOpen}
        newEntityTypes={templateEntityTypes}
        source={templateSource}
        onConfirm={handleMergeConfirm}
      />

      {/* Template Editor Dialog */}
      <TemplateEditor
        open={editorOpen}
        onOpenChange={setEditorOpen}
        mode={editorMode}
        sourceDomain={editDomain}
        onSuccess={handleEditorSuccess}
      />
    </div>
  )
}

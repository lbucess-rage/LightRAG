import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import Button from '@/components/ui/Button'
import Badge from '@/components/ui/Badge'
import Input from '@/components/ui/Input'
import Textarea from '@/components/ui/Textarea'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/Dialog'
import { Alert, AlertDescription } from '@/components/ui/Alert'
import { useSchemaStore } from '@/stores/schema'
import { EntityType, RelationType, SchemaDiscoveryResult } from '@/api/schema'
import {
  Save,
  Loader2,
  Plus,
  X,
  Trash2,
  AlertCircle,
  ArrowRight,
  Pencil,
  Copy,
  ChevronDown,
  ChevronUp,
} from 'lucide-react'

interface TemplateEditorProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  mode: 'create' | 'edit' | 'duplicate' | 'fromDiscovery'
  sourceDomain?: string
  discoveryResult?: SchemaDiscoveryResult | null
  onSuccess?: () => void
}

// Sub-component for Entity Type Editor
function EntityTypeEditor({
  entity,
  onSave,
  onCancel,
  existingNames,
}: {
  entity?: EntityType
  onSave: (entity: EntityType) => void
  onCancel: () => void
  existingNames: string[]
}) {
  const { t } = useTranslation()
  const [name, setName] = useState(entity?.name || '')
  const [displayName, setDisplayName] = useState(entity?.display_name || '')
  const [description, setDescription] = useState(entity?.description || '')
  const [examples, setExamples] = useState(entity?.examples?.join(', ') || '')
  const [error, setError] = useState<string | null>(null)

  const handleSave = () => {
    if (!name.trim()) {
      setError(t('schema.editor.nameRequired', 'Name is required'))
      return
    }
    if (!entity && existingNames.includes(name.trim())) {
      setError(t('schema.editor.nameDuplicate', 'Name already exists'))
      return
    }
    onSave({
      name: name.trim(),
      display_name: displayName.trim() || name.trim(),
      description: description.trim(),
      examples: examples.split(',').map((e) => e.trim()).filter(Boolean),
    })
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.nativeEvent.isComposing || e.keyCode === 229) return
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSave()
    }
  }

  return (
    <div className="space-y-3 p-3 border rounded-md bg-muted/30">
      <div className="text-sm font-medium">
        {entity ? t('schema.editor.editEntity', 'Edit Entity Type') : t('schema.editor.addEntity', 'Add Entity Type')}
      </div>
      {error && (
        <Alert variant="destructive" className="py-2">
          <AlertCircle className="w-4 h-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <label className="text-xs font-medium">{t('schema.editor.entityName', 'Name (English)')} *</label>
          <Input
            placeholder="e.g., Customer"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={!!entity}
            className="h-8"
          />
        </div>
        <div className="space-y-1">
          <label className="text-xs font-medium">{t('schema.editor.entityDisplayName', 'Display Name')}</label>
          <Input
            placeholder="e.g., 고객"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            onKeyDown={handleKeyDown}
            className="h-8"
          />
        </div>
      </div>
      <div className="space-y-1">
        <label className="text-xs font-medium">{t('schema.editor.entityDescription', 'Description')}</label>
        <Textarea
          placeholder={t('schema.editor.entityDescPlaceholder', 'Describe this entity type...')}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          className="min-h-[60px]"
        />
      </div>
      <div className="space-y-1">
        <label className="text-xs font-medium">{t('schema.editor.entityExamples', 'Examples (comma-separated)')}</label>
        <Input
          placeholder="e.g., John Doe, Jane Smith"
          value={examples}
          onChange={(e) => setExamples(e.target.value)}
          onKeyDown={handleKeyDown}
          className="h-8"
        />
      </div>
      <div className="flex justify-end gap-2">
        <Button variant="ghost" size="sm" onClick={onCancel}>
          {t('common.cancel', 'Cancel')}
        </Button>
        <Button size="sm" onClick={handleSave}>
          {entity ? t('schema.editor.update', 'Update') : t('schema.editor.add', 'Add')}
        </Button>
      </div>
    </div>
  )
}

// Sub-component for Relation Type Editor
function RelationTypeEditor({
  relation,
  onSave,
  onCancel,
  existingNames,
  entityTypes,
}: {
  relation?: RelationType
  onSave: (relation: RelationType) => void
  onCancel: () => void
  existingNames: string[]
  entityTypes: EntityType[]
}) {
  const { t } = useTranslation()
  const [name, setName] = useState(relation?.name || '')
  const [displayName, setDisplayName] = useState(relation?.display_name || '')
  const [description, setDescription] = useState(relation?.description || '')
  const [sourceTypes, setSourceTypes] = useState(relation?.source_types?.join(', ') || '')
  const [targetTypes, setTargetTypes] = useState(relation?.target_types?.join(', ') || '')
  const [error, setError] = useState<string | null>(null)

  const handleSave = () => {
    if (!name.trim()) {
      setError(t('schema.editor.nameRequired', 'Name is required'))
      return
    }
    if (!relation && existingNames.includes(name.trim())) {
      setError(t('schema.editor.nameDuplicate', 'Name already exists'))
      return
    }
    const sources = sourceTypes.split(',').map((s) => s.trim()).filter(Boolean)
    const targets = targetTypes.split(',').map((s) => s.trim()).filter(Boolean)
    if (sources.length === 0 || targets.length === 0) {
      setError(t('schema.editor.sourceTargetRequired', 'Source and target types are required'))
      return
    }
    onSave({
      name: name.trim(),
      display_name: displayName.trim() || name.trim(),
      description: description.trim(),
      source_types: sources,
      target_types: targets,
      is_directional: true,
    })
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.nativeEvent.isComposing || e.keyCode === 229) return
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSave()
    }
  }

  const entityNames = entityTypes.map((e) => e.name).join(', ')

  return (
    <div className="space-y-3 p-3 border rounded-md bg-muted/30">
      <div className="text-sm font-medium">
        {relation ? t('schema.editor.editRelation', 'Edit Relation Type') : t('schema.editor.addRelation', 'Add Relation Type')}
      </div>
      {error && (
        <Alert variant="destructive" className="py-2">
          <AlertCircle className="w-4 h-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <label className="text-xs font-medium">{t('schema.editor.relationName', 'Name (UPPER_SNAKE_CASE)')} *</label>
          <Input
            placeholder="e.g., WORKS_AT"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={!!relation}
            className="h-8"
          />
        </div>
        <div className="space-y-1">
          <label className="text-xs font-medium">{t('schema.editor.relationDisplayName', 'Display Name')}</label>
          <Input
            placeholder="e.g., 근무처"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            onKeyDown={handleKeyDown}
            className="h-8"
          />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <label className="text-xs font-medium">{t('schema.editor.sourceTypes', 'Source Types')} *</label>
          <Input
            placeholder="e.g., Customer, Employee"
            value={sourceTypes}
            onChange={(e) => setSourceTypes(e.target.value)}
            onKeyDown={handleKeyDown}
            className="h-8"
          />
          <p className="text-xs text-muted-foreground">{t('schema.editor.availableTypes', 'Available')}: {entityNames || '-'}</p>
        </div>
        <div className="space-y-1">
          <label className="text-xs font-medium">{t('schema.editor.targetTypes', 'Target Types')} *</label>
          <Input
            placeholder="e.g., Organization, Department"
            value={targetTypes}
            onChange={(e) => setTargetTypes(e.target.value)}
            onKeyDown={handleKeyDown}
            className="h-8"
          />
        </div>
      </div>
      <div className="space-y-1">
        <label className="text-xs font-medium">{t('schema.editor.relationDescription', 'Description')}</label>
        <Textarea
          placeholder={t('schema.editor.relationDescPlaceholder', 'Describe this relation type...')}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          className="min-h-[60px]"
        />
      </div>
      <div className="flex justify-end gap-2">
        <Button variant="ghost" size="sm" onClick={onCancel}>
          {t('common.cancel', 'Cancel')}
        </Button>
        <Button size="sm" onClick={handleSave}>
          {relation ? t('schema.editor.update', 'Update') : t('schema.editor.add', 'Add')}
        </Button>
      </div>
    </div>
  )
}

export function TemplateEditor({
  open,
  onOpenChange,
  mode,
  sourceDomain,
  discoveryResult,
  onSuccess,
}: TemplateEditorProps) {
  const { t } = useTranslation()
  const {
    selectedTemplate,
    loadTemplate,
    createTemplate,
    updateTemplate,
    isTemplateSaving,
    templateSaveError,
  } = useSchemaStore()

  // Form state
  const [domain, setDomain] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [description, setDescription] = useState('')
  const [tags, setTags] = useState<string[]>([])
  const [newTag, setNewTag] = useState('')
  const [entityTypes, setEntityTypes] = useState<EntityType[]>([])
  const [relationTypes, setRelationTypes] = useState<RelationType[]>([])
  const [error, setError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)

  // Editor states
  const [showEntityEditor, setShowEntityEditor] = useState(false)
  const [editingEntityIndex, setEditingEntityIndex] = useState<number | null>(null)
  const [showRelationEditor, setShowRelationEditor] = useState(false)
  const [editingRelationIndex, setEditingRelationIndex] = useState<number | null>(null)
  const [entitySectionExpanded, setEntitySectionExpanded] = useState(true)
  const [relationSectionExpanded, setRelationSectionExpanded] = useState(true)

  // Load data based on mode
  useEffect(() => {
    if (!open) return

    const loadData = async () => {
      setError(null)
      setShowEntityEditor(false)
      setShowRelationEditor(false)
      setEditingEntityIndex(null)
      setEditingRelationIndex(null)

      if (mode === 'create') {
        setDomain('')
        setDisplayName('')
        setDescription('')
        setTags([])
        setEntityTypes([])
        setRelationTypes([])
      } else if (mode === 'fromDiscovery' && discoveryResult) {
        setDomain('')
        setDisplayName('')
        setDescription(discoveryResult.domain_summary || '')
        setTags([])
        setEntityTypes(discoveryResult.entity_types)
        setRelationTypes(discoveryResult.relation_types)
      } else if ((mode === 'edit' || mode === 'duplicate') && sourceDomain) {
        setIsLoading(true)
        try {
          await loadTemplate(sourceDomain)
        } catch (err) {
          setError(err instanceof Error ? err.message : 'Failed to load template')
        } finally {
          setIsLoading(false)
        }
      }
    }

    loadData()
  }, [open, mode, sourceDomain, discoveryResult, loadTemplate])

  // Update form when selectedTemplate changes
  useEffect(() => {
    if (selectedTemplate && (mode === 'edit' || mode === 'duplicate')) {
      if (mode === 'edit') {
        setDomain(selectedTemplate.domain)
        setDisplayName(selectedTemplate.display_name)
      } else {
        setDomain('')
        setDisplayName(`${selectedTemplate.display_name} (Copy)`)
      }
      setDescription(selectedTemplate.description)
      setTags(selectedTemplate.tags)
      setEntityTypes(selectedTemplate.entity_types)
      setRelationTypes(selectedTemplate.relation_types)
    }
  }, [selectedTemplate, mode])

  const handleAddTag = () => {
    if (newTag.trim() && !tags.includes(newTag.trim())) {
      setTags([...tags, newTag.trim()])
      setNewTag('')
    }
  }

  const handleRemoveTag = (tag: string) => {
    setTags(tags.filter((t) => t !== tag))
  }

  // Entity handlers
  const handleAddEntity = (entity: EntityType) => {
    setEntityTypes([...entityTypes, entity])
    setShowEntityEditor(false)
  }

  const handleUpdateEntity = (index: number, entity: EntityType) => {
    const newEntities = [...entityTypes]
    newEntities[index] = entity
    setEntityTypes(newEntities)
    setEditingEntityIndex(null)
  }

  const handleRemoveEntity = (index: number) => {
    setEntityTypes(entityTypes.filter((_, i) => i !== index))
  }

  // Relation handlers
  const handleAddRelation = (relation: RelationType) => {
    setRelationTypes([...relationTypes, relation])
    setShowRelationEditor(false)
  }

  const handleUpdateRelation = (index: number, relation: RelationType) => {
    const newRelations = [...relationTypes]
    newRelations[index] = relation
    setRelationTypes(newRelations)
    setEditingRelationIndex(null)
  }

  const handleRemoveRelation = (index: number) => {
    setRelationTypes(relationTypes.filter((_, i) => i !== index))
  }

  const handleSave = async () => {
    setError(null)

    if (!domain.trim()) {
      setError(t('schema.editor.domainRequired', 'Domain ID is required'))
      return
    }
    if (!displayName.trim()) {
      setError(t('schema.editor.displayNameRequired', 'Display name is required'))
      return
    }
    if (entityTypes.length === 0) {
      setError(t('schema.editor.entityTypesRequired', 'At least one entity type is required'))
      return
    }

    const input = {
      domain: domain.trim(),
      display_name: displayName.trim(),
      description: description.trim(),
      entity_types: entityTypes.map((e) => ({
        name: e.name,
        display_name: e.display_name,
        description: e.description,
        examples: e.examples || [],
        color: e.color,
        icon: e.icon,
      })),
      relation_types: relationTypes.map((r) => ({
        name: r.name,
        display_name: r.display_name,
        description: r.description,
        source_types: r.source_types,
        target_types: r.target_types,
        is_directional: r.is_directional,
        cardinality: r.cardinality,
      })),
      tags,
    }

    try {
      if (mode === 'edit' && sourceDomain) {
        await updateTemplate(sourceDomain, input)
      } else {
        await createTemplate(input)
      }
      onOpenChange(false)
      onSuccess?.()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save template')
    }
  }

  const getTitle = () => {
    switch (mode) {
      case 'create':
        return t('schema.editor.createTitle', 'Create New Template')
      case 'edit':
        return t('schema.editor.editTitle', 'Edit Template')
      case 'duplicate':
        return t('schema.editor.duplicateTitle', 'Duplicate Template')
      case 'fromDiscovery':
        return t('schema.editor.saveAsTemplate', 'Save as Template')
      default:
        return ''
    }
  }

  const getIcon = () => {
    switch (mode) {
      case 'create':
        return <Plus className="w-5 h-5" />
      case 'edit':
        return <Pencil className="w-5 h-5" />
      case 'duplicate':
        return <Copy className="w-5 h-5" />
      case 'fromDiscovery':
        return <Save className="w-5 h-5" />
      default:
        return null
    }
  }

  const handleTagKeyDown = (e: React.KeyboardEvent) => {
    if (e.nativeEvent.isComposing || e.keyCode === 229) return
    if (e.key === 'Enter') {
      e.preventDefault()
      handleAddTag()
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {getIcon()}
            {getTitle()}
          </DialogTitle>
          <DialogDescription>
            {mode === 'fromDiscovery'
              ? t('schema.editor.saveAsTemplateDesc', 'Save the discovered schema as a reusable template')
              : t('schema.editor.description', 'Configure the template details and schema')}
          </DialogDescription>
        </DialogHeader>

        {isLoading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="w-6 h-6 animate-spin text-primary" />
          </div>
        ) : (
          <div className="space-y-6 mt-4">
            {/* Error Alert */}
            {(error || templateSaveError) && (
              <Alert variant="destructive">
                <AlertCircle className="w-4 h-4" />
                <AlertDescription>{error || templateSaveError}</AlertDescription>
              </Alert>
            )}

            {/* Basic Info */}
            <div className="space-y-4">
              <h4 className="font-medium">{t('schema.editor.basicInfo', 'Basic Information')}</h4>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label className="text-sm font-medium">
                    {t('schema.editor.domainId', 'Domain ID')} *
                  </label>
                  <Input
                    placeholder="e.g., contact-center"
                    value={domain}
                    onChange={(e) => setDomain(e.target.value)}
                    disabled={mode === 'edit'}
                  />
                  <p className="text-xs text-muted-foreground">
                    {t('schema.editor.domainIdHint', 'Unique identifier (lowercase, hyphens allowed)')}
                  </p>
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium">
                    {t('schema.editor.displayName', 'Display Name')} *
                  </label>
                  <Input
                    placeholder="e.g., Contact Center"
                    value={displayName}
                    onChange={(e) => setDisplayName(e.target.value)}
                  />
                </div>
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">
                  {t('schema.editor.descriptionLabel', 'Description')}
                </label>
                <Textarea
                  placeholder={t('schema.editor.descriptionPlaceholder', 'Describe what this template is for...')}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  className="min-h-[80px]"
                />
              </div>
            </div>

            {/* Tags */}
            <div className="space-y-2">
              <label className="text-sm font-medium">{t('schema.editor.tags', 'Tags')}</label>
              <div className="flex gap-2">
                <Input
                  placeholder={t('schema.editor.tagPlaceholder', 'Add a tag...')}
                  value={newTag}
                  onChange={(e) => setNewTag(e.target.value)}
                  onKeyDown={handleTagKeyDown}
                  className="flex-1"
                />
                <Button onClick={handleAddTag} size="sm" variant="outline">
                  <Plus className="w-4 h-4" />
                </Button>
              </div>
              <div className="flex flex-wrap gap-2 mt-2">
                {tags.map((tag) => (
                  <Badge key={tag} variant="secondary" className="flex items-center gap-1">
                    {tag}
                    <X
                      className="w-3 h-3 cursor-pointer hover:text-destructive"
                      onClick={() => handleRemoveTag(tag)}
                    />
                  </Badge>
                ))}
              </div>
            </div>

            {/* Entity Types */}
            <div className="space-y-2">
              <button
                type="button"
                className="flex items-center justify-between w-full text-left"
                onClick={() => setEntitySectionExpanded(!entitySectionExpanded)}
              >
                <label className="text-sm font-medium cursor-pointer">
                  {t('schema.editor.entityTypes', 'Entity Types')}
                  <Badge variant="outline" className="ml-2">{entityTypes.length}</Badge>
                </label>
                {entitySectionExpanded ? (
                  <ChevronUp className="w-4 h-4" />
                ) : (
                  <ChevronDown className="w-4 h-4" />
                )}
              </button>

              {entitySectionExpanded && (
                <>
                  <div className="border rounded-md max-h-[250px] overflow-y-auto">
                    {entityTypes.length === 0 ? (
                      <div className="p-4 text-center text-sm text-muted-foreground">
                        {t('schema.editor.noEntityTypes', 'No entity types defined')}
                      </div>
                    ) : (
                      <div className="divide-y">
                        {entityTypes.map((entity, index) => (
                          editingEntityIndex === index ? (
                            <div key={entity.name} className="p-2">
                              <EntityTypeEditor
                                entity={entity}
                                onSave={(e) => handleUpdateEntity(index, e)}
                                onCancel={() => setEditingEntityIndex(null)}
                                existingNames={entityTypes.filter((_, i) => i !== index).map((e) => e.name)}
                              />
                            </div>
                          ) : (
                            <div
                              key={entity.name}
                              className="flex items-center justify-between p-2 hover:bg-muted/50 group"
                            >
                              <div className="flex-1 min-w-0 cursor-pointer" onClick={() => setEditingEntityIndex(index)}>
                                <div className="font-medium text-sm">{entity.name}</div>
                                <div className="text-xs text-muted-foreground truncate">
                                  {entity.display_name} {entity.description && `- ${entity.description.slice(0, 50)}...`}
                                </div>
                              </div>
                              <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => setEditingEntityIndex(index)}
                                >
                                  <Pencil className="w-4 h-4" />
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => handleRemoveEntity(index)}
                                  className="text-destructive hover:text-destructive"
                                >
                                  <Trash2 className="w-4 h-4" />
                                </Button>
                              </div>
                            </div>
                          )
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Add Entity Form */}
                  {showEntityEditor ? (
                    <EntityTypeEditor
                      onSave={handleAddEntity}
                      onCancel={() => setShowEntityEditor(false)}
                      existingNames={entityTypes.map((e) => e.name)}
                    />
                  ) : (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setShowEntityEditor(true)}
                      className="w-full"
                    >
                      <Plus className="w-4 h-4 mr-2" />
                      {t('schema.editor.addEntityType', 'Add Entity Type')}
                    </Button>
                  )}
                </>
              )}
            </div>

            {/* Relation Types */}
            <div className="space-y-2">
              <button
                type="button"
                className="flex items-center justify-between w-full text-left"
                onClick={() => setRelationSectionExpanded(!relationSectionExpanded)}
              >
                <label className="text-sm font-medium cursor-pointer">
                  {t('schema.editor.relationTypes', 'Relation Types')}
                  <Badge variant="outline" className="ml-2">{relationTypes.length}</Badge>
                </label>
                {relationSectionExpanded ? (
                  <ChevronUp className="w-4 h-4" />
                ) : (
                  <ChevronDown className="w-4 h-4" />
                )}
              </button>

              {relationSectionExpanded && (
                <>
                  <div className="border rounded-md max-h-[250px] overflow-y-auto">
                    {relationTypes.length === 0 ? (
                      <div className="p-4 text-center text-sm text-muted-foreground">
                        {t('schema.editor.noRelationTypes', 'No relation types defined')}
                      </div>
                    ) : (
                      <div className="divide-y">
                        {relationTypes.map((relation, index) => (
                          editingRelationIndex === index ? (
                            <div key={relation.name} className="p-2">
                              <RelationTypeEditor
                                relation={relation}
                                onSave={(r) => handleUpdateRelation(index, r)}
                                onCancel={() => setEditingRelationIndex(null)}
                                existingNames={relationTypes.filter((_, i) => i !== index).map((r) => r.name)}
                                entityTypes={entityTypes}
                              />
                            </div>
                          ) : (
                            <div
                              key={relation.name}
                              className="flex items-center justify-between p-2 hover:bg-muted/50 group"
                            >
                              <div className="flex items-center gap-2 flex-1 min-w-0 flex-wrap cursor-pointer" onClick={() => setEditingRelationIndex(index)}>
                                <Badge variant="secondary" className="text-xs">
                                  {relation.source_types.slice(0, 2).join(' | ')}
                                  {relation.source_types.length > 2 && '...'}
                                </Badge>
                                <ArrowRight className="w-3 h-3 text-muted-foreground" />
                                <span className="font-medium text-sm">{relation.name}</span>
                                <ArrowRight className="w-3 h-3 text-muted-foreground" />
                                <Badge variant="secondary" className="text-xs">
                                  {relation.target_types.slice(0, 2).join(' | ')}
                                  {relation.target_types.length > 2 && '...'}
                                </Badge>
                              </div>
                              <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => setEditingRelationIndex(index)}
                                >
                                  <Pencil className="w-4 h-4" />
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => handleRemoveRelation(index)}
                                  className="text-destructive hover:text-destructive"
                                >
                                  <Trash2 className="w-4 h-4" />
                                </Button>
                              </div>
                            </div>
                          )
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Add Relation Form */}
                  {showRelationEditor ? (
                    <RelationTypeEditor
                      onSave={handleAddRelation}
                      onCancel={() => setShowRelationEditor(false)}
                      existingNames={relationTypes.map((r) => r.name)}
                      entityTypes={entityTypes}
                    />
                  ) : (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setShowRelationEditor(true)}
                      className="w-full"
                    >
                      <Plus className="w-4 h-4 mr-2" />
                      {t('schema.editor.addRelationType', 'Add Relation Type')}
                    </Button>
                  )}
                </>
              )}
            </div>
          </div>
        )}

        <DialogFooter className="mt-6">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isTemplateSaving}>
            {t('common.cancel', 'Cancel')}
          </Button>
          <Button onClick={handleSave} disabled={isTemplateSaving || isLoading}>
            {isTemplateSaving ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                {t('common.saving', 'Saving...')}
              </>
            ) : (
              <>
                <Save className="w-4 h-4 mr-2" />
                {t('common.save', 'Save')}
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

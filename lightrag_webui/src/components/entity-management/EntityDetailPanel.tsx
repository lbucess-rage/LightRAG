import { useState, useEffect, useCallback, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { useEntityManagementStore } from '@/stores/entityManagement'
import { updateEntity, updateRelation } from '@/api/lightrag'
import { cn } from '@/lib/utils'
import Button from '@/components/ui/Button'
import Input from '@/components/ui/Input'
import {
  ChevronUpIcon,
  ChevronDownIcon,
  SaveIcon,
  Loader2Icon,
  XIcon,
  LinkIcon,
  BoxIcon,
  EditIcon,
  ImageIcon,
  UsersIcon
} from 'lucide-react'
import { toast } from 'sonner'
import { backendBaseUrl } from '@/lib/constants'

// Image preview dialog component
function ImagePreviewDialog({
  isOpen,
  onClose,
  imageUrl,
  title
}: {
  isOpen: boolean
  onClose: () => void
  imageUrl: string
  title: string
}) {
  if (!isOpen) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={onClose}
    >
      <div
        className="relative max-h-[90vh] max-w-[90vw] bg-background rounded-lg p-4 shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-lg font-medium">{title}</h3>
          <Button variant="ghost" size="icon" onClick={onClose}>
            <XIcon className="h-4 w-4" />
          </Button>
        </div>
        <div className="overflow-auto max-h-[80vh]">
          <img
            src={imageUrl}
            alt={title}
            className="max-w-full h-auto"
            onError={(e) => {
              (e.target as HTMLImageElement).src = 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200"><text x="50%" y="50%" text-anchor="middle" dominant-baseline="middle" fill="gray">Image not found</text></svg>'
            }}
          />
        </div>
      </div>
    </div>
  )
}

// Editable field component
function EditableField({
  label,
  value,
  isEditable,
  onChange,
  multiline = false
}: {
  label: string
  value: string
  isEditable: boolean
  onChange?: (value: string) => void
  multiline?: boolean
}) {
  const [isEditing, setIsEditing] = useState(false)
  const [editValue, setEditValue] = useState(value)

  useEffect(() => {
    setEditValue(value)
  }, [value])

  const handleSave = () => {
    if (onChange) {
      onChange(editValue)
    }
    setIsEditing(false)
  }

  const handleCancel = () => {
    setEditValue(value)
    setIsEditing(false)
  }

  // Format value with <SEP> replaced by newlines for display
  const displayValue = typeof value === 'string' ? value.replace(/<SEP>/g, ';\n') : String(value || '-')

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-1">
        <label className="text-xs font-medium text-muted-foreground">{label}</label>
        {isEditable && !isEditing && (
          <button
            className="p-0.5 hover:bg-muted rounded"
            onClick={() => setIsEditing(true)}
            title="Edit"
          >
            <EditIcon className="h-3 w-3 text-muted-foreground hover:text-primary" />
          </button>
        )}
      </div>
      {isEditing ? (
        <div className="flex flex-col gap-1">
          {multiline ? (
            <textarea
              value={editValue}
              onChange={(e) => setEditValue(e.target.value)}
              className="w-full min-h-[60px] p-1 text-sm border rounded resize-y bg-background"
              autoFocus
            />
          ) : (
            <Input
              value={editValue}
              onChange={(e) => setEditValue(e.target.value)}
              className="h-7 text-sm"
              autoFocus
            />
          )}
          <div className="flex gap-1">
            <Button variant="ghost" size="sm" className="h-6 px-2 text-xs" onClick={handleCancel}>
              <XIcon className="h-3 w-3 mr-1" />
              Cancel
            </Button>
            <Button variant="default" size="sm" className="h-6 px-2 text-xs" onClick={handleSave}>
              <SaveIcon className="h-3 w-3 mr-1" />
              Save
            </Button>
          </div>
        </div>
      ) : (
        <div
          className="text-sm whitespace-pre-wrap break-words max-h-[100px] overflow-auto"
          title={displayValue}
        >
          {displayValue}
        </div>
      )}
    </div>
  )
}

// Property row component for non-editable properties
function PropertyRow({
  label,
  value,
  onClick,
  truncated
}: {
  label: string
  value: string
  onClick?: () => void
  truncated?: boolean
}) {
  const displayValue = typeof value === 'string' ? value.replace(/<SEP>/g, ';\n') : String(value || '-')

  return (
    <div className="flex flex-col gap-1">
      <label className="text-xs font-medium text-muted-foreground">
        {label}
        {truncated && <sup className="text-red-500 ml-0.5">*</sup>}
      </label>
      <div
        className={cn(
          'text-sm whitespace-pre-wrap break-words max-h-[100px] overflow-auto',
          onClick && 'cursor-pointer hover:text-primary hover:underline'
        )}
        title={displayValue}
        onClick={onClick}
      >
        {displayValue}
      </div>
    </div>
  )
}

// Neighbor list component
function NeighborList({
  neighbors,
  onNeighborClick
}: {
  neighbors: { id: string; label: string }[]
  onNeighborClick: (id: string) => void
}) {
  const { t } = useTranslation()

  if (neighbors.length === 0) return null

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-1">
        <UsersIcon className="h-3 w-3 text-muted-foreground" />
        <label className="text-xs font-medium text-muted-foreground">
          {t('entityManagement.detailPanel.neighbors')} ({neighbors.length})
        </label>
      </div>
      <div className="flex flex-wrap gap-1 max-h-[80px] overflow-auto">
        {neighbors.map((neighbor) => (
          <button
            key={neighbor.id}
            className="px-2 py-0.5 text-xs bg-muted hover:bg-primary/20 rounded-full cursor-pointer transition-colors"
            onClick={() => onNeighborClick(neighbor.id)}
            title={neighbor.label}
          >
            {neighbor.label.length > 20 ? neighbor.label.slice(0, 20) + '...' : neighbor.label}
          </button>
        ))}
      </div>
    </div>
  )
}

export default function EntityDetailPanel() {
  const { t } = useTranslation()
  const [isExpanded, setIsExpanded] = useState(true)
  const [saving, setSaving] = useState(false)
  const [editedFields, setEditedFields] = useState<Record<string, string>>({})
  const [imagePreview, setImagePreview] = useState<{ url: string; title: string } | null>(null)

  const selectedEntityId = useEntityManagementStore.use.selectedEntityId()
  const entities = useEntityManagementStore.use.entities()
  const fetchEntities = useEntityManagementStore.use.fetchEntities()
  const pagination = useEntityManagementStore.use.entitiesPagination()
  const graphSelectedNode = useEntityManagementStore.use.graphSelectedNode()
  const graphSelectedNodeData = useEntityManagementStore.use.graphSelectedNodeData()
  const graphSelectedEdge = useEntityManagementStore.use.graphSelectedEdge()
  const setGraphSelectedNode = useEntityManagementStore.use.setGraphSelectedNode()

  // Determine what to display: edge takes priority if selected
  const displayMode = useMemo(() => {
    if (graphSelectedEdge) return 'edge'
    if (graphSelectedNode || graphSelectedNodeData || selectedEntityId) return 'entity'
    return 'none'
  }, [graphSelectedEdge, graphSelectedNode, graphSelectedNodeData, selectedEntityId])

  // Find selected entity from the entities list (use graphSelectedNode if available, otherwise selectedEntityId)
  const activeEntityId = graphSelectedNode || selectedEntityId
  const selectedEntity = useMemo(() => {
    if (!activeEntityId) return null
    return entities.find(e => e.entity_id === activeEntityId) || null
  }, [activeEntityId, entities])

  // Reset edited fields when selection changes
  useEffect(() => {
    setEditedFields({})
  }, [activeEntityId, graphSelectedEdge])

  // Auto-expand panel when something is selected (from list or graph)
  useEffect(() => {
    if (graphSelectedNode || graphSelectedEdge || selectedEntityId) {
      setIsExpanded(true)
    }
  }, [graphSelectedNode, graphSelectedEdge, selectedEntityId])

  const handleToggle = useCallback(() => {
    setIsExpanded((prev) => !prev)
  }, [])

  const handleFieldChange = useCallback((field: string, value: string) => {
    setEditedFields((prev) => ({ ...prev, [field]: value }))
  }, [])

  const handleSaveEntity = useCallback(async () => {
    if (!activeEntityId || Object.keys(editedFields).length === 0) {
      return
    }

    setSaving(true)
    try {
      await updateEntity(activeEntityId, editedFields)
      setEditedFields({})
      fetchEntities(pagination.page)
      toast.success(t('entityManagement.detailPanel.saveSuccess'))
    } catch (error) {
      console.error('Failed to save entity:', error)
      toast.error(t('entityManagement.detailPanel.saveFailed'))
    } finally {
      setSaving(false)
    }
  }, [activeEntityId, editedFields, fetchEntities, pagination.page, t])

  const handleSaveEdge = useCallback(async () => {
    if (!graphSelectedEdge || Object.keys(editedFields).length === 0) {
      return
    }

    setSaving(true)
    try {
      await updateRelation(graphSelectedEdge.source, graphSelectedEdge.target, editedFields)
      setEditedFields({})
      toast.success(t('entityManagement.detailPanel.saveSuccess'))
    } catch (error) {
      console.error('Failed to save relation:', error)
      toast.error(t('entityManagement.detailPanel.saveFailed'))
    } finally {
      setSaving(false)
    }
  }, [graphSelectedEdge, editedFields, t])

  const handleCancel = useCallback(() => {
    setEditedFields({})
  }, [])

  const handleNeighborClick = useCallback((neighborId: string) => {
    // Note: This needs proper implementation to pass nodeData
    // For now, we just set the node ID
    setGraphSelectedNode(neighborId, null)
  }, [setGraphSelectedNode])

  const hasChanges = Object.keys(editedFields).length > 0

  // Get value (edited or original)
  const getValue = (field: string, originalValue: any) => {
    return editedFields[field] !== undefined ? editedFields[field] : String(originalValue || '')
  }

  // Check if entity type is image
  const isImageType = useMemo(() => {
    if (displayMode === 'entity') {
      const entityType = graphSelectedNodeData?.properties?.entity_type ||
                        selectedEntity?.entity_type || ''
      return entityType.toLowerCase() === 'image'
    }
    return false
  }, [displayMode, graphSelectedNodeData, selectedEntity])

  // Get image URL: prefer s3_url, fall back to file_path via backend proxy
  const imageUrl = useMemo(() => {
    if (!isImageType) return null

    // Prefer S3 URL if available (uploaded images)
    const s3Url = graphSelectedNodeData?.properties?.s3_url ||
                  selectedEntity?.s3_url || ''
    if (s3Url) return s3Url

    // Fallback to local file path via backend proxy
    const filePath = graphSelectedNodeData?.properties?.file_path ||
                    selectedEntity?.file_path || ''
    if (!filePath) return null
    return `${backendBaseUrl}/documents/file?path=${encodeURIComponent(filePath)}`
  }, [isImageType, graphSelectedNodeData, selectedEntity])

  // Get display title based on mode
  const getDisplayTitle = () => {
    if (displayMode === 'edge' && graphSelectedEdge) {
      return `${graphSelectedEdge.source} → ${graphSelectedEdge.target}`
    }
    if (displayMode === 'entity' && activeEntityId) {
      return activeEntityId
    }
    return ''
  }

  // Panel header (always visible)
  const panelHeader = (
    <div
      className={cn(
        'flex items-center justify-between px-4 py-2 cursor-pointer border-t border-border/40',
        'bg-muted/50 hover:bg-muted/80 transition-colors'
      )}
      onClick={handleToggle}
    >
      <div className="flex items-center gap-2">
        {displayMode === 'edge' ? (
          <LinkIcon className="h-4 w-4 text-primary" />
        ) : displayMode === 'entity' ? (
          <BoxIcon className="h-4 w-4 text-primary" />
        ) : null}
        <span className="font-medium text-sm">
          {displayMode === 'edge'
            ? t('entityManagement.detailPanel.edgeTitle')
            : displayMode === 'entity'
            ? t('entityManagement.detailPanel.entityTitle')
            : t('entityManagement.detailPanel.title')}
        </span>
        {getDisplayTitle() && (
          <span className="text-xs text-muted-foreground truncate max-w-[300px]">
            - {getDisplayTitle()}
          </span>
        )}
      </div>
      <div className="flex items-center gap-2">
        {hasChanges && (
          <>
            <Button
              variant="ghost"
              size="sm"
              className="h-6 px-2"
              onClick={(e) => {
                e.stopPropagation()
                handleCancel()
              }}
              disabled={saving}
            >
              <XIcon className="h-3 w-3 mr-1" />
              {t('entityManagement.detailPanel.cancel')}
            </Button>
            <Button
              variant="default"
              size="sm"
              className="h-6 px-2"
              onClick={(e) => {
                e.stopPropagation()
                displayMode === 'edge' ? handleSaveEdge() : handleSaveEntity()
              }}
              disabled={saving}
            >
              {saving ? (
                <Loader2Icon className="h-3 w-3 mr-1 animate-spin" />
              ) : (
                <SaveIcon className="h-3 w-3 mr-1" />
              )}
              {t('entityManagement.detailPanel.save')}
            </Button>
          </>
        )}
        {isExpanded ? (
          <ChevronDownIcon className="h-4 w-4" />
        ) : (
          <ChevronUpIcon className="h-4 w-4" />
        )}
      </div>
    </div>
  )

  if (displayMode === 'none') {
    return (
      <div className="border-t border-border/40">
        {panelHeader}
      </div>
    )
  }

  return (
    <div className="border-t border-border/40">
      {panelHeader}

      {isExpanded && (
        <div className="max-h-[350px] overflow-auto bg-background p-4">
          {displayMode === 'edge' && graphSelectedEdge ? (
            // Edge properties display
            <div className="space-y-4">
              {/* Basic edge info */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <PropertyRow
                  label={t('entityManagement.detailPanel.edgeFields.id')}
                  value={graphSelectedEdge.id || '-'}
                />
                <PropertyRow
                  label={t('entityManagement.detailPanel.edgeFields.type')}
                  value={graphSelectedEdge.type || '-'}
                />
                <PropertyRow
                  label={t('entityManagement.detailPanel.edgeFields.source')}
                  value={graphSelectedEdge.source}
                  onClick={() => handleNeighborClick(graphSelectedEdge.source)}
                />
                <PropertyRow
                  label={t('entityManagement.detailPanel.edgeFields.target')}
                  value={graphSelectedEdge.target}
                  onClick={() => handleNeighborClick(graphSelectedEdge.target)}
                />
              </div>

              {/* Editable and other properties */}
              <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                <EditableField
                  label={t('entityManagement.detailPanel.edgeFields.keywords')}
                  value={getValue('keywords', graphSelectedEdge.keywords)}
                  isEditable={true}
                  onChange={(value) => handleFieldChange('keywords', value)}
                />
                <PropertyRow
                  label={t('entityManagement.detailPanel.edgeFields.weight')}
                  value={graphSelectedEdge.weight?.toFixed(2) || '-'}
                />
                <PropertyRow
                  label={t('entityManagement.detailPanel.edgeFields.source_id')}
                  value={graphSelectedEdge.source_id || graphSelectedEdge.properties?.source_id || '-'}
                />
              </div>

              {/* Description - full width editable */}
              <EditableField
                label={t('entityManagement.detailPanel.edgeFields.description')}
                value={getValue('description', graphSelectedEdge.description)}
                isEditable={true}
                onChange={(value) => handleFieldChange('description', value)}
                multiline
              />

              {/* Additional properties if any */}
              {graphSelectedEdge.properties && Object.keys(graphSelectedEdge.properties).length > 0 && (
                <div>
                  <h4 className="text-xs font-medium text-muted-foreground mb-2">
                    {t('entityManagement.detailPanel.additionalProperties')}
                  </h4>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
                    {Object.entries(graphSelectedEdge.properties)
                      .filter(([key]) => !['keywords', 'description', 'weight', 'source_id', 'created_at', 'truncate'].includes(key))
                      .map(([key, value]) => (
                        <div key={key} className="flex flex-col">
                          <span className="text-muted-foreground">{key}</span>
                          <span className="truncate" title={String(value)}>
                            {String(value || '-')}
                          </span>
                        </div>
                      ))}
                  </div>
                </div>
              )}
            </div>
          ) : displayMode === 'entity' ? (
            // Entity properties display
            <div className="space-y-4">
              {/* Image preview for image type entities */}
              {isImageType && imageUrl && (
                <div className="flex items-center gap-4 p-3 bg-muted/30 rounded-lg">
                  <div className="relative w-20 h-20 flex-shrink-0 rounded overflow-hidden border">
                    <img
                      src={imageUrl}
                      alt={activeEntityId || 'Image'}
                      className="w-full h-full object-cover cursor-pointer hover:opacity-80 transition-opacity"
                      onClick={() => setImagePreview({ url: imageUrl, title: activeEntityId || 'Image' })}
                      onError={(e) => {
                        (e.target as HTMLImageElement).style.display = 'none'
                      }}
                    />
                  </div>
                  <div className="flex flex-col gap-1">
                    <div className="flex items-center gap-1 text-sm font-medium">
                      <ImageIcon className="h-4 w-4" />
                      {t('entityManagement.detailPanel.imagePreview')}
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-7"
                      onClick={() => setImagePreview({ url: imageUrl, title: activeEntityId || 'Image' })}
                    >
                      {t('entityManagement.detailPanel.viewFullImage')}
                    </Button>
                  </div>
                </div>
              )}

              {/* Basic entity info from graphSelectedNodeData or selectedEntity */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <PropertyRow
                  label={t('entityManagement.detailPanel.fields.entity_id')}
                  value={activeEntityId || '-'}
                />
                {graphSelectedNodeData?.labels && graphSelectedNodeData.labels.length > 0 && (
                  <PropertyRow
                    label={t('entityManagement.detailPanel.fields.labels')}
                    value={graphSelectedNodeData.labels.join(', ')}
                  />
                )}
                <PropertyRow
                  label={t('entityManagement.detailPanel.fields.entity_type')}
                  value={graphSelectedNodeData?.properties?.entity_type || selectedEntity?.entity_type || '-'}
                />
                <PropertyRow
                  label={t('entityManagement.detailPanel.fields.degree')}
                  value={String(graphSelectedNodeData?.degree || selectedEntity?.degree || 0)}
                />
              </div>

              {/* Description - editable */}
              <EditableField
                label={t('entityManagement.detailPanel.fields.description')}
                value={getValue('description', graphSelectedNodeData?.properties?.description || selectedEntity?.description)}
                isEditable={true}
                onChange={(value) => handleFieldChange('description', value)}
                multiline
              />

              {/* Source info */}
              <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                <PropertyRow
                  label={t('entityManagement.detailPanel.fields.source_id')}
                  value={graphSelectedNodeData?.properties?.source_id || selectedEntity?.source_id || '-'}
                  truncated={!!(graphSelectedNodeData?.properties?.truncate || selectedEntity?.source_id?.includes('...'))}
                />
                <PropertyRow
                  label={t('entityManagement.detailPanel.fields.file_path')}
                  value={graphSelectedNodeData?.properties?.file_path || selectedEntity?.file_path || '-'}
                />
                {(graphSelectedNodeData?.properties?.created_at || selectedEntity?.created_at) && (
                  <PropertyRow
                    label={t('entityManagement.detailPanel.fields.created_at')}
                    value={graphSelectedNodeData?.properties?.created_at || selectedEntity?.created_at || '-'}
                  />
                )}
              </div>

              {/* Neighbors list */}
              {graphSelectedNodeData?.neighbors && graphSelectedNodeData.neighbors.length > 0 && (
                <NeighborList
                  neighbors={graphSelectedNodeData.neighbors}
                  onNeighborClick={handleNeighborClick}
                />
              )}

              {/* Additional properties from graphSelectedNodeData */}
              {graphSelectedNodeData?.properties && Object.keys(graphSelectedNodeData.properties).length > 0 && (
                <div>
                  <h4 className="text-xs font-medium text-muted-foreground mb-2">
                    {t('entityManagement.detailPanel.additionalProperties')}
                  </h4>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
                    {Object.entries(graphSelectedNodeData.properties)
                      .filter(([key]) => !['entity_id', 'entity_type', 'description', 'source_id', 'file_path', 'created_at', 'truncate'].includes(key))
                      .map(([key, value]) => (
                        <div key={key} className="flex flex-col">
                          <span className="text-muted-foreground">{key}</span>
                          <span className="truncate" title={String(value)}>
                            {String(value || '-')}
                          </span>
                        </div>
                      ))}
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="text-center text-muted-foreground py-4">
              {t('entityManagement.detailPanel.noData')}
            </div>
          )}
        </div>
      )}

      {/* Image preview dialog */}
      {imagePreview && (
        <ImagePreviewDialog
          isOpen={!!imagePreview}
          onClose={() => setImagePreview(null)}
          imageUrl={imagePreview.url}
          title={imagePreview.title}
        />
      )}
    </div>
  )
}

import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/Dialog'
import Input from '@/components/ui/Input'
import { Label } from '@/components/ui/Label'
import Textarea from '@/components/ui/Textarea'
import Button from '@/components/ui/Button'
import { useWorkspaceStore } from '@/stores/workspace'
import { getWorkspaceMode, WorkspaceMode } from '@/api/lightrag'
import { toast } from 'sonner'
import { BookOpenIcon, DatabaseIcon, LayersIcon, Loader2Icon } from 'lucide-react'
import { cn } from '@/lib/utils'

interface WorkspaceDialogProps {
  mode: 'create' | 'edit'
  open: boolean
  onOpenChange: (open: boolean) => void
}

export default function WorkspaceDialog({ mode, open, onOpenChange }: WorkspaceDialogProps) {
  const { t } = useTranslation()

  const selectedWorkspace = useWorkspaceStore.use.selectedWorkspace()
  const isLoading = useWorkspaceStore.use.isLoading()
  const createNewWorkspace = useWorkspaceStore.use.createNewWorkspace()
  const updateExistingWorkspace = useWorkspaceStore.use.updateExistingWorkspace()

  const [workspaceId, setWorkspaceId] = useState('')
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [workspaceMode, setWorkspaceMode] = useState<WorkspaceMode>('kms')
  const [idError, setIdError] = useState('')

  // Reset form when dialog opens
  useEffect(() => {
    if (open) {
      if (mode === 'edit' && selectedWorkspace) {
        setWorkspaceId(selectedWorkspace.workspace_id)
        setName(selectedWorkspace.name)
        setDescription(selectedWorkspace.description || '')
        setWorkspaceMode(getWorkspaceMode(selectedWorkspace))
      } else {
        setWorkspaceId('')
        setName('')
        setDescription('')
        setWorkspaceMode('kms')
      }
      setIdError('')
    }
  }, [open, mode, selectedWorkspace])

  // Validate workspace ID
  const validateWorkspaceId = (id: string) => {
    if (!id) {
      setIdError('')
      return true
    }
    const regex = /^[a-zA-Z0-9_-]+$/
    if (!regex.test(id)) {
      setIdError(t('workspace.workspaceIdHint'))
      return false
    }
    setIdError('')
    return true
  }

  const handleWorkspaceIdChange = (value: string) => {
    setWorkspaceId(value)
    validateWorkspaceId(value)
  }

  const handleSubmit = async () => {
    if (mode === 'create') {
      if (!workspaceId || !name) {
        toast.error(t('workspace.requiredFields', 'Please fill in all required fields'))
        return
      }
      if (!validateWorkspaceId(workspaceId)) {
        return
      }

      try {
        await createNewWorkspace({
          workspace_id: workspaceId,
          name,
          description: description || undefined,
          workspace_mode: workspaceMode,
          metadata: {
            ...(workspaceMode !== 'kms'
              ? {
                answer_catalog: {
                  default_lookup_mode: 'hybrid_fast',
                  structured_lookup_enabled: workspaceMode !== 'kms',
                  default_display_policy: 'both',
                },
              }
              : {}),
          },
        })
        toast.success(t('workspace.created'))
        onOpenChange(false)
      } catch (error: any) {
        toast.error(error.response?.data?.detail || t('workspace.createError'))
      }
    } else {
      if (!name) {
        toast.error(t('workspace.requiredFields', 'Please fill in all required fields'))
        return
      }

      try {
        const nextMetadata = { ...(selectedWorkspace?.metadata || {}) }
        delete nextMetadata.workspace_mode
        if (workspaceMode !== 'kms') {
          nextMetadata.answer_catalog = {
            ...(selectedWorkspace?.metadata?.answer_catalog || {}),
            default_lookup_mode: selectedWorkspace?.metadata?.answer_catalog?.default_lookup_mode || 'hybrid_fast',
            structured_lookup_enabled: selectedWorkspace?.metadata?.answer_catalog?.structured_lookup_enabled ?? true,
            default_display_policy: selectedWorkspace?.metadata?.answer_catalog?.default_display_policy || 'both',
          }
        }
        await updateExistingWorkspace(selectedWorkspace!.workspace_id, {
          name,
          description: description || undefined,
          workspace_mode: workspaceMode,
          metadata: nextMetadata,
        })
        toast.success(t('workspace.updated'))
        onOpenChange(false)
      } catch (error: any) {
        toast.error(error.response?.data?.detail || t('workspace.updateError'))
      }
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>
            {mode === 'create' ? t('workspace.create') : t('workspace.edit')}
          </DialogTitle>
          <DialogDescription>
            {mode === 'create'
              ? t('workspace.createDescription', 'Create a new workspace for data isolation.')
              : t('workspace.editDescription', 'Update workspace information.')}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 py-4">
          {/* Workspace ID (only for create) */}
          {mode === 'create' && (
            <div className="grid gap-2">
              <Label htmlFor="workspace-id">
                {t('workspace.workspaceId')} <span className="text-destructive">*</span>
              </Label>
              <Input
                id="workspace-id"
                value={workspaceId}
                onChange={(e) => handleWorkspaceIdChange(e.target.value)}
                placeholder={t('workspace.workspaceIdPlaceholder')}
                className={idError ? 'border-destructive' : ''}
              />
              {idError && (
                <p className="text-xs text-destructive">{idError}</p>
              )}
              <p className="text-xs text-muted-foreground">
                {t('workspace.workspaceIdHint')}
              </p>
            </div>
          )}

          {/* Display Name */}
          <div className="grid gap-2">
            <Label htmlFor="name">
              {t('workspace.name')} <span className="text-destructive">*</span>
            </Label>
            <Input
              id="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t('workspace.namePlaceholder')}
            />
          </div>

          {/* Description */}
          <div className="grid gap-2">
            <Label htmlFor="description">{t('workspace.description')}</Label>
            <Textarea
              id="description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={t('workspace.descriptionPlaceholder')}
              rows={3}
            />
          </div>

          <div className="grid gap-2">
            <Label>{t('workspace.mode', 'Workspace Type')}</Label>
            <div className="grid gap-2">
              <WorkspaceModeCard
                value="kms"
                selected={workspaceMode === 'kms'}
                onSelect={setWorkspaceMode}
                icon={DatabaseIcon}
                title={t('workspace.modeKms', 'KMS')}
                description={t('workspace.modeKmsDesc', 'Use the existing document, graph, schema, and RAG search workflow.')}
              />
              <WorkspaceModeCard
                value="answer_catalog"
                selected={workspaceMode === 'answer_catalog'}
                onSelect={setWorkspaceMode}
                icon={BookOpenIcon}
                title={t('workspace.modeAnswerCatalog', 'FAQ / Approved Answers')}
                description={t('workspace.modeAnswerCatalogDesc', 'Manage approved answers, matching data, sources, and lookup analytics.')}
              />
              <WorkspaceModeCard
                value="hybrid"
                selected={workspaceMode === 'hybrid'}
                onSelect={setWorkspaceMode}
                icon={LayersIcon}
                title={t('workspace.modeHybrid', 'Hybrid')}
                description={t('workspace.modeHybridDesc', 'Use fixed-answer lookup together with the existing KMS/RAG workflow.')}
              />
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isLoading}>
            {t('common.cancel')}
          </Button>
          <Button onClick={handleSubmit} disabled={isLoading}>
            {isLoading && <Loader2Icon className="mr-2 h-4 w-4 animate-spin" />}
            {mode === 'create' ? t('workspace.create') : t('common.save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function WorkspaceModeCard({
  value,
  selected,
  onSelect,
  icon: Icon,
  title,
  description,
}: {
  value: WorkspaceMode
  selected: boolean
  onSelect: (mode: WorkspaceMode) => void
  icon: typeof DatabaseIcon
  title: string
  description: string
}) {
  return (
    <button
      type="button"
      className={cn(
        'rounded-md border p-3 text-left transition-colors hover:bg-accent',
        selected ? 'border-primary bg-primary/5 shadow-sm' : 'border-border bg-background'
      )}
      onClick={() => onSelect(value)}
    >
      <div className="flex gap-3">
        <Icon className={cn('mt-0.5 h-4 w-4', selected ? 'text-primary' : 'text-muted-foreground')} />
        <div>
          <div className="text-sm font-medium">{title}</div>
          <div className="mt-1 text-xs leading-5 text-muted-foreground">{description}</div>
        </div>
      </div>
    </button>
  )
}

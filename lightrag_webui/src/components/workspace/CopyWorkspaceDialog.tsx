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
import { Label } from '@/components/ui/Label'
import Checkbox from '@/components/ui/Checkbox'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/Select'
import Button from '@/components/ui/Button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/Tabs'
import { useWorkspaceStore } from '@/stores/workspace'
import { toast } from 'sonner'
import { Loader2Icon, SettingsIcon, DatabaseIcon, ArrowRightLeftIcon, AlertTriangleIcon } from 'lucide-react'

interface CopyWorkspaceDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export default function CopyWorkspaceDialog({ open, onOpenChange }: CopyWorkspaceDialogProps) {
  const { t } = useTranslation()

  const selectedWorkspace = useWorkspaceStore.use.selectedWorkspace()
  const workspaces = useWorkspaceStore.use.workspaces()
  const isLoading = useWorkspaceStore.use.isLoading()
  const copySettings = useWorkspaceStore.use.copySettings()
  const copyData = useWorkspaceStore.use.copyData()
  const moveData = useWorkspaceStore.use.moveData()

  const [copyType, setCopyType] = useState<'settings' | 'data' | 'move'>('settings')
  const [targetWorkspaceId, setTargetWorkspaceId] = useState('')

  // Settings options
  const [includePrompts, setIncludePrompts] = useState(true)
  const [includeTemplates, setIncludeTemplates] = useState(true)

  // Data options (for copy)
  const [includeDocuments, setIncludeDocuments] = useState(true)
  const [includeEntities, setIncludeEntities] = useState(true)
  const [includeRelations, setIncludeRelations] = useState(true)
  const [includeVectors, setIncludeVectors] = useState(true)

  // Move options
  const [moveDocuments, setMoveDocuments] = useState(true)
  const [moveEntities, setMoveEntities] = useState(true)
  const [moveRelations, setMoveRelations] = useState(true)
  const [moveVectors, setMoveVectors] = useState(true)

  // Get available target workspaces (exclude source)
  const targetWorkspaces = workspaces.filter(
    ws => ws.workspace_id !== selectedWorkspace?.workspace_id
  )

  // Reset form when dialog opens
  useEffect(() => {
    if (open) {
      setTargetWorkspaceId('')
      setCopyType('settings')
      setIncludePrompts(true)
      setIncludeTemplates(true)
      setIncludeDocuments(true)
      setIncludeEntities(true)
      setIncludeRelations(true)
      setIncludeVectors(true)
      setMoveDocuments(true)
      setMoveEntities(true)
      setMoveRelations(true)
      setMoveVectors(true)
    }
  }, [open])

  const handleCopy = async () => {
    if (!selectedWorkspace || !targetWorkspaceId) {
      toast.error(t('workspace.selectTarget'))
      return
    }

    try {
      if (copyType === 'settings') {
        await copySettings(selectedWorkspace.workspace_id, {
          target_workspace_id: targetWorkspaceId,
          include_prompts: includePrompts,
          include_templates: includeTemplates,
        })
        toast.success(t('workspace.settingsCopied'))
      } else if (copyType === 'data') {
        await copyData(selectedWorkspace.workspace_id, {
          target_workspace_id: targetWorkspaceId,
          include_documents: includeDocuments,
          include_entities: includeEntities,
          include_relations: includeRelations,
          include_vectors: includeVectors,
        })
        toast.success(t('workspace.dataCopied'))
      } else if (copyType === 'move') {
        await moveData(selectedWorkspace.workspace_id, {
          target_workspace_id: targetWorkspaceId,
          include_documents: moveDocuments,
          include_entities: moveEntities,
          include_relations: moveRelations,
          include_vectors: moveVectors,
        })
        toast.success(t('workspace.dataMoved'))
      }
      onOpenChange(false)
    } catch (error: any) {
      toast.error(error.response?.data?.detail || t('workspace.copyError'))
    }
  }

  if (!selectedWorkspace) return null

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>{t('workspace.copy')}</DialogTitle>
          <DialogDescription>
            Copy settings or data from "{selectedWorkspace.name}" to another workspace.
          </DialogDescription>
        </DialogHeader>

        <div className="py-4">
          {/* Target Workspace Selection */}
          <div className="grid gap-2 mb-4">
            <Label>{t('workspace.targetWorkspace')}</Label>
            <Select value={targetWorkspaceId} onValueChange={setTargetWorkspaceId}>
              <SelectTrigger>
                <SelectValue placeholder={t('workspace.selectTarget')} />
              </SelectTrigger>
              <SelectContent>
                {targetWorkspaces.length === 0 ? (
                  <SelectItem value="" disabled>
                    {t('workspace.noWorkspaces')}
                  </SelectItem>
                ) : (
                  targetWorkspaces.map((ws) => (
                    <SelectItem
                      key={ws.workspace_id}
                      value={ws.workspace_id}
                      disabled={ws.is_busy}
                    >
                      <div className="flex items-center gap-2">
                        <span>{ws.name}</span>
                        {ws.is_busy && (
                          <Loader2Icon className="h-3 w-3 animate-spin text-muted-foreground" />
                        )}
                      </div>
                    </SelectItem>
                  ))
                )}
              </SelectContent>
            </Select>
          </div>

          {/* Copy Type Tabs */}
          <Tabs value={copyType} onValueChange={(v) => setCopyType(v as 'settings' | 'data' | 'move')}>
            <TabsList className="grid w-full grid-cols-3">
              <TabsTrigger value="settings" className="flex items-center gap-2">
                <SettingsIcon className="h-4 w-4" />
                {t('workspace.copySettings')}
              </TabsTrigger>
              <TabsTrigger value="data" className="flex items-center gap-2">
                <DatabaseIcon className="h-4 w-4" />
                {t('workspace.copyData')}
              </TabsTrigger>
              <TabsTrigger value="move" className="flex items-center gap-2">
                <ArrowRightLeftIcon className="h-4 w-4" />
                {t('workspace.moveData')}
              </TabsTrigger>
            </TabsList>

            <TabsContent value="settings" className="mt-4 space-y-3">
              <div className="flex items-center space-x-2">
                <Checkbox
                  id="include-prompts"
                  checked={includePrompts}
                  onCheckedChange={(checked) => setIncludePrompts(checked as boolean)}
                />
                <Label htmlFor="include-prompts" className="cursor-pointer">
                  {t('workspace.includePrompts')}
                </Label>
              </div>
              <div className="flex items-center space-x-2">
                <Checkbox
                  id="include-templates"
                  checked={includeTemplates}
                  onCheckedChange={(checked) => setIncludeTemplates(checked as boolean)}
                />
                <Label htmlFor="include-templates" className="cursor-pointer">
                  {t('workspace.includeTemplates')}
                </Label>
              </div>
            </TabsContent>

            <TabsContent value="data" className="mt-4 space-y-3">
              <div className="flex items-center space-x-2">
                <Checkbox
                  id="include-documents"
                  checked={includeDocuments}
                  onCheckedChange={(checked) => setIncludeDocuments(checked as boolean)}
                />
                <Label htmlFor="include-documents" className="cursor-pointer">
                  {t('workspace.includeDocuments')}
                </Label>
              </div>
              <div className="flex items-center space-x-2">
                <Checkbox
                  id="include-entities"
                  checked={includeEntities}
                  onCheckedChange={(checked) => setIncludeEntities(checked as boolean)}
                />
                <Label htmlFor="include-entities" className="cursor-pointer">
                  {t('workspace.includeEntities')}
                </Label>
              </div>
              <div className="flex items-center space-x-2">
                <Checkbox
                  id="include-relations"
                  checked={includeRelations}
                  onCheckedChange={(checked) => setIncludeRelations(checked as boolean)}
                />
                <Label htmlFor="include-relations" className="cursor-pointer">
                  {t('workspace.includeRelations')}
                </Label>
              </div>
              <div className="flex items-center space-x-2">
                <Checkbox
                  id="include-vectors"
                  checked={includeVectors}
                  onCheckedChange={(checked) => setIncludeVectors(checked as boolean)}
                />
                <Label htmlFor="include-vectors" className="cursor-pointer">
                  {t('workspace.includeVectors')}
                </Label>
              </div>
              <p className="text-xs text-muted-foreground mt-2">
                Note: Copying large amounts of data may take some time.
              </p>
            </TabsContent>

            <TabsContent value="move" className="mt-4 space-y-3">
              {/* Warning Banner */}
              <div className="flex items-start gap-2 p-3 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-md">
                <AlertTriangleIcon className="h-5 w-5 text-amber-600 dark:text-amber-500 flex-shrink-0 mt-0.5" />
                <div className="text-sm text-amber-800 dark:text-amber-200">
                  <p className="font-medium">{t('workspace.moveWarningTitle')}</p>
                  <p className="mt-1 text-amber-700 dark:text-amber-300">{t('workspace.moveWarningDesc')}</p>
                </div>
              </div>

              <div className="flex items-center space-x-2">
                <Checkbox
                  id="move-documents"
                  checked={moveDocuments}
                  onCheckedChange={(checked) => setMoveDocuments(checked as boolean)}
                />
                <Label htmlFor="move-documents" className="cursor-pointer">
                  {t('workspace.includeDocuments')}
                </Label>
              </div>
              <div className="flex items-center space-x-2">
                <Checkbox
                  id="move-entities"
                  checked={moveEntities}
                  onCheckedChange={(checked) => setMoveEntities(checked as boolean)}
                />
                <Label htmlFor="move-entities" className="cursor-pointer">
                  {t('workspace.includeEntities')}
                </Label>
              </div>
              <div className="flex items-center space-x-2">
                <Checkbox
                  id="move-relations"
                  checked={moveRelations}
                  onCheckedChange={(checked) => setMoveRelations(checked as boolean)}
                />
                <Label htmlFor="move-relations" className="cursor-pointer">
                  {t('workspace.includeRelations')}
                </Label>
              </div>
              <div className="flex items-center space-x-2">
                <Checkbox
                  id="move-vectors"
                  checked={moveVectors}
                  onCheckedChange={(checked) => setMoveVectors(checked as boolean)}
                />
                <Label htmlFor="move-vectors" className="cursor-pointer">
                  {t('workspace.includeVectors')}
                </Label>
              </div>
            </TabsContent>
          </Tabs>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isLoading}>
            {t('common.cancel')}
          </Button>
          <Button
            onClick={handleCopy}
            disabled={isLoading || !targetWorkspaceId}
            variant={copyType === 'move' ? 'destructive' : 'default'}
          >
            {isLoading && <Loader2Icon className="mr-2 h-4 w-4 animate-spin" />}
            {copyType === 'settings'
              ? t('workspace.copySettings')
              : copyType === 'data'
                ? t('workspace.copyData')
                : t('workspace.moveData')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

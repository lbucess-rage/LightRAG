import { useTranslation } from 'react-i18next'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/AlertDialog'
import { useWorkspaceStore } from '@/stores/workspace'
import { toast } from 'sonner'
import { Loader2Icon, AlertTriangleIcon } from 'lucide-react'

interface DeleteWorkspaceDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export default function DeleteWorkspaceDialog({ open, onOpenChange }: DeleteWorkspaceDialogProps) {
  const { t } = useTranslation()

  const selectedWorkspace = useWorkspaceStore.use.selectedWorkspace()
  const isLoading = useWorkspaceStore.use.isLoading()
  const deleteExistingWorkspace = useWorkspaceStore.use.deleteExistingWorkspace()

  const handleDelete = async () => {
    if (!selectedWorkspace) return

    // Check if default workspace
    if (selectedWorkspace.is_default) {
      toast.error(t('workspace.cannotDeleteDefault'))
      return
    }

    // Check if busy
    if (selectedWorkspace.is_busy) {
      toast.error(t('workspace.cannotDeleteBusy'))
      return
    }

    try {
      await deleteExistingWorkspace(selectedWorkspace.workspace_id)
      toast.success(t('workspace.deleted'))
      onOpenChange(false)
    } catch (error: any) {
      toast.error(error.response?.data?.detail || t('workspace.deleteError'))
    }
  }

  if (!selectedWorkspace) return null

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2">
            <AlertTriangleIcon className="h-5 w-5 text-destructive" />
            {t('workspace.delete')}
          </AlertDialogTitle>
          <AlertDialogDescription className="space-y-2">
            <p>
              {t('workspace.confirmDelete', { name: selectedWorkspace.name })}
            </p>
            <p className="text-destructive font-medium">
              {t('workspace.confirmDeleteWarning')}
            </p>
            <div className="mt-4 p-3 bg-muted rounded-md text-sm">
              <div className="grid grid-cols-2 gap-2">
                <span className="text-muted-foreground">{t('workspace.documents')}:</span>
                <span className="font-medium">{selectedWorkspace.document_count}</span>
                <span className="text-muted-foreground">{t('workspace.entities')}:</span>
                <span className="font-medium">{selectedWorkspace.entity_count}</span>
                <span className="text-muted-foreground">{t('workspace.relations')}:</span>
                <span className="font-medium">{selectedWorkspace.relation_count}</span>
              </div>
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={isLoading}>{t('common.cancel')}</AlertDialogCancel>
          <AlertDialogAction
            onClick={handleDelete}
            disabled={isLoading || selectedWorkspace.is_default || selectedWorkspace.is_busy}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            {isLoading && <Loader2Icon className="mr-2 h-4 w-4 animate-spin" />}
            {t('workspace.delete')}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

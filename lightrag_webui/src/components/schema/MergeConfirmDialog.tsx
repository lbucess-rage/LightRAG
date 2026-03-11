import { useTranslation } from 'react-i18next'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/Dialog'
import Button from '@/components/ui/Button'
import Badge from '@/components/ui/Badge'
import { Alert, AlertDescription } from '@/components/ui/Alert'
import { useSchemaStore, MergeState } from '@/stores/schema'
import {
  GitMerge,
  AlertTriangle,
  CheckCircle,
  Plus,
  Copy,
  Loader2,
  ArrowRight,
} from 'lucide-react'

interface MergeConfirmDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  newEntityTypes: string[]
  source: string
  onConfirm: () => void
}

export function MergeConfirmDialog({
  open,
  onOpenChange,
  newEntityTypes,
  source,
  onConfirm,
}: MergeConfirmDialogProps) {
  const { t } = useTranslation()
  const { merge, previewMerge, applyMerge, clearMergePreview } = useSchemaStore()

  // 다이얼로그 열릴 때 미리보기 로드
  const handleOpenChange = async (isOpen: boolean) => {
    if (isOpen && newEntityTypes.length > 0) {
      try {
        await previewMerge(newEntityTypes, source)
      } catch (error) {
        console.error('Failed to load merge preview:', error)
      }
    } else if (!isOpen) {
      clearMergePreview()
    }
    onOpenChange(isOpen)
  }

  const handleConfirm = async () => {
    try {
      await applyMerge(newEntityTypes, source, true)
      onConfirm()
      onOpenChange(false)
    } catch (error) {
      console.error('Failed to apply merge:', error)
    }
  }

  const handleCancel = () => {
    clearMergePreview()
    onOpenChange(false)
  }

  const { previewResult, isPreviewLoading, isMerging, mergeError } = merge

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <GitMerge className="w-5 h-5" />
            {t('schema.merge.title', 'Merge Schema')}
          </DialogTitle>
          <DialogDescription>
            {t('schema.merge.description', 'Review the merge preview before applying.')}
          </DialogDescription>
        </DialogHeader>

        {/* Loading State */}
        {isPreviewLoading && (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="w-6 h-6 animate-spin text-primary" />
            <span className="ml-2">{t('schema.merge.loading', 'Loading preview...')}</span>
          </div>
        )}

        {/* Error State */}
        {mergeError && (
          <Alert variant="destructive">
            <AlertTriangle className="w-4 h-4" />
            <AlertDescription>{mergeError}</AlertDescription>
          </Alert>
        )}

        {/* Preview Content */}
        {previewResult && !isPreviewLoading && (
          <div className="space-y-6">
            {/* Summary Stats */}
            <div className="grid grid-cols-4 gap-4">
              <div className="p-3 rounded-lg bg-muted/50 text-center">
                <div className="text-2xl font-bold">{previewResult.current_count}</div>
                <div className="text-xs text-muted-foreground">
                  {t('schema.merge.currentTypes', 'Current')}
                </div>
              </div>
              <div className="p-3 rounded-lg bg-green-500/10 text-center">
                <div className="text-2xl font-bold text-green-600">{previewResult.new_count}</div>
                <div className="text-xs text-muted-foreground">
                  {t('schema.merge.newTypes', 'New')}
                </div>
              </div>
              <div className="p-3 rounded-lg bg-amber-500/10 text-center">
                <div className="text-2xl font-bold text-amber-600">{previewResult.duplicate_count}</div>
                <div className="text-xs text-muted-foreground">
                  {t('schema.merge.duplicates', 'Duplicates')}
                </div>
              </div>
              <div className="p-3 rounded-lg bg-primary/10 text-center">
                <div className="text-2xl font-bold text-primary">{previewResult.merged_count}</div>
                <div className="text-xs text-muted-foreground">
                  {t('schema.merge.finalTotal', 'Final')}
                </div>
              </div>
            </div>

            {/* Duplicates Warning */}
            {previewResult.duplicates.length > 0 && (
              <Alert>
                <Copy className="w-4 h-4" />
                <AlertDescription>
                  <div className="font-medium mb-2">
                    {t('schema.merge.duplicateWarning', 'The following types already exist and will be skipped:')}
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {previewResult.duplicates.map((type) => (
                      <Badge key={type} variant="outline" className="text-amber-600">
                        {type}
                      </Badge>
                    ))}
                  </div>
                </AlertDescription>
              </Alert>
            )}

            {/* New Types to Add */}
            {previewResult.new_types.length > 0 && (
              <div>
                <h4 className="font-medium mb-2 flex items-center gap-2">
                  <Plus className="w-4 h-4 text-green-600" />
                  {t('schema.merge.typesToAdd', 'Types to be added')}
                  <Badge variant="secondary">{previewResult.new_types.length}</Badge>
                </h4>
                <div className="flex flex-wrap gap-1">
                  {previewResult.new_types.map((type) => (
                    <Badge key={type} variant="default" className="bg-green-600">
                      {type}
                    </Badge>
                  ))}
                </div>
              </div>
            )}

            {/* Final Result Preview */}
            <div>
              <h4 className="font-medium mb-2 flex items-center gap-2">
                <ArrowRight className="w-4 h-4" />
                {t('schema.merge.finalResult', 'Final merged result')}
                <Badge variant="outline">{previewResult.merged_count}</Badge>
              </h4>
              <div className="max-h-40 overflow-y-auto p-3 rounded-lg border bg-muted/30">
                <div className="flex flex-wrap gap-1">
                  {previewResult.merged_result.map((type) => {
                    const isNew = previewResult.new_types.includes(type)
                    return (
                      <Badge
                        key={type}
                        variant={isNew ? 'default' : 'secondary'}
                        className={isNew ? 'bg-green-600' : ''}
                      >
                        {type}
                        {isNew && <Plus className="w-3 h-3 ml-1" />}
                      </Badge>
                    )
                  })}
                </div>
              </div>
            </div>

            {/* No new types message */}
            {previewResult.new_types.length === 0 && (
              <Alert>
                <CheckCircle className="w-4 h-4" />
                <AlertDescription>
                  {t('schema.merge.allDuplicates', 'All types already exist. No new types will be added.')}
                </AlertDescription>
              </Alert>
            )}
          </div>
        )}

        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" onClick={handleCancel} disabled={isMerging}>
            {t('common.cancel', 'Cancel')}
          </Button>
          <Button
            onClick={handleConfirm}
            disabled={isMerging || isPreviewLoading || !previewResult || previewResult.new_types.length === 0}
          >
            {isMerging ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                {t('schema.merge.merging', 'Merging...')}
              </>
            ) : (
              <>
                <GitMerge className="w-4 h-4 mr-2" />
                {t('schema.merge.confirm', 'Confirm Merge')}
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/Card'
import Button from '@/components/ui/Button'
import Badge from '@/components/ui/Badge'
import Input from '@/components/ui/Input'
import { Alert, AlertDescription } from '@/components/ui/Alert'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/AlertDialog'
import { useSchemaStore } from '@/stores/schema'
import { useWorkspaceStore } from '@/stores/workspace'
import {
  Settings2,
  Plus,
  X,
  RotateCcw,
  Clock,
  Tag,
  Trash2,
  Upload,
  Loader2,
  CheckCircle,
  AlertCircle,
  RefreshCw,
} from 'lucide-react'

export function CurrentSchema() {
  const { t } = useTranslation()
  const [newEntityType, setNewEntityType] = useState('')
  const currentWorkspaceId = useWorkspaceStore.use.currentWorkspaceId()

  const {
    currentSchema,
    setCurrentSchema,
    resetCurrentSchema,
    loadCurrentSchemaFromServer,
    applySchemaToServer,
    resetSchemaOnServer,
  } = useSchemaStore()

  // 컴포넌트 마운트 시 및 워크스페이스 변경 시 서버에서 현재 스키마 로드
  useEffect(() => {
    loadCurrentSchemaFromServer()
  }, [loadCurrentSchemaFromServer, currentWorkspaceId])

  const handleAddEntityType = () => {
    if (!newEntityType.trim()) return
    if (currentSchema.entityTypes.includes(newEntityType.trim())) return

    setCurrentSchema(
      [...currentSchema.entityTypes, newEntityType.trim()],
      currentSchema.source || 'custom'
    )
    setNewEntityType('')
  }

  const handleRemoveEntityType = (entityType: string) => {
    setCurrentSchema(
      currentSchema.entityTypes.filter((e) => e !== entityType),
      'custom'
    )
  }

  const handleApplyToServer = async () => {
    try {
      await applySchemaToServer(currentSchema.entityTypes, currentSchema.source || 'custom')
    } catch (error) {
      console.error('Failed to apply schema:', error)
    }
  }

  const handleResetOnServer = async () => {
    try {
      await resetSchemaOnServer()
    } catch (error) {
      console.error('Failed to reset schema:', error)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      handleAddEntityType()
    }
  }

  const formatDate = (dateString: string | null) => {
    if (!dateString) return '-'
    return new Date(dateString).toLocaleString()
  }

  const getSourceLabel = (source: string | null) => {
    if (!source) return t('schema.current.default', 'Default')
    if (source.startsWith('template:')) {
      return source.replace('template:', '')
    }
    if (source === 'discovery') return t('schema.current.discovery', 'AI Discovery')
    if (source === 'custom') return t('schema.current.custom', 'Custom')
    return source
  }

  const getSourceVariant = (source: string | null): 'default' | 'secondary' | 'outline' => {
    if (!source) return 'outline'
    if (source.startsWith('template:')) return 'default'
    if (source === 'discovery') return 'secondary'
    return 'outline'
  }

  return (
    <div className="space-y-4">
      {/* Current Schema Info */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Settings2 className="w-5 h-5" />
            {t('schema.current.title', 'Current Schema Configuration')}
          </CardTitle>
          <CardDescription>
            {t(
              'schema.current.description',
              'Entity types currently used for knowledge graph extraction'
            )}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Metadata */}
          <div className="flex flex-wrap gap-4 text-sm">
            <div className="flex items-center gap-2">
              <Tag className="w-4 h-4 text-muted-foreground" />
              <span className="text-muted-foreground">{t('schema.current.source', 'Source')}:</span>
              <Badge variant={getSourceVariant(currentSchema.source)}>
                {getSourceLabel(currentSchema.source)}
              </Badge>
            </div>
            {currentSchema.appliedAt && (
              <div className="flex items-center gap-2">
                <Clock className="w-4 h-4 text-muted-foreground" />
                <span className="text-muted-foreground">{t('schema.current.appliedAt', 'Applied')}:</span>
                <span>{formatDate(currentSchema.appliedAt)}</span>
              </div>
            )}
          </div>

          {/* Entity Types Count */}
          <div className="p-4 rounded-lg bg-muted/50">
            <div className="text-2xl font-bold">{currentSchema.entityTypes.length}</div>
            <div className="text-sm text-muted-foreground">
              {t('schema.current.entityTypesCount', 'Entity Types Configured')}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Entity Types List */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">
            {t('schema.current.entityTypes', 'Entity Types')}
          </CardTitle>
          <CardDescription>
            {t(
              'schema.current.entityTypesDescription',
              'Add or remove entity types that will be extracted from documents'
            )}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Add New Entity Type */}
          <div className="flex gap-2">
            <Input
              placeholder={t('schema.current.newEntityTypePlaceholder', 'Enter new entity type...')}
              value={newEntityType}
              onChange={(e) => setNewEntityType(e.target.value)}
              onKeyDown={handleKeyDown}
              className="flex-1"
            />
            <Button onClick={handleAddEntityType} disabled={!newEntityType.trim()}>
              <Plus className="w-4 h-4 mr-2" />
              {t('schema.current.add', 'Add')}
            </Button>
          </div>

          {/* Entity Types Grid */}
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2">
            {currentSchema.entityTypes.map((entityType) => (
              <div
                key={entityType}
                className="flex items-center justify-between p-2 rounded-md border bg-card hover:bg-accent/50 transition-colors group"
              >
                <span className="text-sm font-medium truncate">{entityType}</span>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 w-6 p-0 opacity-0 group-hover:opacity-100 transition-opacity"
                  onClick={() => handleRemoveEntityType(entityType)}
                >
                  <X className="w-3 h-3" />
                </Button>
              </div>
            ))}
          </div>

          {currentSchema.entityTypes.length === 0 && (
            <div className="text-center py-8 text-muted-foreground">
              {t('schema.current.noEntityTypes', 'No entity types configured')}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Server Sync Status & Apply */}
      {currentSchema.applyError && (
        <Alert variant="destructive">
          <AlertCircle className="w-4 h-4" />
          <AlertDescription>{currentSchema.applyError}</AlertDescription>
        </Alert>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <Upload className="w-5 h-5" />
            {t('schema.current.applyToServer', 'Apply to Server')}
          </CardTitle>
          <CardDescription>
            {t(
              'schema.current.applyToServerDescription',
              'Apply the current schema configuration to the server for document processing'
            )}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Sync Status */}
          <div className="flex items-center gap-2 text-sm">
            {currentSchema.isServerSynced ? (
              <>
                <CheckCircle className="w-4 h-4 text-green-500" />
                <span className="text-green-600">
                  {t('schema.current.serverSynced', 'Synced with server')}
                </span>
              </>
            ) : (
              <>
                <AlertCircle className="w-4 h-4 text-amber-500" />
                <span className="text-amber-600">
                  {t('schema.current.notSynced', 'Local changes not applied to server')}
                </span>
              </>
            )}
          </div>

          {/* Apply Button */}
          <Button
            onClick={handleApplyToServer}
            disabled={currentSchema.isApplying || currentSchema.entityTypes.length === 0}
            className="w-full"
          >
            {currentSchema.isApplying ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                {t('schema.current.applying', 'Applying...')}
              </>
            ) : (
              <>
                <Upload className="w-4 h-4 mr-2" />
                {t('schema.current.applySchema', 'Apply Schema to Server')}
              </>
            )}
          </Button>

          {/* Reload from Server */}
          <Button
            variant="outline"
            onClick={() => loadCurrentSchemaFromServer()}
            className="w-full"
          >
            <RefreshCw className="w-4 h-4 mr-2" />
            {t('schema.current.reloadFromServer', 'Reload from Server')}
          </Button>
        </CardContent>
      </Card>

      {/* Actions */}
      <Card>
        <CardContent className="pt-6">
          <div className="flex flex-wrap gap-4">
            {/* Reset to Default (Server) */}
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="outline" disabled={currentSchema.isApplying}>
                  <RotateCcw className="w-4 h-4 mr-2" />
                  {t('schema.current.resetToDefault', 'Reset to Default')}
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>
                    {t('schema.current.resetConfirmTitle', 'Reset Schema?')}
                  </AlertDialogTitle>
                  <AlertDialogDescription>
                    {t(
                      'schema.current.resetConfirmDescription',
                      'This will reset the entity types to the default configuration on the server. Any custom changes will be lost.'
                    )}
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>{t('common.cancel', 'Cancel')}</AlertDialogCancel>
                  <AlertDialogAction onClick={handleResetOnServer}>
                    {t('schema.current.reset', 'Reset')}
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>

            {/* Clear All (Local) */}
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="outline" className="text-destructive hover:text-destructive">
                  <Trash2 className="w-4 h-4 mr-2" />
                  {t('schema.current.clearAll', 'Clear All')}
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>
                    {t('schema.current.clearConfirmTitle', 'Clear All Entity Types?')}
                  </AlertDialogTitle>
                  <AlertDialogDescription>
                    {t(
                      'schema.current.clearConfirmDescription',
                      'This will remove all entity types locally. You will need to add new ones or reset to default.'
                    )}
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>{t('common.cancel', 'Cancel')}</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={() => setCurrentSchema([], 'custom')}
                    className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                  >
                    {t('schema.current.clear', 'Clear All')}
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        </CardContent>
      </Card>

      {/* Usage Info */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            {t('schema.current.howItWorks', 'How It Works')}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="space-y-2 text-sm text-muted-foreground">
            <li className="flex items-start gap-2">
              <span className="text-primary">1.</span>
              {t(
                'schema.current.step1',
                'Entity types define what kinds of concepts the system will extract from documents.'
              )}
            </li>
            <li className="flex items-start gap-2">
              <span className="text-primary">2.</span>
              {t(
                'schema.current.step2',
                'When inserting documents, the configured entity types guide the LLM extraction process.'
              )}
            </li>
            <li className="flex items-start gap-2">
              <span className="text-primary">3.</span>
              {t(
                'schema.current.step3',
                'Domain-specific types (e.g., "Customer", "Product") provide better extraction quality than generic types.'
              )}
            </li>
            <li className="flex items-start gap-2">
              <span className="text-primary">4.</span>
              {t(
                'schema.current.step4',
                'Use Discovery or Templates to quickly configure entity types for your domain.'
              )}
            </li>
          </ul>
        </CardContent>
      </Card>
    </div>
  )
}

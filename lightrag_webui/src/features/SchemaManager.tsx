import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import Badge from '@/components/ui/Badge'
import { cn } from '@/lib/utils'
import { useSchemaStore } from '@/stores/schema'
import { useWorkspaceStore } from '@/stores/workspace'
import { SchemaDiscovery } from '@/components/schema/SchemaDiscovery'
import { TemplateLibrary } from '@/components/schema/TemplateLibrary'
import { CurrentSchema } from '@/components/schema/CurrentSchema'
import { Sparkles, Library, Settings2, CheckCircle } from 'lucide-react'

type SchemaTab = 'discovery' | 'templates' | 'current'

export default function SchemaManager() {
  const { t } = useTranslation()
  const [activeTab, setActiveTab] = useState<SchemaTab>('discovery')
  const { currentSchema, loadTemplates, templates, clearDiscoveryResult, loadCurrentSchemaFromServer } = useSchemaStore()
  const currentWorkspaceId = useWorkspaceStore.use.currentWorkspaceId()

  // Load templates on mount and when workspace changes
  useEffect(() => {
    loadTemplates()
  }, [loadTemplates, currentWorkspaceId])

  // Load current schema and clear discovery result when workspace changes
  useEffect(() => {
    loadCurrentSchemaFromServer()
    clearDiscoveryResult()
  }, [currentWorkspaceId, loadCurrentSchemaFromServer, clearDiscoveryResult])

  const tabButtonClass = (isActive: boolean) =>
    cn(
      'inline-flex items-center justify-center gap-2 rounded-sm px-3 py-1.5 text-sm font-medium whitespace-nowrap transition-all',
      'ring-offset-background focus-visible:ring-ring focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none',
      'disabled:pointer-events-none disabled:opacity-50 cursor-pointer',
      isActive
        ? 'bg-background text-foreground shadow-sm'
        : 'text-muted-foreground hover:bg-background/50 hover:text-foreground'
    )

  return (
    <div className="container mx-auto p-4 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">{t('schema.title', 'Schema Manager')}</h1>
          <p className="text-muted-foreground">
            {t('schema.description', 'Manage domain-specific entity and relation types for knowledge graph')}
          </p>
        </div>
        {currentSchema.source && (
          <Badge variant="secondary" className="text-sm">
            <CheckCircle className="w-4 h-4 mr-1" />
            {currentSchema.source.startsWith('template:')
              ? currentSchema.source.replace('template:', '')
              : currentSchema.source}
          </Badge>
        )}
      </div>

      {/* Custom Tab Navigation */}
      <div className="bg-muted text-muted-foreground inline-flex h-10 items-center justify-center rounded-md p-1 w-full">
        <div className="grid w-full grid-cols-3 gap-1">
          <button
            type="button"
            onClick={() => setActiveTab('discovery')}
            className={tabButtonClass(activeTab === 'discovery')}
          >
            <Sparkles className="w-4 h-4" />
            {t('schema.tabs.discovery', 'Discovery')}
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('templates')}
            className={tabButtonClass(activeTab === 'templates')}
          >
            <Library className="w-4 h-4" />
            {t('schema.tabs.templates', 'Templates')}
            {templates.length > 0 && (
              <Badge variant="secondary" className="ml-1">{templates.length}</Badge>
            )}
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('current')}
            className={tabButtonClass(activeTab === 'current')}
          >
            <Settings2 className="w-4 h-4" />
            {t('schema.tabs.current', 'Current')}
          </button>
        </div>
      </div>

      {/* Tab Content - Keep all tabs mounted, use CSS to show/hide */}
      <div className="space-y-4">
        <div className={activeTab === 'discovery' ? '' : 'hidden'}>
          <SchemaDiscovery />
        </div>
        <div className={activeTab === 'templates' ? '' : 'hidden'}>
          <TemplateLibrary />
        </div>
        <div className={activeTab === 'current' ? '' : 'hidden'}>
          <CurrentSchema />
        </div>
      </div>
    </div>
  )
}

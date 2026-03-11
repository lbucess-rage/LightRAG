import { useEffect, useCallback, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'
import { useEntityManagementStore } from '@/stores/entityManagement'
import { useWorkspaceStore } from '@/stores/workspace'
import EntityExplorer from '@/components/entity-management/EntityExplorer'
import RelationExplorer from '@/components/entity-management/RelationExplorer'
import EntityGraphView from '@/components/entity-management/EntityGraphView'
import EntityDetailPanel from '@/components/entity-management/EntityDetailPanel'

export default function EntityManagement() {
  const { t } = useTranslation()
  const activeTab = useEntityManagementStore.use.activeTab()
  const setActiveTab = useEntityManagementStore.use.setActiveTab()
  const fetchEntities = useEntityManagementStore.use.fetchEntities()
  const fetchEntityTypes = useEntityManagementStore.use.fetchEntityTypes()
  const fetchRelations = useEntityManagementStore.use.fetchRelations()
  const selectedEntityId = useEntityManagementStore.use.selectedEntityId()
  const selectEntity = useEntityManagementStore.use.selectEntity()
  const setGraphSelectedNode = useEntityManagementStore.use.setGraphSelectedNode()
  const setGraphSelectedEdge = useEntityManagementStore.use.setGraphSelectedEdge()
  const currentWorkspaceId = useWorkspaceStore.use.currentWorkspaceId()
  const prevWorkspaceRef = useRef<string | null>(null)

  // Reset selection state when workspace changes
  useEffect(() => {
    if (prevWorkspaceRef.current !== null && prevWorkspaceRef.current !== currentWorkspaceId) {
      // Workspace changed - reset all selection states
      selectEntity(null)
      setGraphSelectedNode(null, null)
      setGraphSelectedEdge(null)
    }
    prevWorkspaceRef.current = currentWorkspaceId
  }, [currentWorkspaceId, selectEntity, setGraphSelectedNode, setGraphSelectedEdge])

  // Initial data load and refresh on workspace change
  useEffect(() => {
    fetchEntities()
    fetchEntityTypes()
  }, [fetchEntities, fetchEntityTypes, currentWorkspaceId])

  // Load relations when switching to relations tab or workspace changes
  useEffect(() => {
    if (activeTab === 'relations') {
      fetchRelations()
    }
  }, [activeTab, fetchRelations, currentWorkspaceId])

  const handleTabChange = useCallback((tab: 'entities' | 'relations') => {
    setActiveTab(tab)
  }, [setActiveTab])

  return (
    <div className="flex h-full flex-col">
      {/* Tab Navigation */}
      <div className="flex h-10 items-center gap-2 border-b border-border/40 px-4 bg-background/95">
        <button
          onClick={() => handleTabChange('entities')}
          className={cn(
            'px-4 py-2 text-sm font-medium transition-colors rounded-t-md',
            activeTab === 'entities'
              ? 'bg-primary text-primary-foreground'
              : 'hover:bg-muted text-muted-foreground'
          )}
        >
          {t('entityManagement.tabs.entities')}
        </button>
        <button
          onClick={() => handleTabChange('relations')}
          className={cn(
            'px-4 py-2 text-sm font-medium transition-colors rounded-t-md',
            activeTab === 'relations'
              ? 'bg-primary text-primary-foreground'
              : 'hover:bg-muted text-muted-foreground'
          )}
        >
          {t('entityManagement.tabs.relations')}
        </button>
      </div>

      {/* Main Content Area */}
      <div className="flex flex-1 overflow-hidden">
        {/* Left Panel - Explorer (40%) */}
        <div className="w-2/5 min-w-[300px] border-r border-border/40 flex flex-col overflow-hidden">
          {activeTab === 'entities' ? <EntityExplorer /> : <RelationExplorer />}
        </div>

        {/* Right Panel - Graph View (60%) */}
        <div className="flex-1 flex flex-col overflow-hidden">
          <EntityGraphView selectedEntityId={selectedEntityId} />
        </div>
      </div>

      {/* Bottom Panel - Detail Panel (Collapsible) */}
      <EntityDetailPanel />
    </div>
  )
}

import { create } from 'zustand'
import { createSelectors } from '@/lib/utils'
import {
  EntityResponse,
  RelationResponse,
  PaginationInfo,
  EntityTypeCount,
  getEntitiesPaginated,
  getEntityTypes,
  getRelationsPaginated,
  deleteEntity,
  deleteRelation,
} from '@/api/lightrag'

type ActiveTab = 'entities' | 'relations'

// Extended node data with full properties and neighbors
export interface GraphNodeData {
  id: string
  labels: string[]
  properties: Record<string, any>
  neighbors: { id: string; label: string }[]
  degree: number
}

// Extended edge data with full properties
export interface GraphEdgeData {
  id: string
  source: string
  target: string
  type?: string
  label?: string
  keywords?: string
  weight?: number
  description?: string
  source_id?: string
  properties: Record<string, any>
}

interface EntityManagementState {
  // Active tab
  activeTab: ActiveTab
  setActiveTab: (tab: ActiveTab) => void

  // Entity list state
  entities: EntityResponse[]
  entitiesPagination: PaginationInfo
  entityTypeCounts: EntityTypeCount[]
  totalEntities: number
  entitySearch: string
  selectedEntityType: string | null
  entitiesLoading: boolean
  entitiesSortField: string
  entitiesSortDirection: 'asc' | 'desc'

  // Relation list state
  relations: RelationResponse[]
  relationsPagination: PaginationInfo
  relationSearch: string
  relationsLoading: boolean
  relationsSortField: string
  relationsSortDirection: 'asc' | 'desc'

  // Selection state
  selectedEntityId: string | null

  // Graph selection state (within the graph view) - extended with full data
  graphSelectedNode: string | null
  graphSelectedNodeData: GraphNodeData | null
  graphSelectedEdge: GraphEdgeData | null

  // Actions
  setEntitySearch: (search: string) => void
  setSelectedEntityType: (type: string | null) => void
  setEntitiesSortField: (field: string) => void
  setEntitiesSortDirection: (direction: 'asc' | 'desc') => void

  setRelationSearch: (search: string) => void
  setRelationsSortField: (field: string) => void
  setRelationsSortDirection: (direction: 'asc' | 'desc') => void

  selectEntity: (entityId: string | null) => void
  setGraphSelectedNode: (nodeId: string | null, nodeData?: GraphNodeData | null) => void
  setGraphSelectedEdge: (edge: GraphEdgeData | null) => void

  fetchEntities: (page?: number) => Promise<void>
  fetchEntityTypes: () => Promise<void>
  fetchRelations: (page?: number) => Promise<void>

  removeEntity: (entityId: string) => Promise<void>
  removeRelation: (sourceId: string, targetId: string) => Promise<void>

  reset: () => void
}

const defaultPagination: PaginationInfo = {
  page: 1,
  page_size: 20,
  total_count: 0,
  total_pages: 0,
  has_next: false,
  has_prev: false,
}

const useEntityManagementStoreBase = create<EntityManagementState>()((set, get) => ({
  // Initial state
  activeTab: 'entities',

  entities: [],
  entitiesPagination: { ...defaultPagination },
  entityTypeCounts: [],
  totalEntities: 0,
  entitySearch: '',
  selectedEntityType: null,
  entitiesLoading: false,
  entitiesSortField: 'entity_id',
  entitiesSortDirection: 'asc',

  relations: [],
  relationsPagination: { ...defaultPagination },
  relationSearch: '',
  relationsLoading: false,
  relationsSortField: 'source_id',
  relationsSortDirection: 'asc',

  selectedEntityId: null,
  graphSelectedNode: null,
  graphSelectedNodeData: null,
  graphSelectedEdge: null,

  // Actions
  setActiveTab: (tab) => set({ activeTab: tab }),

  setEntitySearch: (search) => set({ entitySearch: search }),
  setSelectedEntityType: (type) => set({ selectedEntityType: type }),
  setEntitiesSortField: (field) => set({ entitiesSortField: field }),
  setEntitiesSortDirection: (direction) => set({ entitiesSortDirection: direction }),

  setRelationSearch: (search) => set({ relationSearch: search }),
  setRelationsSortField: (field) => set({ relationsSortField: field }),
  setRelationsSortDirection: (direction) => set({ relationsSortDirection: direction }),

  selectEntity: (entityId) => set({ selectedEntityId: entityId, graphSelectedNode: null, graphSelectedNodeData: null, graphSelectedEdge: null }),
  setGraphSelectedNode: (nodeId, nodeData = null) => set({ graphSelectedNode: nodeId, graphSelectedNodeData: nodeData, graphSelectedEdge: null }),
  setGraphSelectedEdge: (edge) => set({ graphSelectedEdge: edge, graphSelectedNode: null, graphSelectedNodeData: null }),

  fetchEntities: async (page = 1) => {
    const state = get()
    set({ entitiesLoading: true })

    try {
      const response = await getEntitiesPaginated({
        page,
        page_size: state.entitiesPagination.page_size,
        search: state.entitySearch || undefined,
        entity_type: state.selectedEntityType || undefined,
        sort_field: state.entitiesSortField,
        sort_direction: state.entitiesSortDirection,
      })

      set({
        entities: response.entities,
        entitiesPagination: response.pagination,
      })
    } catch (error) {
      console.error('Failed to fetch entities:', error)
      set({
        entities: [],
        entitiesPagination: { ...defaultPagination },
      })
    } finally {
      set({ entitiesLoading: false })
    }
  },

  fetchEntityTypes: async () => {
    try {
      const response = await getEntityTypes()
      set({
        entityTypeCounts: response.types,
        totalEntities: response.total_entities,
      })
    } catch (error) {
      console.error('Failed to fetch entity types:', error)
      set({
        entityTypeCounts: [],
        totalEntities: 0,
      })
    }
  },

  fetchRelations: async (page = 1) => {
    const state = get()
    set({ relationsLoading: true })

    try {
      const response = await getRelationsPaginated({
        page,
        page_size: state.relationsPagination.page_size,
        search: state.relationSearch || undefined,
        sort_field: state.relationsSortField,
        sort_direction: state.relationsSortDirection,
      })

      set({
        relations: response.relations,
        relationsPagination: response.pagination,
      })
    } catch (error) {
      console.error('Failed to fetch relations:', error)
      set({
        relations: [],
        relationsPagination: { ...defaultPagination },
      })
    } finally {
      set({ relationsLoading: false })
    }
  },

  removeEntity: async (entityId) => {
    try {
      await deleteEntity(entityId)
      // Refresh entities list
      await get().fetchEntities(get().entitiesPagination.page)
      await get().fetchEntityTypes()
      // Clear selection if deleted entity was selected
      if (get().selectedEntityId === entityId) {
        set({ selectedEntityId: null })
      }
    } catch (error) {
      console.error('Failed to delete entity:', error)
      throw error
    }
  },

  removeRelation: async (sourceId, targetId) => {
    try {
      await deleteRelation({ source_id: sourceId, target_id: targetId })
      // Refresh relations list
      await get().fetchRelations(get().relationsPagination.page)
    } catch (error) {
      console.error('Failed to delete relation:', error)
      throw error
    }
  },

  reset: () => {
    set({
      activeTab: 'entities',
      entities: [],
      entitiesPagination: { ...defaultPagination },
      entityTypeCounts: [],
      totalEntities: 0,
      entitySearch: '',
      selectedEntityType: null,
      entitiesLoading: false,
      entitiesSortField: 'entity_id',
      entitiesSortDirection: 'asc',
      relations: [],
      relationsPagination: { ...defaultPagination },
      relationSearch: '',
      relationsLoading: false,
      relationsSortField: 'source_id',
      relationsSortDirection: 'asc',
      selectedEntityId: null,
      graphSelectedNode: null,
      graphSelectedNodeData: null,
      graphSelectedEdge: null,
    })
  },
}))

const useEntityManagementStore = createSelectors(useEntityManagementStoreBase)

export { useEntityManagementStore }

import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import {
  DomainSchema,
  EntityType,
  RelationType,
  SchemaDiscoveryResult,
  TemplateSummary,
  MergePreviewResult,
  CreateTemplateInput,
  listTemplates,
  getTemplate,
  discoverFromDocument,
  discoverFromDomain,
  discoverFromFiles,
  getCurrentSchema,
  applySchema,
  resetSchema,
  mergePreview,
  mergeApply,
  SeedEntity,
  getSeedEntities,
  saveSeedEntities as apiSaveSeedEntities,
  clearSeedEntities as apiClearSeedEntities,
  createTemplate as apiCreateTemplate,
  updateTemplate as apiUpdateTemplate,
  deleteTemplate as apiDeleteTemplate,
} from '@/api/schema'

// =============================================================================
// Types
// =============================================================================

export interface CurrentSchemaInfo {
  entityTypes: string[]
  seedEntities: SeedEntity[]
  source: string | null // 'template:domain_name' or 'custom' or 'discovery'
  appliedAt: string | null
  isApplying: boolean
  applyError: string | null
  isServerSynced: boolean // 서버와 동기화 여부
  isSeedSaving: boolean
  seedSaveError: string | null
}

export interface MergeState {
  isPreviewLoading: boolean
  isMerging: boolean
  previewResult: MergePreviewResult | null
  mergeError: string | null
}

export interface SchemaState {
  // Templates
  templates: TemplateSummary[]
  templatesLoading: boolean
  templatesError: string | null
  selectedTemplate: DomainSchema | null
  selectedTemplateLoading: boolean

  // Discovery
  discoveryResult: SchemaDiscoveryResult | null
  isDiscovering: boolean
  discoveryError: string | null

  // Current Schema
  currentSchema: CurrentSchemaInfo

  // Merge
  merge: MergeState

  // Editor
  editorSchema: {
    domain: string
    display_name: string
    description: string
    entity_types: EntityType[]
    relation_types: RelationType[]
    tags: string[]
  } | null

  // Actions
  loadTemplates: (tags?: string[]) => Promise<void>
  loadTemplate: (domain: string) => Promise<void>
  clearSelectedTemplate: () => void

  discoverFromDocuments: (
    documents: { content: string; file_path?: string }[],
    options?: {
      max_entity_types?: number
      max_relation_types?: number
      language?: string
      domain_hints?: string
      include_common_types?: boolean
    }
  ) => Promise<void>
  discoverFromUploadedFiles: (
    files: File[],
    options?: {
      max_entity_types?: number
      max_relation_types?: number
      language?: string
      domain_hints?: string
      include_common_types?: boolean
    }
  ) => Promise<void>
  discoverFromDomains: (
    domains: string[],
    options?: {
      max_entity_types?: number
      max_relation_types?: number
      language?: string
      include_common_types?: boolean
    }
  ) => Promise<void>
  clearDiscoveryResult: () => void

  // Server sync actions
  loadCurrentSchemaFromServer: () => Promise<void>
  applySchemaToServer: (entityTypes: string[], source: string) => Promise<void>
  resetSchemaOnServer: () => Promise<void>

  // Merge actions
  previewMerge: (newEntityTypes: string[], source: string) => Promise<void>
  applyMerge: (newEntityTypes: string[], source: string, excludeDuplicates?: boolean) => Promise<void>
  clearMergePreview: () => void

  // Seed entity actions
  loadSeedEntities: () => Promise<void>
  saveSeedEntities: (seeds: SeedEntity[]) => Promise<void>
  clearSeedEntities: () => Promise<void>
  addSeedEntity: (seed: SeedEntity) => void
  removeSeedEntity: (keyword: string) => void
  updateSeedEntity: (keyword: string, updated: SeedEntity) => void

  // Local state actions (for optimistic updates)
  setCurrentSchema: (entityTypes: string[], source: string) => void
  resetCurrentSchema: () => void

  setEditorSchema: (schema: SchemaState['editorSchema']) => void
  updateEditorEntityType: (index: number, entityType: EntityType) => void
  addEditorEntityType: (entityType: EntityType) => void
  removeEditorEntityType: (index: number) => void
  updateEditorRelationType: (index: number, relationType: RelationType) => void
  addEditorRelationType: (relationType: RelationType) => void
  removeEditorRelationType: (index: number) => void
  clearEditorSchema: () => void

  // Template CRUD actions
  isTemplateSaving: boolean
  templateSaveError: string | null
  createTemplate: (input: CreateTemplateInput) => Promise<DomainSchema>
  updateTemplate: (domain: string, input: CreateTemplateInput) => Promise<DomainSchema>
  deleteTemplate: (domain: string) => Promise<void>
  duplicateTemplate: (sourceDomain: string, newDomain: string, newDisplayName: string) => Promise<DomainSchema>
}

// =============================================================================
// Default Values
// =============================================================================

const defaultEntityTypes = [
  'Person',
  'Creature',
  'Organization',
  'Location',
  'Event',
  'Concept',
  'Method',
  'Content',
  'Data',
  'Artifact',
  'NaturalObject',
]

const defaultCurrentSchema: CurrentSchemaInfo = {
  entityTypes: defaultEntityTypes,
  seedEntities: [],
  source: null,
  appliedAt: null,
  isApplying: false,
  applyError: null,
  isServerSynced: false,
  isSeedSaving: false,
  seedSaveError: null,
}

const defaultMergeState: MergeState = {
  isPreviewLoading: false,
  isMerging: false,
  previewResult: null,
  mergeError: null,
}

// =============================================================================
// Store
// =============================================================================

export const useSchemaStore = create<SchemaState>()(
  persist(
    (set, get) => ({
      // Initial State
      templates: [],
      templatesLoading: false,
      templatesError: null,
      selectedTemplate: null,
      selectedTemplateLoading: false,

      discoveryResult: null,
      isDiscovering: false,
      discoveryError: null,

      currentSchema: defaultCurrentSchema,

      merge: defaultMergeState,

      editorSchema: null,

      // Template CRUD state
      isTemplateSaving: false,
      templateSaveError: null,

      // Template Actions
      loadTemplates: async (tags?: string[]) => {
        set({ templatesLoading: true, templatesError: null })
        try {
          const result = await listTemplates(tags)
          set({ templates: result.templates, templatesLoading: false })
        } catch (error) {
          set({
            templatesError: error instanceof Error ? error.message : 'Failed to load templates',
            templatesLoading: false,
          })
        }
      },

      loadTemplate: async (domain: string) => {
        set({ selectedTemplateLoading: true })
        try {
          const template = await getTemplate(domain)
          set({ selectedTemplate: template, selectedTemplateLoading: false })
        } catch (error) {
          set({ selectedTemplateLoading: false })
          throw error
        }
      },

      clearSelectedTemplate: () => {
        set({ selectedTemplate: null })
      },

      // Discovery Actions
      discoverFromDocuments: async (documents, options) => {
        set({ isDiscovering: true, discoveryError: null })
        try {
          const result = await discoverFromDocument(documents, options)
          set({ discoveryResult: result, isDiscovering: false })
        } catch (error) {
          set({
            discoveryError: error instanceof Error ? error.message : 'Discovery failed',
            isDiscovering: false,
          })
        }
      },

      discoverFromUploadedFiles: async (files, options) => {
        set({ isDiscovering: true, discoveryError: null })
        try {
          const result = await discoverFromFiles(files, options)
          set({ discoveryResult: result, isDiscovering: false })
        } catch (error) {
          set({
            discoveryError: error instanceof Error ? error.message : 'Discovery failed',
            isDiscovering: false,
          })
        }
      },

      discoverFromDomains: async (domains: string[], options?: {
        max_entity_types?: number
        max_relation_types?: number
        language?: string
      }) => {
        set({ isDiscovering: true, discoveryError: null })
        try {
          const result = await discoverFromDomain(domains, options)
          set({ discoveryResult: result, isDiscovering: false })
        } catch (error) {
          set({
            discoveryError: error instanceof Error ? error.message : 'Discovery failed',
            isDiscovering: false,
          })
        }
      },

      clearDiscoveryResult: () => {
        set({ discoveryResult: null, discoveryError: null })
      },

      // Server Sync Actions
      loadCurrentSchemaFromServer: async () => {
        try {
          const result = await getCurrentSchema()
          set({
            currentSchema: {
              ...get().currentSchema,
              entityTypes: result.entity_types,
              seedEntities: result.seed_entities ?? [],
              source: result.source,
              appliedAt: result.applied_at,
              isApplying: false,
              applyError: null,
              isServerSynced: true,
            },
          })
        } catch (error) {
          console.error('Failed to load schema from server:', error)
          // 서버에서 로드 실패 시 로컬 상태 유지
        }
      },

      applySchemaToServer: async (entityTypes: string[], source: string) => {
        const { currentSchema } = get()
        set({
          currentSchema: {
            ...currentSchema,
            isApplying: true,
            applyError: null,
          },
        })

        try {
          const result = await applySchema(entityTypes, source)
          set({
            currentSchema: {
              ...get().currentSchema,
              entityTypes: result.entity_types,
              source: result.source,
              appliedAt: result.applied_at,
              isApplying: false,
              applyError: null,
              isServerSynced: true,
            },
          })
        } catch (error) {
          set({
            currentSchema: {
              ...get().currentSchema,
              isApplying: false,
              applyError: error instanceof Error ? error.message : 'Failed to apply schema',
            },
          })
          throw error
        }
      },

      resetSchemaOnServer: async () => {
        const { currentSchema } = get()
        set({
          currentSchema: {
            ...currentSchema,
            isApplying: true,
            applyError: null,
          },
        })

        try {
          const result = await resetSchema()
          set({
            currentSchema: {
              ...get().currentSchema,
              entityTypes: result.entity_types,
              source: result.source,
              appliedAt: result.applied_at,
              isApplying: false,
              applyError: null,
              isServerSynced: true,
            },
          })
        } catch (error) {
          set({
            currentSchema: {
              ...get().currentSchema,
              isApplying: false,
              applyError: error instanceof Error ? error.message : 'Failed to reset schema',
            },
          })
          throw error
        }
      },

      // Seed Entity Actions
      loadSeedEntities: async () => {
        try {
          const result = await getSeedEntities()
          set({
            currentSchema: {
              ...get().currentSchema,
              seedEntities: result.seed_entities,
            },
          })
        } catch (error) {
          console.error('Failed to load seed entities:', error)
        }
      },

      saveSeedEntities: async (seeds: SeedEntity[]) => {
        set({
          currentSchema: {
            ...get().currentSchema,
            isSeedSaving: true,
            seedSaveError: null,
          },
        })
        try {
          const result = await apiSaveSeedEntities(seeds)
          set({
            currentSchema: {
              ...get().currentSchema,
              seedEntities: result.seed_entities,
              isSeedSaving: false,
              seedSaveError: null,
            },
          })
        } catch (error) {
          set({
            currentSchema: {
              ...get().currentSchema,
              isSeedSaving: false,
              seedSaveError: error instanceof Error ? error.message : 'Failed to save seed entities',
            },
          })
          throw error
        }
      },

      clearSeedEntities: async () => {
        set({
          currentSchema: {
            ...get().currentSchema,
            isSeedSaving: true,
            seedSaveError: null,
          },
        })
        try {
          await apiClearSeedEntities()
          set({
            currentSchema: {
              ...get().currentSchema,
              seedEntities: [],
              isSeedSaving: false,
              seedSaveError: null,
            },
          })
        } catch (error) {
          set({
            currentSchema: {
              ...get().currentSchema,
              isSeedSaving: false,
              seedSaveError: error instanceof Error ? error.message : 'Failed to clear seed entities',
            },
          })
          throw error
        }
      },

      addSeedEntity: (seed: SeedEntity) => {
        const { currentSchema } = get()
        if (currentSchema.seedEntities.some((s) => s.keyword === seed.keyword)) return
        set({
          currentSchema: {
            ...currentSchema,
            seedEntities: [...currentSchema.seedEntities, seed],
          },
        })
      },

      removeSeedEntity: (keyword: string) => {
        const { currentSchema } = get()
        set({
          currentSchema: {
            ...currentSchema,
            seedEntities: currentSchema.seedEntities.filter((s) => s.keyword !== keyword),
          },
        })
      },

      updateSeedEntity: (keyword: string, updated: SeedEntity) => {
        const { currentSchema } = get()
        set({
          currentSchema: {
            ...currentSchema,
            seedEntities: currentSchema.seedEntities.map((s) =>
              s.keyword === keyword ? updated : s
            ),
          },
        })
      },

      // Merge Actions
      previewMerge: async (newEntityTypes: string[], source: string) => {
        set({
          merge: {
            ...get().merge,
            isPreviewLoading: true,
            mergeError: null,
          },
        })

        try {
          const result = await mergePreview(newEntityTypes, source)
          set({
            merge: {
              ...get().merge,
              isPreviewLoading: false,
              previewResult: result,
              mergeError: null,
            },
          })
        } catch (error) {
          set({
            merge: {
              ...get().merge,
              isPreviewLoading: false,
              mergeError: error instanceof Error ? error.message : 'Failed to preview merge',
            },
          })
          throw error
        }
      },

      applyMerge: async (newEntityTypes: string[], source: string, excludeDuplicates = true) => {
        set({
          merge: {
            ...get().merge,
            isMerging: true,
            mergeError: null,
          },
        })

        try {
          const result = await mergeApply(newEntityTypes, source, excludeDuplicates)
          set({
            currentSchema: {
              ...get().currentSchema,
              entityTypes: result.entity_types,
              source: result.source,
              appliedAt: result.applied_at,
              isApplying: false,
              applyError: null,
              isServerSynced: true,
            },
            merge: {
              ...defaultMergeState,
            },
          })
        } catch (error) {
          set({
            merge: {
              ...get().merge,
              isMerging: false,
              mergeError: error instanceof Error ? error.message : 'Failed to apply merge',
            },
          })
          throw error
        }
      },

      clearMergePreview: () => {
        set({ merge: defaultMergeState })
      },

      // Local State Actions (for optimistic updates)
      setCurrentSchema: (entityTypes: string[], source: string) => {
        set({
          currentSchema: {
            ...get().currentSchema,
            entityTypes,
            source,
            appliedAt: new Date().toISOString(),
            isApplying: false,
            applyError: null,
            isServerSynced: false, // 로컬만 변경됨
          },
        })
      },

      resetCurrentSchema: () => {
        set({ currentSchema: defaultCurrentSchema })
      },

      // Editor Actions
      setEditorSchema: (schema) => {
        set({ editorSchema: schema })
      },

      updateEditorEntityType: (index, entityType) => {
        const { editorSchema } = get()
        if (!editorSchema) return
        const newEntityTypes = [...editorSchema.entity_types]
        newEntityTypes[index] = entityType
        set({ editorSchema: { ...editorSchema, entity_types: newEntityTypes } })
      },

      addEditorEntityType: (entityType) => {
        const { editorSchema } = get()
        if (!editorSchema) return
        set({
          editorSchema: {
            ...editorSchema,
            entity_types: [...editorSchema.entity_types, entityType],
          },
        })
      },

      removeEditorEntityType: (index) => {
        const { editorSchema } = get()
        if (!editorSchema) return
        const newEntityTypes = editorSchema.entity_types.filter((_, i) => i !== index)
        set({ editorSchema: { ...editorSchema, entity_types: newEntityTypes } })
      },

      updateEditorRelationType: (index, relationType) => {
        const { editorSchema } = get()
        if (!editorSchema) return
        const newRelationTypes = [...editorSchema.relation_types]
        newRelationTypes[index] = relationType
        set({ editorSchema: { ...editorSchema, relation_types: newRelationTypes } })
      },

      addEditorRelationType: (relationType) => {
        const { editorSchema } = get()
        if (!editorSchema) return
        set({
          editorSchema: {
            ...editorSchema,
            relation_types: [...editorSchema.relation_types, relationType],
          },
        })
      },

      removeEditorRelationType: (index) => {
        const { editorSchema } = get()
        if (!editorSchema) return
        const newRelationTypes = editorSchema.relation_types.filter((_, i) => i !== index)
        set({ editorSchema: { ...editorSchema, relation_types: newRelationTypes } })
      },

      clearEditorSchema: () => {
        set({ editorSchema: null })
      },

      // Template CRUD Actions
      createTemplate: async (input: CreateTemplateInput) => {
        set({ isTemplateSaving: true, templateSaveError: null })
        try {
          const result = await apiCreateTemplate(input)
          // Reload templates list
          await get().loadTemplates()
          set({ isTemplateSaving: false })
          return result
        } catch (error) {
          const errorMsg = error instanceof Error ? error.message : 'Failed to create template'
          set({ isTemplateSaving: false, templateSaveError: errorMsg })
          throw error
        }
      },

      updateTemplate: async (domain: string, input: CreateTemplateInput) => {
        set({ isTemplateSaving: true, templateSaveError: null })
        try {
          const result = await apiUpdateTemplate(domain, input)
          // Reload templates list
          await get().loadTemplates()
          set({ isTemplateSaving: false, selectedTemplate: result })
          return result
        } catch (error) {
          const errorMsg = error instanceof Error ? error.message : 'Failed to update template'
          set({ isTemplateSaving: false, templateSaveError: errorMsg })
          throw error
        }
      },

      deleteTemplate: async (domain: string) => {
        set({ isTemplateSaving: true, templateSaveError: null })
        try {
          await apiDeleteTemplate(domain)
          // Reload templates list
          await get().loadTemplates()
          set({ isTemplateSaving: false, selectedTemplate: null })
        } catch (error) {
          const errorMsg = error instanceof Error ? error.message : 'Failed to delete template'
          set({ isTemplateSaving: false, templateSaveError: errorMsg })
          throw error
        }
      },

      duplicateTemplate: async (sourceDomain: string, newDomain: string, newDisplayName: string) => {
        set({ isTemplateSaving: true, templateSaveError: null })
        try {
          // Load source template
          const source = await getTemplate(sourceDomain)
          // Create new template with copied data
          const input: CreateTemplateInput = {
            domain: newDomain,
            display_name: newDisplayName,
            description: source.description,
            entity_types: source.entity_types.map((e) => ({
              name: e.name,
              display_name: e.display_name,
              description: e.description,
              examples: e.examples,
              color: e.color,
              icon: e.icon,
            })),
            relation_types: source.relation_types.map((r) => ({
              name: r.name,
              display_name: r.display_name,
              description: r.description,
              source_types: r.source_types,
              target_types: r.target_types,
              is_directional: r.is_directional,
              cardinality: r.cardinality,
            })),
            tags: source.tags,
          }
          const result = await apiCreateTemplate(input)
          await get().loadTemplates()
          set({ isTemplateSaving: false })
          return result
        } catch (error) {
          const errorMsg = error instanceof Error ? error.message : 'Failed to duplicate template'
          set({ isTemplateSaving: false, templateSaveError: errorMsg })
          throw error
        }
      },
    }),
    {
      name: 'lightrag-schema-store',
      version: 1,
      partialize: (state) => ({
        currentSchema: state.currentSchema,
      }),
      merge: (persistedState: any, currentState: any) => {
        // Deep merge currentSchema with defaults for missing fields
        const persisted = (persistedState as any) || {}
        return {
          ...currentState,
          ...persisted,
          currentSchema: {
            ...currentState.currentSchema,
            ...(persisted.currentSchema || {}),
            // Ensure new fields always have defaults
            seedEntities: persisted.currentSchema?.seedEntities ?? [],
            isSeedSaving: false,
            seedSaveError: null,
          },
        }
      },
      migrate: (persistedState: any, version: number) => {
        return persistedState
      },
    }
  )
)

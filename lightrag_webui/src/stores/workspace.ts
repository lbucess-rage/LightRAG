import { create } from 'zustand'
import { createSelectors } from '@/lib/utils'
import {
  WorkspaceInfo,
  getWorkspaces,
  getWorkspace,
  createWorkspace,
  updateWorkspace,
  deleteWorkspace,
  setDefaultWorkspace,
  getWorkspaceStats,
  syncWorkspaceStats,
  copyWorkspaceSettings,
  copyWorkspaceData,
  moveWorkspaceData,
  WorkspaceCreateRequest,
  WorkspaceUpdateRequest,
  CopySettingsRequest,
  CopyDataRequest,
} from '@/api/lightrag'

interface WorkspaceState {
  // Current workspace
  currentWorkspaceId: string
  currentWorkspace: WorkspaceInfo | null

  // Workspace list
  workspaces: WorkspaceInfo[]
  totalWorkspaces: number
  isLoading: boolean
  error: string | null

  // Dialog states
  isCreateDialogOpen: boolean
  isEditDialogOpen: boolean
  isCopyDialogOpen: boolean
  isDeleteDialogOpen: boolean
  selectedWorkspace: WorkspaceInfo | null

  // Actions
  setCurrentWorkspaceId: (workspaceId: string) => void
  fetchWorkspaces: (force?: boolean) => Promise<void>
  fetchCurrentWorkspace: () => Promise<void>
  createNewWorkspace: (request: WorkspaceCreateRequest) => Promise<WorkspaceInfo>
  updateExistingWorkspace: (workspaceId: string, request: WorkspaceUpdateRequest) => Promise<WorkspaceInfo>
  deleteExistingWorkspace: (workspaceId: string, deleteData?: boolean) => Promise<void>
  setAsDefaultWorkspace: (workspaceId: string) => Promise<void>
  refreshWorkspaceStats: (workspaceId: string) => Promise<void>
  copySettings: (sourceId: string, request: CopySettingsRequest) => Promise<string[]>
  copyData: (sourceId: string, request: CopyDataRequest) => Promise<string[]>
  moveData: (sourceId: string, request: CopyDataRequest) => Promise<{ moved: string[]; deleted: string[] }>

  // Dialog actions
  openCreateDialog: () => void
  closeCreateDialog: () => void
  openEditDialog: (workspace: WorkspaceInfo) => void
  closeEditDialog: () => void
  openCopyDialog: (workspace: WorkspaceInfo) => void
  closeCopyDialog: () => void
  openDeleteDialog: (workspace: WorkspaceInfo) => void
  closeDeleteDialog: () => void

  // Error handling
  clearError: () => void
}

const WORKSPACE_FETCH_DEDUPE_MS = 1500
let workspaceFetchInFlight: Promise<void> | null = null
let lastWorkspaceFetchAt = 0

if (typeof window !== 'undefined') {
  localStorage.removeItem('lightrag-workspace-storage')
}

const useWorkspaceStoreBase = create<WorkspaceState>()(
  (set, get) => ({
    // Initial state
    currentWorkspaceId: '',
    currentWorkspace: null,
    workspaces: [],
    totalWorkspaces: 0,
    isLoading: false,
    error: null,

    // Dialog states
    isCreateDialogOpen: false,
    isEditDialogOpen: false,
    isCopyDialogOpen: false,
    isDeleteDialogOpen: false,
    selectedWorkspace: null,

    // Actions
    setCurrentWorkspaceId: (workspaceId: string) => {
      const currentWorkspace = get().workspaces.find(ws => ws.workspace_id === workspaceId) || null
      set({ currentWorkspaceId: workspaceId, currentWorkspace })
      // Fetch workspace details after setting
      get().fetchCurrentWorkspace()
    },

    fetchWorkspaces: async (force = false) => {
      if (workspaceFetchInFlight) {
        return workspaceFetchInFlight
      }

      const now = Date.now()
      if (!force && now - lastWorkspaceFetchAt < WORKSPACE_FETCH_DEDUPE_MS) {
        return
      }

      workspaceFetchInFlight = (async () => {
        set({ isLoading: true, error: null })
        try {
          const response = await getWorkspaces(1, 100, force)
          lastWorkspaceFetchAt = Date.now()
          const requestedWorkspaceId = get().currentWorkspaceId
          let currentWorkspace = requestedWorkspaceId
            ? response.workspaces.find(ws => ws.workspace_id === requestedWorkspaceId)
            : null
          let currentWorkspaceId = requestedWorkspaceId

          if (!currentWorkspace && response.workspaces.length > 0) {
            currentWorkspace = response.workspaces.find(ws => ws.is_default) || response.workspaces[0]
            currentWorkspaceId = currentWorkspace.workspace_id
          }

          set({
            currentWorkspaceId,
            workspaces: response.workspaces,
            currentWorkspace: currentWorkspace || get().currentWorkspace,
            totalWorkspaces: response.total,
            isLoading: false,
          })
        } catch (error: any) {
          set({
            error: error.message || 'Failed to fetch workspaces',
            isLoading: false,
          })
        } finally {
          workspaceFetchInFlight = null
        }
      })()

      return workspaceFetchInFlight
    },

    fetchCurrentWorkspace: async () => {
      const { currentWorkspaceId } = get()
      if (!currentWorkspaceId) return

      try {
        const workspace = await getWorkspace(currentWorkspaceId)
        set({ currentWorkspace: workspace })
      } catch {
        // If workspace not found, try to get default
        try {
          const workspaces = await getWorkspaces(1, 100)
          const defaultWs = workspaces.workspaces.find(ws => ws.is_default)
          if (defaultWs) {
            set({
              currentWorkspaceId: defaultWs.workspace_id,
              currentWorkspace: defaultWs,
            })
          }
        } catch {
          set({ error: 'Failed to fetch workspace' })
        }
      }
    },

    createNewWorkspace: async (request: WorkspaceCreateRequest) => {
      set({ isLoading: true, error: null })
      try {
        const workspace = await createWorkspace(request)
        // Refresh workspace list
        await get().fetchWorkspaces(true)
        set({ isLoading: false })
        return workspace
      } catch (error: any) {
        set({
          error: error.response?.data?.detail || error.message || 'Failed to create workspace',
          isLoading: false,
        })
        throw error
      }
    },

    updateExistingWorkspace: async (workspaceId: string, request: WorkspaceUpdateRequest) => {
      set({ isLoading: true, error: null })
      try {
        const workspace = await updateWorkspace(workspaceId, request)
        // Refresh workspace list
        await get().fetchWorkspaces(true)
        // Update current workspace if it's the one being edited
        if (get().currentWorkspaceId === workspaceId) {
          set({ currentWorkspace: workspace })
        }
        set({ isLoading: false })
        return workspace
      } catch (error: any) {
        set({
          error: error.response?.data?.detail || error.message || 'Failed to update workspace',
          isLoading: false,
        })
        throw error
      }
    },

    deleteExistingWorkspace: async (workspaceId: string, deleteData: boolean = true) => {
      set({ isLoading: true, error: null })
      try {
        await deleteWorkspace(workspaceId, deleteData)
        // If deleted workspace was current, switch to default
        if (get().currentWorkspaceId === workspaceId) {
          const workspaces = await getWorkspaces(1, 100, true)
          const defaultWs = workspaces.workspaces.find(ws => ws.is_default)
          if (defaultWs) {
            set({
              currentWorkspaceId: defaultWs.workspace_id,
              currentWorkspace: defaultWs,
            })
          }
        }
        // Refresh workspace list
        await get().fetchWorkspaces(true)
        set({ isLoading: false })
      } catch (error: any) {
        set({
          error: error.response?.data?.detail || error.message || 'Failed to delete workspace',
          isLoading: false,
        })
        throw error
      }
    },

    setAsDefaultWorkspace: async (workspaceId: string) => {
      set({ isLoading: true, error: null })
      try {
        await setDefaultWorkspace(workspaceId)
        // Refresh workspace list
        await get().fetchWorkspaces(true)
        set({ isLoading: false })
      } catch (error: any) {
        set({
          error: error.response?.data?.detail || error.message || 'Failed to set default workspace',
          isLoading: false,
        })
        throw error
      }
    },

    refreshWorkspaceStats: async (workspaceId: string) => {
      try {
        await syncWorkspaceStats(workspaceId)
        // Refresh the workspace data
        const stats = await getWorkspaceStats(workspaceId)
        // Update in workspaces list
        set(state => ({
          workspaces: state.workspaces.map(ws =>
            ws.workspace_id === workspaceId
              ? {
                ...ws,
                document_count: stats.document_count,
                entity_count: stats.entity_count,
                relation_count: stats.relation_count,
                is_busy: stats.is_busy,
              }
              : ws
          ),
        }))
        // Update current workspace if needed
        if (get().currentWorkspaceId === workspaceId && get().currentWorkspace) {
          set(state => ({
            currentWorkspace: state.currentWorkspace
              ? {
                ...state.currentWorkspace,
                document_count: stats.document_count,
                entity_count: stats.entity_count,
                relation_count: stats.relation_count,
                is_busy: stats.is_busy,
              }
              : null,
          }))
        }
      } catch (error: any) {
        set({ error: error.message || 'Failed to refresh stats' })
      }
    },

    copySettings: async (sourceId: string, request: CopySettingsRequest) => {
      set({ isLoading: true, error: null })
      try {
        const result = await copyWorkspaceSettings(sourceId, request)
        set({ isLoading: false })
        return result.copied_items
      } catch (error: any) {
        set({
          error: error.response?.data?.detail || error.message || 'Failed to copy settings',
          isLoading: false,
        })
        throw error
      }
    },

    copyData: async (sourceId: string, request: CopyDataRequest) => {
      set({ isLoading: true, error: null })
      try {
        const result = await copyWorkspaceData(sourceId, request)
        // Refresh target workspace stats
        await get().refreshWorkspaceStats(request.target_workspace_id)
        set({ isLoading: false })
        return result.copied_tables
      } catch (error: any) {
        set({
          error: error.response?.data?.detail || error.message || 'Failed to copy data',
          isLoading: false,
        })
        throw error
      }
    },

    moveData: async (sourceId: string, request: CopyDataRequest) => {
      set({ isLoading: true, error: null })
      try {
        const result = await moveWorkspaceData(sourceId, request)
        // Refresh both workspaces stats
        await get().refreshWorkspaceStats(sourceId)
        await get().refreshWorkspaceStats(request.target_workspace_id)
        // Refresh workspace list
        await get().fetchWorkspaces(true)
        set({ isLoading: false })
        return { moved: result.moved_tables, deleted: result.deleted_from_source }
      } catch (error: any) {
        set({
          error: error.response?.data?.detail || error.message || 'Failed to move data',
          isLoading: false,
        })
        throw error
      }
    },

    // Dialog actions
    openCreateDialog: () => set({ isCreateDialogOpen: true }),
    closeCreateDialog: () => set({ isCreateDialogOpen: false }),

    openEditDialog: (workspace: WorkspaceInfo) =>
      set({ isEditDialogOpen: true, selectedWorkspace: workspace }),
    closeEditDialog: () => set({ isEditDialogOpen: false, selectedWorkspace: null }),

    openCopyDialog: (workspace: WorkspaceInfo) =>
      set({ isCopyDialogOpen: true, selectedWorkspace: workspace }),
    closeCopyDialog: () => set({ isCopyDialogOpen: false, selectedWorkspace: null }),

    openDeleteDialog: (workspace: WorkspaceInfo) =>
      set({ isDeleteDialogOpen: true, selectedWorkspace: workspace }),
    closeDeleteDialog: () => set({ isDeleteDialogOpen: false, selectedWorkspace: null }),

    // Error handling
    clearError: () => set({ error: null }),
  })
)

export const useWorkspaceStore = createSelectors(useWorkspaceStoreBase)

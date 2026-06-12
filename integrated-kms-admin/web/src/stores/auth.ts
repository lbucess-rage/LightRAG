import { create } from 'zustand'
import { login, me } from '@/api/client'
import { useWorkspaceScopeStore } from '@/stores/workspaceScope'

type User = {
  user_id: string
  role: string
  display_name?: string
  tenant_id?: string
  tenant_name?: string
  kms_workspace?: string
  faq_workspace?: string
}

type AuthState = {
  user: User | null
  loading: boolean
  login: (userId: string, password: string) => Promise<void>
  load: () => Promise<void>
  logout: () => void
}

function syncWorkspaceScope(user: User) {
  useWorkspaceScopeStore.getState().setWorkspaceScope({
    kmsWorkspace: user.kms_workspace,
    faqWorkspace: user.faq_workspace
  })
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  loading: false,
  login: async (userId, password) => {
    try {
      set({ loading: true })
      const result = await login(userId, password)
      syncWorkspaceScope(result.user)
      set({ user: result.user, loading: false })
    } catch (error) {
      set({ loading: false })
      throw error
    }
  },
  load: async () => {
    const token = sessionStorage.getItem('KMS_ADMIN_TOKEN')
    if (!token) return
    try {
      set({ loading: true })
      const user = await me()
      syncWorkspaceScope(user)
      set({ user, loading: false })
    } catch {
      sessionStorage.removeItem('KMS_ADMIN_TOKEN')
      useWorkspaceScopeStore.getState().resetWorkspaceScope()
      set({ user: null, loading: false })
    }
  },
  logout: () => {
    sessionStorage.removeItem('KMS_ADMIN_TOKEN')
    useWorkspaceScopeStore.getState().resetWorkspaceScope()
    set({ user: null })
  }
}))

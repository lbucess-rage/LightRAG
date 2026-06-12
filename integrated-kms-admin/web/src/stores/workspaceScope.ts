import { create } from 'zustand'
import { normalizeFaqWorkspace, normalizeKmsWorkspace } from '@/config'

const storageKey = 'KMS_ADMIN_WORKSPACE_SCOPE'

type StoredWorkspaceScope = {
  kmsWorkspace?: string
  faqWorkspace?: string
}

type WorkspaceScopeState = {
  kmsWorkspace: string
  faqWorkspace: string
  setKmsWorkspace: (workspace: string) => void
  setFaqWorkspace: (workspace: string) => void
  setWorkspaceScope: (scope: StoredWorkspaceScope) => void
  resetWorkspaceScope: () => void
}

function readStoredScope(): StoredWorkspaceScope {
  if (typeof window === 'undefined') return {}
  try {
    const raw = window.localStorage.getItem(storageKey)
    if (!raw) return {}
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object') return {}
    return {
      kmsWorkspace: typeof parsed.kmsWorkspace === 'string' ? parsed.kmsWorkspace : '',
      faqWorkspace: typeof parsed.faqWorkspace === 'string' ? parsed.faqWorkspace : ''
    }
  } catch {
    return {}
  }
}

function writeStoredScope(scope: StoredWorkspaceScope) {
  if (typeof window === 'undefined') return
  window.localStorage.setItem(storageKey, JSON.stringify(scope))
}

function clearStoredScope() {
  if (typeof window === 'undefined') return
  window.localStorage.removeItem(storageKey)
}

const initialScope = readStoredScope()

export const useWorkspaceScopeStore = create<WorkspaceScopeState>((set, get) => ({
  kmsWorkspace: normalizeKmsWorkspace(initialScope.kmsWorkspace),
  faqWorkspace: normalizeFaqWorkspace(initialScope.faqWorkspace),
  setKmsWorkspace: (kmsWorkspace) => {
    const normalized = normalizeKmsWorkspace(kmsWorkspace)
    const next = { kmsWorkspace: normalized, faqWorkspace: get().faqWorkspace }
    writeStoredScope(next)
    set({ kmsWorkspace: normalized })
  },
  setFaqWorkspace: (faqWorkspace) => {
    const normalized = normalizeFaqWorkspace(faqWorkspace)
    const next = { kmsWorkspace: get().kmsWorkspace, faqWorkspace: normalized }
    writeStoredScope(next)
    set({ faqWorkspace: normalized })
  },
  setWorkspaceScope: (scope) => {
    const next = {
      kmsWorkspace: normalizeKmsWorkspace(scope.kmsWorkspace ?? get().kmsWorkspace),
      faqWorkspace: normalizeFaqWorkspace(scope.faqWorkspace ?? get().faqWorkspace)
    }
    writeStoredScope(next)
    set(next)
  },
  resetWorkspaceScope: () => {
    clearStoredScope()
    set({
      kmsWorkspace: normalizeKmsWorkspace(null),
      faqWorkspace: normalizeFaqWorkspace(null)
    })
  }
}))

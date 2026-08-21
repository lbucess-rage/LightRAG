import { create } from 'zustand'
import { normalizeFaqWorkspace, normalizeKmsWorkspace } from '@/config'

const storageKey = 'KMS_ADMIN_WORKSPACE_SCOPE'

type StoredWorkspaceScope = {
  tenantId?: string
  tenantName?: string
  kmsWorkspace?: string
  faqWorkspace?: string
}

type WorkspaceScopeState = {
  tenantId: string
  tenantName: string
  kmsWorkspace: string
  faqWorkspace: string
  setTenantScope: (scope: StoredWorkspaceScope) => void
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
      tenantId: typeof parsed.tenantId === 'string' ? parsed.tenantId : '',
      tenantName: typeof parsed.tenantName === 'string' ? parsed.tenantName : '',
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
  tenantId: initialScope.tenantId || '',
  tenantName: initialScope.tenantName || '',
  kmsWorkspace: normalizeKmsWorkspace(initialScope.kmsWorkspace),
  faqWorkspace: normalizeFaqWorkspace(initialScope.faqWorkspace),
  setTenantScope: (scope) => {
    const next = {
      tenantId: scope.tenantId || '',
      tenantName: scope.tenantName || '',
      kmsWorkspace: normalizeKmsWorkspace(scope.kmsWorkspace),
      faqWorkspace: normalizeFaqWorkspace(scope.faqWorkspace)
    }
    writeStoredScope(next)
    set(next)
  },
  setKmsWorkspace: (kmsWorkspace) => {
    const normalized = normalizeKmsWorkspace(kmsWorkspace)
    const next = {
      tenantId: get().tenantId,
      tenantName: get().tenantName,
      kmsWorkspace: normalized,
      faqWorkspace: get().faqWorkspace
    }
    writeStoredScope(next)
    set({ kmsWorkspace: normalized })
  },
  setFaqWorkspace: (faqWorkspace) => {
    const normalized = normalizeFaqWorkspace(faqWorkspace)
    const next = {
      tenantId: get().tenantId,
      tenantName: get().tenantName,
      kmsWorkspace: get().kmsWorkspace,
      faqWorkspace: normalized
    }
    writeStoredScope(next)
    set({ faqWorkspace: normalized })
  },
  setWorkspaceScope: (scope) => {
    const next = {
      tenantId: scope.tenantId ?? get().tenantId,
      tenantName: scope.tenantName ?? get().tenantName,
      kmsWorkspace: normalizeKmsWorkspace(scope.kmsWorkspace ?? get().kmsWorkspace),
      faqWorkspace: normalizeFaqWorkspace(scope.faqWorkspace ?? get().faqWorkspace)
    }
    writeStoredScope(next)
    set(next)
  },
  resetWorkspaceScope: () => {
    clearStoredScope()
    set({
      tenantId: '',
      tenantName: '',
      kmsWorkspace: normalizeKmsWorkspace(null),
      faqWorkspace: normalizeFaqWorkspace(null)
    })
  }
}))

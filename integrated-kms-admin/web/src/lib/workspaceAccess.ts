import { normalizeFaqWorkspace, normalizeKmsWorkspace } from '@/config'

export function canChooseWorkspace(role?: string | null) {
  return role === 'admin'
}

type WorkspaceScopeInput = {
  role?: string | null
  selectedTenantId?: string | null
  selectedTenantName?: string | null
  selectedKmsWorkspace?: string | null
  selectedFaqWorkspace?: string | null
  userTenantId?: string | null
  userTenantName?: string | null
  userKmsWorkspace?: string | null
  userFaqWorkspace?: string | null
}

export function resolveEffectiveWorkspaceScope({
  role,
  selectedTenantId,
  selectedTenantName,
  selectedKmsWorkspace,
  selectedFaqWorkspace,
  userTenantId,
  userTenantName,
  userKmsWorkspace,
  userFaqWorkspace
}: WorkspaceScopeInput) {
  const useSelectedWorkspace = canChooseWorkspace(role) && Boolean(selectedTenantId)
  return {
    tenantId: useSelectedWorkspace ? selectedTenantId || '' : userTenantId || '',
    tenantName: useSelectedWorkspace ? selectedTenantName || '' : userTenantName || '',
    kmsWorkspace: normalizeKmsWorkspace(useSelectedWorkspace ? selectedKmsWorkspace || userKmsWorkspace : userKmsWorkspace),
    faqWorkspace: normalizeFaqWorkspace(useSelectedWorkspace ? selectedFaqWorkspace || userFaqWorkspace : userFaqWorkspace)
  }
}

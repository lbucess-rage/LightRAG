import { normalizeFaqWorkspace, normalizeKmsWorkspace } from '@/config'

export function canChooseWorkspace(role?: string | null) {
  return role === 'admin'
}

type WorkspaceScopeInput = {
  role?: string | null
  selectedKmsWorkspace?: string | null
  selectedFaqWorkspace?: string | null
  userKmsWorkspace?: string | null
  userFaqWorkspace?: string | null
}

export function resolveEffectiveWorkspaceScope({
  role,
  selectedKmsWorkspace,
  selectedFaqWorkspace,
  userKmsWorkspace,
  userFaqWorkspace
}: WorkspaceScopeInput) {
  const useSelectedWorkspace = canChooseWorkspace(role)
  return {
    kmsWorkspace: normalizeKmsWorkspace(useSelectedWorkspace ? selectedKmsWorkspace || userKmsWorkspace : userKmsWorkspace),
    faqWorkspace: normalizeFaqWorkspace(useSelectedWorkspace ? selectedFaqWorkspace || userFaqWorkspace : userFaqWorkspace)
  }
}

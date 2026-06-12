export const DEFAULT_KMS_WORKSPACE =
  import.meta.env.VITE_KMS_ADMIN_DEFAULT_KMS_WORKSPACE || 'kevcs'

export const DEFAULT_FAQ_WORKSPACE =
  import.meta.env.VITE_KMS_ADMIN_DEFAULT_FAQ_WORKSPACE || 'kevcs_faq_pair_20260609_145749'

export const DEFAULT_TENANT_ID =
  import.meta.env.VITE_KMS_ADMIN_DEFAULT_TENANT_ID || 'default'

export function normalizeKmsWorkspace(workspace?: string | null) {
  return workspace && workspace !== 'base' ? workspace : DEFAULT_KMS_WORKSPACE
}

export function normalizeFaqWorkspace(workspace?: string | null) {
  return workspace && workspace !== 'base' ? workspace : DEFAULT_FAQ_WORKSPACE
}

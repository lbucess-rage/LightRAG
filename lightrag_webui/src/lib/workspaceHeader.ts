export const encodeWorkspaceHeader = (workspaceId?: string | null) => {
  const value = workspaceId?.trim()
  if (!value) return undefined
  return encodeURIComponent(value)
}

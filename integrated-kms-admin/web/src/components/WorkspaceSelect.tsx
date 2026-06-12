import { useEffect, useMemo, useState } from 'react'
import { api } from '@/api/client'
import { selectClass } from '@/lib/form'

export type WorkspaceMode = 'kms' | 'answer_catalog' | 'hybrid'

export type Workspace = {
  workspace_id: string
  name: string
  description?: string | null
  workspace_mode?: WorkspaceMode
  document_count?: number
  entity_count?: number
  relation_count?: number
  is_busy?: boolean
}

type WorkspaceSelectProps = {
  value: string
  mode?: WorkspaceMode
  onChange: (value: string) => void
  placeholder?: string
  required?: boolean
  disabled?: boolean
}

export function modeLabel(mode?: string) {
  if (mode === 'answer_catalog') return 'FAQ'
  if (mode === 'hybrid') return '통합'
  return 'KMS'
}

export default function WorkspaceSelect({ value, mode, onChange, placeholder, required, disabled }: WorkspaceSelectProps) {
  const [workspaces, setWorkspaces] = useState<Workspace[]>([])

  useEffect(() => {
    const params = new URLSearchParams({ page_size: '100' })
    if (mode) {
      params.set('workspace_mode', mode)
    }
    api
      .get(`/api/lightrag/workspaces?${params.toString()}`)
      .then((response) => setWorkspaces(response.data.workspaces || []))
      .catch(() => setWorkspaces([]))
  }, [mode])

  const selectedMissing = useMemo(
    () => value && !workspaces.some((workspace) => workspace.workspace_id === value),
    [value, workspaces]
  )

  return (
    <select className={selectClass} value={value} onChange={(event) => onChange(event.target.value)} required={required} disabled={disabled}>
      <option value="">{placeholder || '워크스페이스 선택'}</option>
      {selectedMissing && <option value={value}>{value}</option>}
      {workspaces.map((workspace) => (
        <option key={workspace.workspace_id} value={workspace.workspace_id}>
          {workspace.name || workspace.workspace_id} · {workspace.workspace_id} · {modeLabel(workspace.workspace_mode)}
        </option>
      ))}
    </select>
  )
}

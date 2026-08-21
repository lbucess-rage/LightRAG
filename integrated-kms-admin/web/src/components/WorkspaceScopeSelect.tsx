import { useEffect, useMemo, useState } from 'react'
import { Building2Icon } from 'lucide-react'

import { api } from '@/api/client'
import { selectClass } from '@/lib/form'

export type WorkspaceScopeOption = {
  tenant_id: string
  name: string
  kms_workspace: string
  faq_workspace: string
  is_active: boolean
}

type WorkspaceScopeSelectProps = {
  role?: string | null
  tenantId: string
  tenantName?: string
  kmsWorkspace: string
  faqWorkspace: string
  onChange: (scope: WorkspaceScopeOption) => void
  compact?: boolean
}

export default function WorkspaceScopeSelect({
  role,
  tenantId,
  tenantName,
  kmsWorkspace,
  faqWorkspace,
  onChange,
  compact = false
}: WorkspaceScopeSelectProps) {
  const [tenants, setTenants] = useState<WorkspaceScopeOption[]>([])
  const canChange = role === 'admin'

  useEffect(() => {
    if (!canChange) return
    api
      .get('/api/tenants')
      .then((response) => {
        setTenants((response.data.tenants || []).filter((tenant: WorkspaceScopeOption) => tenant.is_active))
      })
      .catch(() => {
        setTenants([])
      })
  }, [canChange])

  const current = useMemo(
    () => tenants.find((tenant) => tenant.tenant_id === tenantId),
    [tenantId, tenants]
  )
  const displayName = current?.name || tenantName || tenantId || '고객센터 미지정'
  const effectiveKmsWorkspace = current?.kms_workspace || kmsWorkspace
  const effectiveFaqWorkspace = current?.faq_workspace || faqWorkspace

  if (!canChange) {
    return (
      <div className="scope-readonly" aria-label="현재 운영 대상 고객센터">
        <Building2Icon className="size-4" />
        <div style={{ minWidth: 0 }}>
          <strong>{displayName}</strong>
          <span>{effectiveKmsWorkspace} / {effectiveFaqWorkspace}</span>
        </div>
      </div>
    )
  }

  return (
    <label className={`field scope-select${compact ? ' compact' : ''}`}>
      <span>운영 대상 고객센터</span>
      <select
        className={selectClass}
        value={tenantId}
        onChange={(event) => {
          const selected = tenants.find((tenant) => tenant.tenant_id === event.target.value)
          if (selected) onChange(selected)
        }}
      >
        {!tenantId && <option value="">고객센터 선택</option>}
        {tenantId && !current && <option value={tenantId}>{displayName}</option>}
        {tenants.map((tenant) => (
          <option key={tenant.tenant_id} value={tenant.tenant_id}>
            {tenant.name} · {tenant.kms_workspace} / {tenant.faq_workspace}
          </option>
        ))}
      </select>
      <small className="scope-pair">
        KMS <b>{effectiveKmsWorkspace}</b>
        <span aria-hidden="true">·</span>
        FAQ <b>{effectiveFaqWorkspace}</b>
      </small>
    </label>
  )
}

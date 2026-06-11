import { useEffect, useMemo, useState } from 'react'
import { api } from '@/api/client'
import { selectClass } from '@/lib/form'

export type Tenant = {
  tenant_id: string
  name: string
  kms_workspace: string
  faq_workspace: string
  is_active: boolean
}

type TenantSelectProps = {
  value?: string | null
  onChange: (tenantId: string) => void
  required?: boolean
  disabled?: boolean
}

export default function TenantSelect({ value, onChange, required, disabled }: TenantSelectProps) {
  const [tenants, setTenants] = useState<Tenant[]>([])

  useEffect(() => {
    api.get('/api/tenants').then((response) => {
      const rows = response.data.tenants || []
      setTenants(rows)
      if (!value && rows[0]?.tenant_id) {
        onChange(rows[0].tenant_id)
      }
    })
  }, [])

  const selectedTenant = useMemo(
    () => tenants.find((tenant) => tenant.tenant_id === value),
    [tenants, value]
  )

  return (
    <div className="col" style={{ gap: 6 }}>
      <select
        className={selectClass}
        value={value || ''}
        onChange={(event) => onChange(event.target.value)}
        required={required}
        disabled={disabled}
      >
        {!required && <option value="">테넌트 선택</option>}
        {tenants.map((tenant) => (
          <option key={tenant.tenant_id} value={tenant.tenant_id}>
            {tenant.name} · {tenant.kms_workspace} / {tenant.faq_workspace}
          </option>
        ))}
      </select>
      {selectedTenant && (
        <div className="muted mono" style={{ fontSize: 11, lineHeight: 1.45 }}>
          {selectedTenant.kms_workspace} / {selectedTenant.faq_workspace}
        </div>
      )}
    </div>
  )
}

import { expect, test } from 'bun:test'
import { canChooseWorkspace, resolveEffectiveWorkspaceScope } from './lib/workspaceAccess'

test('only admin can choose an arbitrary workspace scope', () => {
  expect(canChooseWorkspace('admin')).toBe(true)
  expect(canChooseWorkspace('manager')).toBe(false)
  expect(canChooseWorkspace('user')).toBe(false)
})

test('non-admin workspace scope is forced to the account mapping', () => {
  expect(
    resolveEffectiveWorkspaceScope({
      role: 'user',
      selectedTenantId: 'previous-tenant',
      selectedTenantName: '이전 고객센터',
      selectedKmsWorkspace: 'previous-kms',
      selectedFaqWorkspace: 'previous-faq',
      userTenantId: 'test1',
      userTenantName: '테스트 고객센터',
      userKmsWorkspace: 'test1-kms',
      userFaqWorkspace: 'test1-faq'
    })
  ).toEqual({
    tenantId: 'test1',
    tenantName: '테스트 고객센터',
    kmsWorkspace: 'test1-kms',
    faqWorkspace: 'test1-faq'
  })
})

test('admin workspace scope can use the selected values', () => {
  expect(
    resolveEffectiveWorkspaceScope({
      role: 'admin',
      selectedTenantId: 'selected-tenant',
      selectedTenantName: '선택 고객센터',
      selectedKmsWorkspace: 'selected-kms',
      selectedFaqWorkspace: 'selected-faq',
      userTenantId: 'admin-tenant',
      userTenantName: '관리자 기본 고객센터',
      userKmsWorkspace: 'admin-kms',
      userFaqWorkspace: 'admin-faq'
    })
  ).toEqual({
    tenantId: 'selected-tenant',
    tenantName: '선택 고객센터',
    kmsWorkspace: 'selected-kms',
    faqWorkspace: 'selected-faq'
  })
})

test('admin without an explicit tenant selection falls back to the account pair', () => {
  expect(
    resolveEffectiveWorkspaceScope({
      role: 'admin',
      selectedTenantId: '',
      selectedKmsWorkspace: 'stale-kms',
      selectedFaqWorkspace: 'stale-faq',
      userTenantId: 'admin-tenant',
      userTenantName: '관리자 기본 고객센터',
      userKmsWorkspace: 'admin-kms',
      userFaqWorkspace: 'admin-faq'
    })
  ).toEqual({
    tenantId: 'admin-tenant',
    tenantName: '관리자 기본 고객센터',
    kmsWorkspace: 'admin-kms',
    faqWorkspace: 'admin-faq'
  })
})

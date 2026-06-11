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
      selectedKmsWorkspace: 'previous-kms',
      selectedFaqWorkspace: 'previous-faq',
      userKmsWorkspace: 'test1-kms',
      userFaqWorkspace: 'test1-faq'
    })
  ).toEqual({
    kmsWorkspace: 'test1-kms',
    faqWorkspace: 'test1-faq'
  })
})

test('admin workspace scope can use the selected values', () => {
  expect(
    resolveEffectiveWorkspaceScope({
      role: 'admin',
      selectedKmsWorkspace: 'selected-kms',
      selectedFaqWorkspace: 'selected-faq',
      userKmsWorkspace: 'admin-kms',
      userFaqWorkspace: 'admin-faq'
    })
  ).toEqual({
    kmsWorkspace: 'selected-kms',
    faqWorkspace: 'selected-faq'
  })
})

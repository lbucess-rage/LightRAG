import { expect, test } from 'bun:test'
import {
  DEFAULT_FAQ_WORKSPACE,
  DEFAULT_KMS_WORKSPACE,
  normalizeFaqWorkspace,
  normalizeKmsWorkspace
} from './config'

test('workspace defaults use the requested verification pair', () => {
  expect(DEFAULT_KMS_WORKSPACE).toBe('kevcs')
  expect(DEFAULT_FAQ_WORKSPACE).toBe('kevcs_faq_pair_20260609_145749')
})

test('base workspace values are normalized to the verification pair', () => {
  expect(normalizeKmsWorkspace('base')).toBe(DEFAULT_KMS_WORKSPACE)
  expect(normalizeFaqWorkspace('base')).toBe(DEFAULT_FAQ_WORKSPACE)
  expect(normalizeKmsWorkspace('custom-kms')).toBe('custom-kms')
  expect(normalizeFaqWorkspace('custom-faq')).toBe('custom-faq')
})

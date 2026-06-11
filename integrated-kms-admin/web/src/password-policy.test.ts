import { PASSWORD_MIN_LENGTH, createUserDisabledReason, passwordRuleFeedback } from './lib/passwordPolicy'

test('password feedback explains minimum length and remaining characters', () => {
  expect(PASSWORD_MIN_LENGTH).toBe(8)
  expect(passwordRuleFeedback('').message).toBe('비밀번호는 8자 이상이어야 합니다.')
  expect(passwordRuleFeedback('abc').message).toBe('현재 3자입니다. 5자 더 입력해야 합니다.')
  expect(passwordRuleFeedback('abcdefgh')).toEqual({
    valid: true,
    tone: 'green',
    message: '길이 조건을 충족했습니다.'
  })
})

test('create user disabled reason reports the first missing requirement', () => {
  expect(createUserDisabledReason({ userId: '', password: 'abcdefgh', kmsWorkspace: 'kms', faqWorkspace: 'faq' })).toBe(
    '아이디를 입력해야 합니다.'
  )
  expect(createUserDisabledReason({ userId: 'user1', password: 'short', kmsWorkspace: 'kms', faqWorkspace: 'faq' })).toBe(
    '초기 비밀번호는 8자 이상이어야 합니다.'
  )
  expect(createUserDisabledReason({ userId: 'user1', password: 'abcdefgh', kmsWorkspace: '', faqWorkspace: 'faq' })).toBe(
    'KMS 워크스페이스를 선택해야 합니다.'
  )
  expect(createUserDisabledReason({ userId: 'user1', password: 'abcdefgh', tenantId: '' })).toBe(
    '테넌트를 선택해야 합니다.'
  )
  expect(createUserDisabledReason({ userId: 'user1', password: 'abcdefgh', tenantId: 'default' })).toBe('')
  expect(createUserDisabledReason({ userId: 'user1', password: 'abcdefgh', kmsWorkspace: 'kms', faqWorkspace: 'faq' })).toBe(
    ''
  )
})

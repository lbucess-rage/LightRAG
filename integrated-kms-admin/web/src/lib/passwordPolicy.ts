export const PASSWORD_MIN_LENGTH = 8

export function passwordRuleFeedback(password: string) {
  const length = password.length
  const remaining = Math.max(PASSWORD_MIN_LENGTH - length, 0)

  if (length === 0) {
    return {
      valid: false,
      tone: 'gray' as const,
      message: `비밀번호는 ${PASSWORD_MIN_LENGTH}자 이상이어야 합니다.`
    }
  }
  if (remaining > 0) {
    return {
      valid: false,
      tone: 'red' as const,
      message: `현재 ${length}자입니다. ${remaining}자 더 입력해야 합니다.`
    }
  }
  return {
    valid: true,
    tone: 'green' as const,
    message: '길이 조건을 충족했습니다.'
  }
}

export function createUserDisabledReason(values: {
  userId: string
  password: string
  tenantId?: string | null
  kmsWorkspace?: string | null
  faqWorkspace?: string | null
}) {
  if (!values.userId.trim()) {
    return '아이디를 입력해야 합니다.'
  }
  if (values.password.length < PASSWORD_MIN_LENGTH) {
    return `초기 비밀번호는 ${PASSWORD_MIN_LENGTH}자 이상이어야 합니다.`
  }
  if ('tenantId' in values && !values.tenantId) {
    return '테넌트를 선택해야 합니다.'
  }
  if ('tenantId' in values) {
    return ''
  }
  if (!values.kmsWorkspace) {
    return 'KMS 워크스페이스를 선택해야 합니다.'
  }
  if (!values.faqWorkspace) {
    return 'FAQ 워크스페이스를 선택해야 합니다.'
  }
  return ''
}

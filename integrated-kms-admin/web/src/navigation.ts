export const navItems = [
  { key: 'search', label: '통합 검색', group: '지식', description: '생성형 AI 답변 + FAQ 답변 통합 조회' },
  { key: 'knowledge', label: '지식 관리', group: '지식', description: 'FAQ·문서 지식 등록 및 지식화 관리' },
  { key: 'categories', label: '카테고리', group: '지식', description: '트리 분류 구성' },
  { key: 'stats', label: '현황 · 통계', group: '분석', description: '이용 현황 분석' },
  { key: 'jobs', label: '작업 이력', group: '분석', description: '지식화·롤백 추적' },
  { key: 'help', label: '기능 도움말', group: '도움말', description: '권한별 기능 사용 안내' },
  { key: 'helpAdmin', label: '도움말 관리', group: '도움말', description: '도움말 게시와 권한별 노출 설정' },
  { key: 'tenants', label: '고객센터 관리', group: '관리', description: '테넌트·워크스페이스 매핑' },
  { key: 'users', label: '사용자 관리', group: '관리', description: '계정·워크스페이스·이력' },
  { key: 'external', label: 'API 관리', group: '관리', description: '외부 통합 검색 연동' },
  { key: 'system', label: '시스템', group: '관리', description: '운영 상태·로그' }
] as const

export type NavKey = (typeof navItems)[number]['key']

export const navGroups = ['지식', '분석', '도움말', '관리'] as const

export function canSeeNav(role: string | undefined, key: NavKey) {
  const normalizedRole = role === 'viewer' ? 'user' : role
  if (normalizedRole === 'admin') return true
  if (normalizedRole === 'manager') return ['search', 'knowledge', 'categories', 'stats', 'jobs', 'help'].includes(key)
  return key === 'search' || key === 'help'
}

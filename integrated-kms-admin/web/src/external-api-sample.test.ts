import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { expect, test } from 'bun:test'

test('api management provides an external integrated search sample runner', () => {
  const source = readFileSync(resolve(import.meta.dir, 'features/AdminSections.tsx'), 'utf8')

  expect(source).toContain('externalSearchSamplePresets')
  expect(source).toContain('통합 검색 기본')
  expect(source).toContain('생성형만')
  expect(source).toContain('FAQ만')
  expect(source).toContain('카테고리 제한')
  expect(source).toContain('NDJSON 스트리밍')
  expect(source).toContain('/api/external/search/stream')
  expect(source).toContain('/api/external/search')
  expect(source).toContain('/api/external/categories')
  expect(source).toContain('X-KMS-ADMIN-API-Key')
  expect(source).toContain('외부 통합 검색 API 샘플')
  expect(source).toContain('통합 검색 요청 파라미터')
  expect(source).toContain('유효기간 적용 방식')
  expect(source).toContain('GET /api/external/categories')
  expect(source).toContain('generative_answer.response')
  expect(source).toContain('faq_results[]')
  expect(source).toContain('trace.eligibility')
  expect(source).toContain('/reveal-key')
  expect(source).toContain('API Key 확인')
  expect(source).toContain('관리자 비밀번호')
  expect(source).toContain('감사 로그')
})

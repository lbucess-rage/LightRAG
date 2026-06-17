import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { expect, test } from 'bun:test'

test('knowledge create modal explains prompts and validity settings', () => {
  const source = readFileSync(resolve(import.meta.dir, 'features/AdminSections.tsx'), 'utf8')

  expect(source).toContain('react-day-picker')
  expect(source).toContain('function DateRangeTimePicker')
  expect(source).toContain('title="처리 지시"')
  expect(source).toContain('title="검색 사용 조건"')
  expect(source).toContain('필드 매핑 JSON')
  expect(source).toContain('Header JSON')
  expect(source).toContain('className={`file-picker')
  expect(source).toContain('파일 선택')
})

test('knowledge list supports paging controls', () => {
  const source = readFileSync(resolve(import.meta.dir, 'features/AdminSections.tsx'), 'utf8')

  expect(source).toContain('knowledgePage')
  expect(source).toContain('knowledgePageSize')
  expect(source).toContain('pagedKnowledgeRows')
  expect(source).toContain('10개씩')
  expect(source).toContain('마지막')
  expect(source).toContain('visibleKnowledgeRows.slice')
})

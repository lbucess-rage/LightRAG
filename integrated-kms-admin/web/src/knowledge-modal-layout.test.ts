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
  const css = readFileSync(resolve(import.meta.dir, 'index.css'), 'utf8')

  expect(source).toContain('knowledgePage')
  expect(source).toContain('knowledgePageSize')
  expect(source).toContain('pagedKnowledgeRows')
  expect(source).toContain('10개씩')
  expect(source).toContain('마지막')
  expect(source).toContain('visibleKnowledgeRows.slice')
  expect(source).toContain('className="table-scroll knowledge-table-scroll"')
  expect(css).toContain('overflow-x: hidden')
  expect(css).toContain('.knowledge-table-scroll .tbl')
})

test('knowledge list loads every backend page before counting rows', () => {
  const source = readFileSync(resolve(import.meta.dir, 'features/AdminSections.tsx'), 'utf8')

  expect(source).toContain('fetchAllKnowledgePages')
  expect(source).toContain('KNOWLEDGE_DOCUMENT_PAGE_SIZE = 200')
  expect(source).toContain('KNOWLEDGE_FAQ_PAGE_SIZE = 100')
  expect(source).toContain("endpoint: '/api/knowledge/kms-documents'")
  expect(source).toContain("endpoint: '/api/knowledge/faq-answers'")
  expect(source).not.toContain("api.get(`/api/knowledge/kms-documents?${documentParams.toString()}`)")
  expect(source).not.toContain("api.get(`/api/knowledge/faq-answers?${faqParams.toString()}`)")
})

test('knowledge management highlights and auto-syncs running ingestion jobs', () => {
  const source = readFileSync(resolve(import.meta.dir, 'features/AdminSections.tsx'), 'utf8')

  expect(source).toContain('진행 중 지식화')
  expect(source).toContain('5초마다 자동 동기화')
  expect(source).toContain('runningJobs.map')
  expect(source).toContain('window.setInterval')
  expect(source).toContain("syncRunningJobs({ silent: true })")
})

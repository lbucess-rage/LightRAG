import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { expect, test } from 'bun:test'

test('job history includes FAQ-specific pipelines', () => {
  const source = readFileSync(resolve(import.meta.dir, 'features/AdminSections.tsx'), 'utf8')

  expect(source).toContain('faq_answer: [')
  expect(source).toContain('faq_source_draft: [')
  expect(source).toContain('LightRAG FAQ 답변 등록')
  expect(source).toContain('LightRAG FAQ 소스 초안 등록')
})

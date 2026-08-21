import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { expect, test } from 'bun:test'

test('knowledge management exposes FAQ bulk creation and terminology tools', () => {
  const source = readFileSync(resolve(import.meta.dir, 'features/AdminSections.tsx'), 'utf8')
  const bulkSource = readFileSync(resolve(import.meta.dir, 'features/FaqBulkCreate.tsx'), 'utf8')
  const graphSource = readFileSync(resolve(import.meta.dir, 'features/FaqGraphManager.tsx'), 'utf8')
  const termSource = readFileSync(resolve(import.meta.dir, 'features/FaqTerminologyManager.tsx'), 'utf8')

  expect(source).toContain('FAQ 일괄 생성')
  expect(source).toContain('공통 용어')
  expect(source).toContain('<FaqBulkCreate')
  expect(source).toContain('<FaqTerminologyManager')
  expect(source).toContain('FAQ 그래프')
  expect(source).toContain('<FaqGraphManager')
  expect(source).toContain('value="graph_hybrid"')
  expect(source).toContain("useState('hybrid')")
  expect(bulkSource).toContain('/api/knowledge/faq-structured/excel/preview')
  expect(bulkSource).toContain('/api/knowledge/faq-structured/materialize')
  expect(bulkSource).toContain('/api/knowledge/faq-connectors')
  expect(bulkSource).toContain('AI 찾기 힌트 보완')
  expect(termSource).toContain('/api/knowledge/faq-aliases')
  expect(termSource).toContain('/api/knowledge/faq-term-candidates/analyze')
  expect(termSource).toContain('AI 검토 후보')
  expect(graphSource).toContain('/api/knowledge/faq-graph/config')
  expect(graphSource).toContain('/api/knowledge/faq-graph/preview')
  expect(graphSource).toContain('/api/knowledge/faq-graph/rebuild')
  expect(graphSource).toContain('precision_mode')
  expect(graphSource).toContain('확실한 경우만 답변')
})

test('integrated search defaults FAQ retrieval to hybrid and explains aliases', () => {
  const source = readFileSync(resolve(import.meta.dir, 'features/IntegratedSearch.tsx'), 'utf8')

  expect(source).toContain("retrieval_mode: 'hybrid'")
  expect(source).toContain("selection_policy: 'workspace'")
  expect(source).toContain('faq_options')
  expect(source).toContain('alias_expansions')
  expect(source).toContain('적용된 공통 용어')
  expect(source).toContain('graph_hybrid')
  expect(source).toContain('그래프 연결 근거')
  expect(source).toContain('HELP-SEARCH-005')
})

test('help includes bulk FAQ, terminology, and hybrid search topics', () => {
  const source = readFileSync(resolve(import.meta.dir, 'features/Help.tsx'), 'utf8')

  expect(source).toContain('HELP-KNOWLEDGE-016')
  expect(source).toContain('HELP-KNOWLEDGE-017')
  expect(source).toContain('HELP-KNOWLEDGE-018')
  expect(source).toContain('HELP-SEARCH-005')
  expect(source).toContain('Excel과 DB 표에서 FAQ 일괄 생성하기')
  expect(source).toContain('FAQ 공통 용어와 AI 후보 관리하기')
  expect(source).toContain('FAQ 그래프 구성과 그래프 결합 검색 사용하기')
})

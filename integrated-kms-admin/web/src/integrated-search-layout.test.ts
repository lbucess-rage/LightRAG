import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { expect, test } from 'bun:test'

test('integrated search applies selected layout before results exist', () => {
  const source = readFileSync(resolve(import.meta.dir, 'features/IntegratedSearch.tsx'), 'utf8')

  expect(source).toContain('const readyTabs = (')
  expect(source).toContain('{layout === \'overview\' && <div className="fadein">{readyOverview}</div>}')
  expect(source).toContain('{layout === \'tabs\' && <div className="fadein">{readyTabs}</div>}')
  expect(source).toContain('{layout === \'rail\' && (')
})

test('integrated search surfaces validity exclusions from trace eligibility', () => {
  const source = readFileSync(resolve(import.meta.dir, 'features/IntegratedSearch.tsx'), 'utf8')

  expect(source).toContain('function EligibilityNotice')
  expect(source).toContain('trace?.eligibility')
  expect(source).toContain('유효하지 않은 지식은 답변 후보에서 제외되었습니다.')
  expect(source).toContain('유효기간 만료')
})

test('integrated search links citation badges to reference cards and original files', () => {
  const source = readFileSync(resolve(import.meta.dir, 'features/IntegratedSearch.tsx'), 'utf8')

  expect(source).toContain('function CitationText')
  expect(source).toContain('className="citation-link"')
  expect(source).toContain('className="reference-card"')
  expect(source).toContain('원본 보기')
  expect(source).toContain('downloadUrl')
})

test('integrated search renders structured image evidence from LightRAG references', () => {
  const source = readFileSync(resolve(import.meta.dir, 'features/IntegratedSearch.tsx'), 'utf8')

  expect(source).toContain('function ReferenceImages')
  expect(source).toContain('reference.structured_content')
  expect(source).toContain('className="reference-image-grid"')
  expect(source).toContain('이미지 근거')
})

test('integrated search opens category options from a picker and shows selected categories only', () => {
  const source = readFileSync(resolve(import.meta.dir, 'features/IntegratedSearch.tsx'), 'utf8')

  expect(source).toContain('showCategoryPicker')
  expect(source).toContain('카테고리 선택')
  expect(source).toContain('className="category-picker-panel"')
  expect(source).toContain('selectedCategoryLabels.map')
  expect(source).toContain('category-filter-count')
})

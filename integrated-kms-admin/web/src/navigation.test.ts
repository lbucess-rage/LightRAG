import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { expect, test } from 'bun:test'
import { canSeeNav, navItems } from './navigation'

test('admin navigation exposes planned top-level sections', () => {
  expect(navItems.map((item) => item.label)).toEqual([
    '통합 검색',
    '지식 관리',
    '카테고리',
    '현황 · 통계',
    '작업 이력',
    '고객센터 관리',
    '사용자 관리',
    'API 관리',
    '시스템'
  ])
})

test('navigation follows prototype role visibility', () => {
  const visibleFor = (role: string) =>
    navItems.filter((item) => canSeeNav(role, item.key)).map((item) => item.key)

  expect(visibleFor('admin')).toEqual([
    'search',
    'knowledge',
    'categories',
    'stats',
    'jobs',
    'tenants',
    'users',
    'external',
    'system'
  ])
  expect(visibleFor('manager')).toEqual(['search', 'knowledge', 'categories', 'stats', 'jobs'])
  expect(visibleFor('viewer')).toEqual(['search'])
  expect(visibleFor('user')).toEqual(['search'])
})

test('app shell renders top navigation as tabs', () => {
  const source = readFileSync(resolve(import.meta.dir, 'App.tsx'), 'utf8')

  expect(source).toContain('className="tb-tabs"')
  expect(source).toContain('role="tablist"')
  expect(source).toContain('role="tab"')
  expect(source).toContain('visibleNavItems.map')
})

test('app shell keeps visited tab views mounted', () => {
  const source = readFileSync(resolve(import.meta.dir, 'App.tsx'), 'utf8')

  expect(source).toContain('mountedViews')
  expect(source).toContain('className="view-pane"')
  expect(source).toContain('hidden={effectiveActive !== item.key}')
  expect(source).toContain('scrollPositions')
})

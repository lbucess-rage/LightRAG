import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { expect, test } from 'bun:test'
import { helpBodyForRole } from './features/Help'

test('help feature exposes reader and admin management screens', () => {
  const appSource = readFileSync(resolve(import.meta.dir, 'App.tsx'), 'utf8')
  const helpSource = readFileSync(resolve(import.meta.dir, 'features/Help.tsx'), 'utf8')

  expect(appSource).toContain('HelpCenter')
  expect(appSource).toContain('HelpAdmin')
  expect(helpSource).toContain('/api/help/topics')
  expect(helpSource).toContain('/api/help/admin/topics')
  expect(helpSource).toContain('권한별 노출')
  expect(helpSource).toContain('ScreenshotPreview')
  expect(helpSource).toContain('HELP_TOPICS_CHANGED_EVENT')
  expect(helpSource).toContain('window.dispatchEvent')
  expect(helpSource).toContain('window.addEventListener(HELP_TOPICS_CHANGED_EVENT')
  expect(helpSource).toContain('RelatedHelp')
  expect(helpSource).toContain('OPEN_HELP_TOPIC_EVENT')
  expect(helpSource).toContain('자세히 보기')
  expect(appSource).toContain('focusHelpId')
})

test('help reader hides internal metadata table for non-admin roles', () => {
  const body = [
    '## HELP-SEARCH-001. 통합 검색 사용하기',
    '',
    '| 항목 | 내용 |',
    '| --- | --- |',
    '| 메뉴 | 통합 검색 |',
    '| 대상 권한 | 일반 사용자, 지식 관리자, 시스템 관리자 |',
    '',
    '### 이 기능은 언제 사용하나요?',
    '',
    '질문을 검색합니다.'
  ].join('\n')

  expect(helpBodyForRole(body, 'manager')).not.toContain('| 항목 | 내용 |')
  expect(helpBodyForRole(body, 'user')).not.toContain('| 항목 | 내용 |')
  expect(helpBodyForRole(body, 'admin')).toContain('| 항목 | 내용 |')
})

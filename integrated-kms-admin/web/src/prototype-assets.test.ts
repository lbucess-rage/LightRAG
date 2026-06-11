import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { expect, test } from 'bun:test'

const root = resolve(import.meta.dir, '..')

test('admin shell loads prototype design system assets', () => {
  const html = readFileSync(resolve(root, 'index.html'), 'utf8')

  expect(html).toContain('/prototype/assets/tokens.css')
  expect(html).toContain('/prototype/assets/app.css')
  expect(existsSync(resolve(root, 'public/prototype/assets/tokens.css'))).toBe(true)
  expect(existsSync(resolve(root, 'public/prototype/assets/app.css'))).toBe(true)
  expect(existsSync(resolve(root, 'public/prototype/assets/logo-lbucess.png'))).toBe(true)
  expect(existsSync(resolve(root, 'public/assets/logo-lbucess.png'))).toBe(true)
})

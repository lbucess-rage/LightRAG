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

test('runtime logo assets follow the configured admin base path', () => {
  const app = readFileSync(resolve(root, 'src/App.tsx'), 'utf8')
  const login = readFileSync(resolve(root, 'src/features/Login.tsx'), 'utf8')
  const helper = readFileSync(resolve(root, 'src/lib/assets.ts'), 'utf8')

  expect(helper).toContain('import.meta.env.BASE_URL')
  expect(app).toContain("publicAsset('assets/logo-lbucess.png')")
  expect(app).toContain("publicAsset('assets/logo-lbucess-mark.png')")
  expect(login).toContain("publicAsset('assets/logo-lbucess.png')")
  expect(app).not.toContain('src="/assets/logo-lbucess')
  expect(login).not.toContain('src="/assets/logo-lbucess')
})

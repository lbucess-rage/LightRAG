import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { expect, test } from 'bun:test'

test('expired API sessions clear token and return the app to login', () => {
  const apiClient = readFileSync(resolve(import.meta.dir, 'api/client.ts'), 'utf8')
  const app = readFileSync(resolve(import.meta.dir, 'App.tsx'), 'utf8')

  expect(apiClient).toContain('AUTH_EXPIRED_EVENT')
  expect(apiClient).toContain('api.interceptors.response.use')
  expect(apiClient).toContain("status === 401")
  expect(apiClient).toContain("!url.includes('/api/auth/login')")
  expect(apiClient).toContain("sessionStorage.removeItem('KMS_ADMIN_TOKEN')")
  expect(app).toContain('AUTH_EXPIRED_EVENT')
  expect(app).toContain('window.addEventListener(AUTH_EXPIRED_EVENT')
  expect(app).toContain('로그인이 만료되었습니다')
})

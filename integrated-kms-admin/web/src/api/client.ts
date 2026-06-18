import axios from 'axios'

export const AUTH_EXPIRED_EVENT = 'kms-admin-auth-expired'

export const api = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL || ''
})

api.interceptors.request.use((config) => {
  const token = sessionStorage.getItem('KMS_ADMIN_TOKEN')
  if (token) {
    config.headers.Authorization = `Bearer ${token}`
  }
  return config
})

api.interceptors.response.use(
  (response) => response,
  (error) => {
    const status = error?.response?.status
    const url = String(error?.config?.url || '')
    if (status === 401 && !url.includes('/api/auth/login')) {
      sessionStorage.removeItem('KMS_ADMIN_TOKEN')
      window.dispatchEvent(new CustomEvent(AUTH_EXPIRED_EVENT))
    }
    return Promise.reject(error)
  }
)

export async function login(userId: string, password: string) {
  const response = await api.post('/api/auth/login', { user_id: userId, password })
  sessionStorage.setItem('KMS_ADMIN_TOKEN', response.data.access_token)
  return response.data
}

export async function me() {
  const response = await api.get('/api/auth/me')
  return response.data.user
}
